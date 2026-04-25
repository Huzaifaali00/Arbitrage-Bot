import { ethers } from "ethers";
import config from "./config";
import logger from "./utils/logger";

import { EventListener } from "./core/eventListener";
import { OpportunityDetector } from "./core/opportunityDetector";
import { RouteCalculator } from "./core/routeCalculator";
import { PoolDiscoveryService } from "./core/poolDiscoveryService";
import GasOptimizer from "./execution/gasOptimizer";
import TransactionBuilder from "./execution/transactionBuilder";
import TransactionSubmitter from "./execution/transactionSubmitter";
import ProfitTracker from "./monitoring/profitTracker";
import Dashboard from "./monitoring/dashboard";
import { VaultService } from "./services/VaultService";

import {
    ArbitrageOpportunity,
    Pool,
    PriceCache,
    PriceUpdate,
    ChainType,
} from "./types";

interface BotRuntime {
    isRunning: boolean;
    isPaused: boolean;
    startTime: number;
    opportunitiesFound: number;
    opportunitiesExecuted: number;
    lastOpportunityTime: number;
}

export class ArbitrageBot {
    private readonly wrappedNativeByChain: Record<ChainType, string> = {
        [ChainType.BASE_MAINNET]: "0x4200000000000000000000000000000000000006",
        [ChainType.BASE_SEPOLIA]: "0x4200000000000000000000000000000000000006",
        [ChainType.ARBITRUM_MAINNET]: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
        [ChainType.ARBITRUM_SEPOLIA]: "0x980b62da83eff3d4576c6479938c2e87f5f3bc7a",
    };

    private provider: ethers.JsonRpcProvider;
    private eventListener: EventListener;
    private opportunityDetector: OpportunityDetector;
    private routeCalculator: RouteCalculator;
    private poolDiscoveryService: PoolDiscoveryService;
    private gasOptimizer: GasOptimizer;
    private transactionBuilder: TransactionBuilder;
    private transactionSubmitter: TransactionSubmitter;
    private profitTracker: ProfitTracker;
    private dashboard: Dashboard;
    private vaultService: VaultService | null = null;

    private priceCache: PriceCache = {};

    private inFlightOpportunities = new Set<string>();
    private activeRoutes = new Set<string>();
    private routeCooldowns = new Map<string, number>();
    private executionLoopBusy = false;
    private readonly routeCooldownMs = 30_000;

    private runtime: BotRuntime = {
        isRunning: false,
        isPaused: false,
        startTime: 0,
        opportunitiesFound: 0,
        opportunitiesExecuted: 0,
        lastOpportunityTime: 0,
    };

    private executionLoop?: NodeJS.Timeout;
    private metricsLoop?: NodeJS.Timeout;
    private maintenanceLoop?: NodeJS.Timeout;

    constructor() {
        // Provider selection — respects USE_ANVIL env var
        const useAnvil = process.env.USE_ANVIL === 'true';
        const effectiveRpcUrl = useAnvil
            ? (process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8545')
            : config.rpcUrl;
        const effectiveWsUrl = useAnvil
            ? (process.env.ANVIL_WS_URL ?? 'ws://127.0.0.1:8545')
            : config.wsUrl;

        if (!effectiveRpcUrl) {
            throw new Error('No RPC URL configured. Set BASE_SEPOLIA_RPC_URL or USE_ANVIL=true + ANVIL_RPC_URL');
        }

        // Use HTTP provider for Anvil (more stable for local fork), WS for live networks
        this.provider = useAnvil
            ? new ethers.JsonRpcProvider(effectiveRpcUrl)
            : new ethers.JsonRpcProvider(effectiveRpcUrl);

        logger.info(`[Provider] Connected to: ${effectiveRpcUrl} (${useAnvil ? 'Anvil fork' : 'live network'})`);

        this.eventListener = new EventListener(effectiveWsUrl, [], effectiveRpcUrl);
        this.opportunityDetector = new OpportunityDetector([], this.provider, 0.3);
        this.routeCalculator = new RouteCalculator([]);

        this.poolDiscoveryService = new PoolDiscoveryService(
            config.rpcUrl,
            config.dexRegistryAddress,
            {
                minTVL: 0,
                minVolume24h: 0,
                minPoolAge: 0,
                discoveryInterval: 120_000,
                metricsRefreshInterval: 300_000,
                chain: config.chain,
            },
        );

        this.gasOptimizer = new GasOptimizer(config.rpcUrl, {
            maxGasPriceGwei: config.maxGasPriceGwei,
            minProfitBps: config.minProfitBps,
            dailyLossLimit: 100,
            gasMultiplier: 1.2,
        });

        this.transactionBuilder = new TransactionBuilder(this.provider);

        const useMEVBundle =
            config.chain === ChainType.BASE_MAINNET ||
            config.chain === ChainType.ARBITRUM_MAINNET;

        this.transactionSubmitter = new TransactionSubmitter(
            config.rpcUrl,
            config.privateKey,
            useMEVBundle,
        );

        this.profitTracker = new ProfitTracker(`./bot-data-${config.chain}.db`);
        this.dashboard = new Dashboard({
            port: 3000,
            enableCors: true,
            vaultAddress: config.vaultAddress,
            rpcUrl: config.rpcUrl,
            chain: config.chain,
        });

        // VaultService is optional — only active when VAULT_ADDRESS is configured
        if (config.vaultAddress) {
            this.vaultService = new VaultService(
                config.rpcUrl,
                config.vaultAddress,
                config.privateKey,
                config.contractAddress // Pass the bot address
            );
        }

        this._setupDashboardCallbacks();

        logger.info("ArbitrageBot initialised", {
            chain: config.chain,
            contractAddress: config.contractAddress,
            registryAddress: config.dexRegistryAddress,
            vaultAddress: config.vaultAddress || "not configured",
        });
    }

    /**
     * Start the bot — verifies connection, boots all services, and wires event streams
     */
    async start(): Promise<void> {
        try {
            logger.info("Starting ArbitrageBot…");

            const network = await this.provider.getNetwork();
            logger.info("Connected to network", {
                name: network.name,
                chainId: network.chainId,
            });

            if (
                config.contractAddress &&
                config.contractAddress !== "0x" + "0".repeat(40)
            ) {
                let code = "0x";
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        code = await this.provider.getCode(config.contractAddress);
                        if (code !== "0x") break;
                    } catch (e) {
                        logger.warn(`Contract verification attempt ${attempt}/3 failed`, { error: (e as Error).message });
                    }
                    if (attempt < 3) await new Promise(r => setTimeout(r, 2000));
                }
                if (code === "0x") {
                    logger.warn(
                        "ArbitrageBot contract not found at specified address — execution paused. Verify CONTRACT_ADDRESS and RPC_URL point to the same network.",
                        { contractAddress: config.contractAddress, chainId: network.chainId },
                    );
                    this.runtime.isPaused = true;
                } else {
                    logger.info("Contract verified on-chain", { contractAddress: config.contractAddress });
                }
            } else {
                logger.warn("No valid CONTRACT_ADDRESS — skipping contract verification");
                this.runtime.isPaused = true;
            }

            this.runtime.isRunning = true;
            this.runtime.startTime = Date.now();
            this.runtime.isPaused = false;

            // Wire price updates from EventListener into both detectors
            this.eventListener.on("priceUpdate", (update: PriceUpdate) => {
                this.priceCache[update.pool] = {
                    token0: update.token0,
                    token1: update.token1,
                    price: update.price,
                    liquidity: update.liquidity,
                    lastUpdate: update.timestamp,
                };
                this.opportunityDetector.updatePriceCache(this.priceCache);
                this.routeCalculator.updatePriceCache(this.priceCache);
            });

            this.eventListener.on("fatalError", () => {
                logger.error(
                    "EventListener hit max reconnect attempts — pausing bot",
                );
                this.pause();
            });

            // Wire pool discovery into all consumers
            this.poolDiscoveryService.on("poolDiscovered", (candidate: any) => {
                const pool: Pool = {
                    address: candidate.address,
                    dexType: candidate.dexType,
                    token0: candidate.token0,
                    token1: candidate.token1,
                    fee: candidate.fee,
                    lastUpdated: Date.now(),
                };

                this.opportunityDetector.addPool(pool);
                this.routeCalculator.addPool(pool);
                this.eventListener.addPool(pool);

                logger.info("New pool added to bot", {
                    address: pool.address,
                    dexType: pool.dexType,
                    score: candidate.opportunityScore,
                });

                this.dashboard.broadcastAlert({
                    type: "info",
                    message: `New pool discovered: ${pool.address} (${pool.dexType})`,
                });
            });

            await this.eventListener.startMonitoring();
            await this.poolDiscoveryService.start();

            // Start vault service if configured
            if (this.vaultService) {
                this.vaultService.startEventListening();

                // Relay vault events to the dashboard as alerts
                this.vaultService.on("deposited", (data: any) => {
                    this.dashboard.broadcastAlert({
                        type: "info",
                        message: `Vault: new deposit ${ethers.formatEther(data.amount)} ETH from ${data.user.slice(0, 10)}…`,
                    });
                });

                this.vaultService.on("withdrawn", (data: any) => {
                    this.dashboard.broadcastAlert({
                        type: "info",
                        message: `Vault: withdrawal ${ethers.formatEther(data.total)} ETH by ${data.user.slice(0, 10)}…`,
                    });
                });

                this.vaultService.on("profitDistributed", (data: any) => {
                    logger.info("Vault profit distribution confirmed", {
                        txHash: data.txHash,
                        profitEth: ethers.formatEther(data.profitWei),
                    });
                });

                logger.info("VaultService started", {
                    vaultAddress: config.vaultAddress,
                });
            }

            this.dashboard.start();
            this._startExecutionLoop();
            this._startMetricsLoop();
            this._startMaintenanceLoop();

            logger.info("ArbitrageBot started successfully");
        } catch (error) {
            logger.error("Failed to start bot", { error });
            throw error;
        }
    }

    async stop(): Promise<void> {
        try {
            logger.info("Stopping ArbitrageBot…");

            this.runtime.isRunning = false;

            if (this.executionLoop) clearInterval(this.executionLoop);
            if (this.metricsLoop) clearInterval(this.metricsLoop);
            if (this.maintenanceLoop) clearInterval(this.maintenanceLoop);

            await this.eventListener.stop();
            await this.poolDiscoveryService.stop();
            if (this.vaultService) this.vaultService.stop();
            this.dashboard.stop();
            this.profitTracker.close();

            logger.info("ArbitrageBot stopped");
        } catch (error) {
            logger.error("Error stopping bot", { error });
        }
    }

    async pause(): Promise<void> {
        this.runtime.isPaused = true;
        logger.info("Bot paused");
        this.dashboard.broadcastAlert({
            type: "info",
            message: "Bot execution paused",
        });
    }

    async resume(): Promise<void> {
        this.runtime.isPaused = false;
        logger.info("Bot resumed");
        this.dashboard.broadcastAlert({
            type: "info",
            message: "Bot execution resumed",
        });
    }

    /**
     * Main execution loop — scans for arbitrage and executes when profitable
     */
    private _startExecutionLoop(): void {
        this.executionLoop = setInterval(async () => {
            if (!this.runtime.isRunning || this.runtime.isPaused) return;
            if (this.executionLoopBusy) return;
            this.executionLoopBusy = true;

            try {
                const opportunities =
                    await this.opportunityDetector.detectSimpleOpportunities();

                if (opportunities.length === 0) return;

                this.runtime.opportunitiesFound += opportunities.length;

                for (const opportunity of opportunities) {
                    await this._processOpportunity(opportunity);
                }

                this.runtime.lastOpportunityTime = Date.now();
            } catch (error) {
                logger.error("Error in execution loop", { error });
                this.dashboard.broadcastAlert({
                    type: "error",
                    message: `Execution loop error: ${(error as Error).message}`,
                });
            } finally {
                this.executionLoopBusy = false;
            }
        }, config.monitoringInterval);

        logger.info("Execution loop started");
    }

    private _startMetricsLoop(): void {
        this.metricsLoop = setInterval(() => {
            try {
                const metrics = this.profitTracker.getMetrics();
                this.dashboard.broadcastMetricsUpdate(metrics);

                if (Date.now() % (60 * 60 * 1000) < config.monitoringInterval) {
                    this.profitTracker.saveMetricsSnapshot(metrics);
                }
            } catch (error) {
                logger.error("Error collecting metrics", { error });
            }
        }, 5000);

        logger.info("Metrics loop started");
    }

    private _startMaintenanceLoop(): void {
        this.maintenanceLoop = setInterval(async () => {
            try {
                const today = new Date().toISOString().split("T")[0];
                this.profitTracker.calculateDailySummary(today);

                if (
                    Date.now() % (24 * 60 * 60 * 1000) <
                    config.monitoringInterval
                ) {
                    this.profitTracker.cleanOldData(90);
                }

                const cbStatus = this.gasOptimizer.getCircuitBreakerStatus();
                if (cbStatus.isActive) {
                    this.dashboard.broadcastAlert({
                        type: "warning",
                        message: `Circuit breaker active: ${cbStatus.consecutiveFailures} consecutive failures`,
                    });
                }

                logger.info(
                    "Daily statistics",
                    this.gasOptimizer.getDailyStats(),
                );
            } catch (error) {
                logger.error("Error in maintenance loop", { error });
            }
        }, 60_000);

        logger.info("Maintenance loop started");
    }

    private async _processOpportunity(
        opportunity: ArbitrageOpportunity,
    ): Promise<void> {
        const routeKey = opportunity.route.map((h) => h.pool).join("-");
        const cooldownUntil = this.routeCooldowns.get(routeKey) ?? 0;

        if (this.inFlightOpportunities.has(opportunity.id)) return;
        if (this.activeRoutes.has(routeKey)) return;
        if (cooldownUntil > Date.now()) {
            logger.debug("Route in cooldown after recent execution", {
                id: opportunity.id,
                routeKey,
                cooldownMsRemaining: cooldownUntil - Date.now(),
            });
            return;
        }

        this.inFlightOpportunities.add(opportunity.id);
        this.activeRoutes.add(routeKey);

        try {
            logger.info("Processing opportunity", {
                id: opportunity.id,
                profitPercentage: opportunity.profitPercentage,
                estimatedProfit: opportunity.estimatedProfit,
            });

            const { shouldExecute, reason, profitAfterGas } =
                await this.gasOptimizer.shouldExecuteOpportunity(opportunity);

            if (!shouldExecute) {
                logger.debug("Opportunity rejected", {
                    id: opportunity.id,
                    reason,
                });
                return;
            }

            const gasMetrics = await this.gasOptimizer.getGasMetrics();
            // Preserve low testnet gas prices (e.g. 0.006 gwei on Base Sepolia).
            // Rounding up to whole gwei can make transactions fail with
            // "insufficient funds for intrinsic transaction cost".
            const gasPriceGwei = Math.max(gasMetrics.currentGasPrice, 0.001);
            const gasPrice = ethers.parseUnits(
                gasPriceGwei.toFixed(6),
                "gwei",
            );

            const tokenIn = opportunity.route[0].tokenIn;
            const erc20 = new ethers.Contract(
                tokenIn,
                [
                    "function balanceOf(address) view returns (uint256)",
                    "function decimals() view returns (uint8)",
                ],
                this.provider,
            );
            const [botBalance, decimalsRaw] = await Promise.all([
                erc20.balanceOf(config.contractAddress) as Promise<bigint>,
                erc20.decimals().catch(() => 18),
            ]);
            const tokenDecimals =
                typeof decimalsRaw === "number"
                    ? decimalsRaw
                    : Number(decimalsRaw);
            const MIN_TRADE_SIZE = this.getMinTradeSize(tokenIn, tokenDecimals);
            const initialAmountCandidate = this.getInitialTradeSize(
                tokenIn,
                botBalance,
                tokenDecimals,
            );
            logger.warn("Balance check", {
                tokenIn,
                tokenDecimals,
                tokenBalance: botBalance.toString(),
                amountIn: initialAmountCandidate.toString(),
                minSize: MIN_TRADE_SIZE.toString(),
                passes: botBalance >= MIN_TRADE_SIZE,
                useFlashLoan: config.flashLoanEnabled,
            });
            if (!config.flashLoanEnabled && botBalance < MIN_TRADE_SIZE) {
                logger.warn("Skipping: bot tokenIn balance below minimum trade size", {
                    id: opportunity.id,
                    tokenIn,
                    tokenDecimals,
                    balance: botBalance.toString(),
                    minimum: MIN_TRADE_SIZE.toString(),
                });
                return;
            }

            logger.info("Opportunity approved", {
                id: opportunity.id,
                profitAfterGas,
                tokenIn,
                tokenBalance: botBalance.toString(),
                minTradeSize: MIN_TRADE_SIZE.toString(),
            });
            const initialAmount = initialAmountCandidate;

            const txParams =
                await this.transactionBuilder.buildOpportunityTransaction(
                    opportunity,
                    config.contractAddress,
                    initialAmount,
                    gasPrice,
                    config.flashLoanEnabled,
                );

            if (!txParams) {
                return;
            }

            const simulation =
                await this.transactionBuilder.simulateTransaction(
                    txParams,
                    new ethers.Wallet(config.privateKey).address,
                );

            if (!simulation.success) {
                logger.warn("Simulation failed", {
                    id: opportunity.id,
                    error: simulation.error,
                });
                this.gasOptimizer.recordExecution({
                    profit: 0,
                    gasCost: 0,
                    success: false,
                });
                return;
            }

            const result =
                await this.transactionSubmitter.submitTransaction(txParams);

            if (!result.hash) {
                logger.warn("No transaction hash returned from submitter", {
                    id: opportunity.id,
                    status: result.status,
                });
                this.gasOptimizer.recordExecution({
                    profit: 0,
                    gasCost: 0,
                    success: false,
                });
                return;
            }

            if (!this.isValidTransactionHash(result.hash)) {
                logger.warn("Rejecting non-canonical transaction hash from submitter", {
                    id: opportunity.id,
                    status: result.status,
                    txHash: result.hash,
                });
                this.gasOptimizer.recordExecution({
                    profit: 0,
                    gasCost: 0,
                    success: false,
                });
                return;
            }

            this.profitTracker.recordExecution(result, opportunity.id, opportunity.route[0].dexType);
            this.gasOptimizer.recordExecution({
                profit: result.realizedUsdEquivalent ?? result.profitMade,
                gasCost: result.gasCostActual,
                success: result.status === "success",
            });
            this.routeCooldowns.set(routeKey, Date.now() + this.routeCooldownMs);

            // Distribute profit to vault after a successful trade
            if (
                result.status === "success" &&
                result.realizedToken?.toLowerCase() ===
                    config.profitTokenAddress.toLowerCase() &&
                (result.realizedDelta ?? 0) > 0 &&
                this.vaultService
            ) {
                try {
                    const profitUnits = ethers.parseUnits(
                        Math.max(result.realizedDelta ?? 0, 0).toFixed(6),
                        6
                    );
                    if (profitUnits > 0n) {
                        // Use batched accumulation
                        await this.vaultService.accumulateAndDistribute(
                            profitUnits,
                        );
                    }
                } catch (vaultError) {
                    // Vault distribution failure MUST NOT stop bot execution
                    logger.error("Failed to distribute profit to vault", {
                        error: vaultError,
                        realizedDelta: result.realizedDelta,
                        txHash: result.hash,
                    });
                }
            }

            this.dashboard.broadcastTradeUpdate({
                timestamp: result.timestamp,
                txHash: result.hash,
                profit: result.profitMade,
                gasCost: result.gasCostActual,
                netProfit: result.netProfit,
                dexType: opportunity.route[0].dexType,
                success: result.status === "success",
                realizedTokenSymbol: result.realizedTokenSymbol,
                realizedDelta: result.realizedDelta,
                realizedUsdEquivalent: result.realizedUsdEquivalent,
                gasCostUsd: result.gasCostUsd,
                profitSource: result.profitSource,
            });

            this.runtime.opportunitiesExecuted++;

            if (result.status === "success") {
                logger.info("Opportunity executed", {
                    id: opportunity.id,
                    txHash: result.hash,
                    status: result.status,
                });
            } else if (result.status === "pending") {
                logger.info("Opportunity submitted to mempool", {
                    id: opportunity.id,
                    txHash: result.hash,
                    status: result.status,
                });
            } else {
                logger.warn("Opportunity execution failed", {
                    id: opportunity.id,
                    txHash: result.hash,
                    status: result.status,
                });
            }
        } catch (error) {
            logger.error("Error processing opportunity", { error });
            this.dashboard.broadcastAlert({
                type: "error",
                message: `Failed to process opportunity: ${(error as Error).message}`,
            });
        } finally {
            this.inFlightOpportunities.delete(opportunity.id);
            this.activeRoutes.delete(routeKey);
        }
    }

    private _setupDashboardCallbacks(): void {
        this.dashboard.onBotPause(async () => {
            await this.pause();
        });
        this.dashboard.onBotResume(async () => {
            await this.resume();
        });
        this.dashboard.onBotMetrics(() => this.profitTracker.getMetrics());
        this.dashboard.onBotTrades(() => {
            const end = Date.now();
            return this.profitTracker.getTradesByPeriod(end - 3_600_000, end);
        });
        this.dashboard.onBotAlerts(() => []);
        this.dashboard.onBotDEXes(() => {
            const factoryMap = this.poolDiscoveryService.getFactoryAddresses();
            const pools = this.poolDiscoveryService.getDiscoveredPools();
            return Array.from(factoryMap.entries()).map(([dexType, factory]) => ({
                dexType,
                factory,
                poolCount: pools.filter((p) => p.dexType === dexType).length,
            }));
        });
    }

    private getMinTradeSize(tokenAddress: string, decimals: number): bigint {
        const normalized = tokenAddress.toLowerCase();
        const wrappedNative =
            this.wrappedNativeByChain[config.chain].toLowerCase();

        // Keep WETH minimum at 0.001 to avoid dust trades.
        if (normalized === wrappedNative) {
            return 1_000_000_000_000_000n;
        }

        // For 6-decimal stablecoins (USDC/USDT), require >= 1 whole token.
        if (decimals === 6) {
            return 1_000_000n;
        }

        // Generic fallback: 0.001 token units for other ERC20s.
        const safeDecimals = Math.max(0, Math.min(decimals, 18));
        return 10n ** BigInt(Math.max(safeDecimals - 3, 0));
    }

    private getInitialTradeSize(
        tokenAddress: string,
        balance: bigint,
        decimals: number,
    ): bigint {
        const normalized = tokenAddress.toLowerCase();
        const wrappedNative =
            this.wrappedNativeByChain[config.chain].toLowerCase();
        let candidate = (balance * 3n) / 10n;

        if (config.chain === ChainType.BASE_SEPOLIA) {
            if (normalized === wrappedNative) {
                const cap = config.maxTradeSizeWeth;
                candidate = candidate > cap ? cap : candidate;
            } else if (decimals === 6) {
                const cap = config.maxTradeSizeUsdc;
                candidate = candidate > cap ? cap : candidate;
            }
        }

        return candidate > 0n ? candidate : 0n;
    }

    private isValidTransactionHash(hash: string): boolean {
        return /^0x[a-fA-F0-9]{64}$/.test(hash);
    }

    async getStats() {
        const vaultStats = this.vaultService
            ? await this.vaultService.getVaultStats().catch(() => null)
            : null;

        return {
            ...this.runtime,
            uptime: Date.now() - this.runtime.startTime,
            metrics: this.profitTracker.getMetrics(),
            gasOptimizerStats: this.gasOptimizer.getDailyStats(),
            circuitBreakerStatus: this.gasOptimizer.getCircuitBreakerStatus(),
            discoveryStats: this.poolDiscoveryService.getStats(),
            poolCount: this.poolDiscoveryService.getDiscoveredPools().length,
            vault: vaultStats
                ? {
                      activePrincipalEth: ethers.formatEther(
                          vaultStats.activePrincipal,
                      ),
                      pausedPrincipalEth: ethers.formatEther(
                          vaultStats.pausedPrincipal,
                      ),
                      userCount: vaultStats.userCount.toString(),
                      lifetimeProfitEth: ethers.formatEther(
                          vaultStats.lifetimeProfitDistributed,
                      ),
                      feeBps: vaultStats.currentFeeBps.toString(),
                      pendingDistributionEth: ethers.formatEther(
                          this.vaultService!.getPendingDistributionWei(),
                      ),
                  }
                : null,
        };
    }

    setupSignalHandlers(): void {
        process.on("SIGINT", async () => {
            logger.info("SIGINT received — shutting down");
            await this.stop();
            process.exit(0);
        });

        process.on("SIGTERM", async () => {
            logger.info("SIGTERM received — shutting down");
            await this.stop();
            process.exit(0);
        });

        process.on("uncaughtException", (error) => {
            logger.error("Uncaught exception", { error });
            this.dashboard.broadcastAlert({
                type: "error",
                message: `Uncaught: ${error.message}`,
            });
        });

        process.on("unhandledRejection", (reason) => {
            logger.error("Unhandled rejection", { reason });
            this.dashboard.broadcastAlert({
                type: "error",
                message: `Unhandled rejection: ${reason}`,
            });
        });
    }
}

async function main() {
    try {
        const bot = new ArbitrageBot();
        bot.setupSignalHandlers();
        await bot.start();
        logger.info("Bot running — dashboard at http://localhost:3000");
        await new Promise(() => {});
    } catch (error) {
        console.error("Fatal error:", error);
        logger.error("Fatal error", { error });
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

export default ArbitrageBot;
