"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ArbitrageBot = void 0;
const ethers_1 = require("ethers");
const config_1 = __importDefault(require("./config"));
const logger_1 = __importDefault(require("./utils/logger"));
const eventListener_1 = require("./core/eventListener");
const opportunityDetector_1 = require("./core/opportunityDetector");
const routeCalculator_1 = require("./core/routeCalculator");
const poolDiscoveryService_1 = require("./core/poolDiscoveryService");
const gasOptimizer_1 = __importDefault(require("./execution/gasOptimizer"));
const transactionBuilder_1 = __importDefault(require("./execution/transactionBuilder"));
const transactionSubmitter_1 = __importDefault(require("./execution/transactionSubmitter"));
const profitTracker_1 = __importDefault(require("./monitoring/profitTracker"));
const dashboard_1 = __importDefault(require("./monitoring/dashboard"));
const VaultService_1 = require("./services/VaultService");
const types_1 = require("./types");
class ArbitrageBot {
    constructor() {
        this.wrappedNativeByChain = {
            [types_1.ChainType.BASE_MAINNET]: "0x4200000000000000000000000000000000000006",
            [types_1.ChainType.BASE_SEPOLIA]: "0x4200000000000000000000000000000000000006",
            [types_1.ChainType.ARBITRUM_MAINNET]: "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
            [types_1.ChainType.ARBITRUM_SEPOLIA]: "0x980b62da83eff3d4576c6479938c2e87f5f3bc7a",
        };
        this.vaultService = null;
        this.priceCache = {};
        this.inFlightOpportunities = new Set();
        this.activeRoutes = new Set();
        this.routeCooldowns = new Map();
        this.executionLoopBusy = false;
        this.routeCooldownMs = 30000;
        this.runtime = {
            isRunning: false,
            isPaused: false,
            startTime: 0,
            opportunitiesFound: 0,
            opportunitiesExecuted: 0,
            lastOpportunityTime: 0,
        };
        this.provider = new ethers_1.ethers.JsonRpcProvider(config_1.default.rpcUrl);
        this.eventListener = new eventListener_1.EventListener(config_1.default.wsUrl, [], config_1.default.rpcUrl);
        this.opportunityDetector = new opportunityDetector_1.OpportunityDetector([], this.provider, 0.3);
        this.routeCalculator = new routeCalculator_1.RouteCalculator([]);
        this.poolDiscoveryService = new poolDiscoveryService_1.PoolDiscoveryService(config_1.default.rpcUrl, config_1.default.dexRegistryAddress, {
            minTVL: 0,
            minVolume24h: 0,
            minPoolAge: 0,
            discoveryInterval: 120000,
            metricsRefreshInterval: 300000,
            chain: config_1.default.chain,
        });
        this.gasOptimizer = new gasOptimizer_1.default(config_1.default.rpcUrl, {
            maxGasPriceGwei: config_1.default.maxGasPriceGwei,
            minProfitBps: config_1.default.minProfitBps,
            dailyLossLimit: 100,
            gasMultiplier: 1.2,
        });
        this.transactionBuilder = new transactionBuilder_1.default(this.provider);
        const useMEVBundle = config_1.default.chain === types_1.ChainType.BASE_MAINNET ||
            config_1.default.chain === types_1.ChainType.ARBITRUM_MAINNET;
        this.transactionSubmitter = new transactionSubmitter_1.default(config_1.default.rpcUrl, config_1.default.privateKey, useMEVBundle);
        this.profitTracker = new profitTracker_1.default(`./bot-data-${config_1.default.chain}.db`);
        this.dashboard = new dashboard_1.default({
            port: 3000,
            enableCors: true,
            vaultAddress: config_1.default.vaultAddress,
            rpcUrl: config_1.default.rpcUrl,
            chain: config_1.default.chain,
        });
        // VaultService is optional — only active when VAULT_ADDRESS is configured
        if (config_1.default.vaultAddress) {
            this.vaultService = new VaultService_1.VaultService(config_1.default.rpcUrl, config_1.default.vaultAddress, config_1.default.privateKey, config_1.default.contractAddress // Pass the bot address
            );
        }
        this._setupDashboardCallbacks();
        logger_1.default.info("ArbitrageBot initialised", {
            chain: config_1.default.chain,
            contractAddress: config_1.default.contractAddress,
            registryAddress: config_1.default.dexRegistryAddress,
            vaultAddress: config_1.default.vaultAddress || "not configured",
        });
    }
    /**
     * Start the bot — verifies connection, boots all services, and wires event streams
     */
    async start() {
        try {
            logger_1.default.info("Starting ArbitrageBot…");
            const network = await this.provider.getNetwork();
            logger_1.default.info("Connected to network", {
                name: network.name,
                chainId: network.chainId,
            });
            if (config_1.default.contractAddress &&
                config_1.default.contractAddress !== "0x" + "0".repeat(40)) {
                let code = "0x";
                for (let attempt = 1; attempt <= 3; attempt++) {
                    try {
                        code = await this.provider.getCode(config_1.default.contractAddress);
                        if (code !== "0x")
                            break;
                    }
                    catch (e) {
                        logger_1.default.warn(`Contract verification attempt ${attempt}/3 failed`, { error: e.message });
                    }
                    if (attempt < 3)
                        await new Promise(r => setTimeout(r, 2000));
                }
                if (code === "0x") {
                    logger_1.default.warn("ArbitrageBot contract not found at specified address — execution paused. Verify CONTRACT_ADDRESS and RPC_URL point to the same network.", { contractAddress: config_1.default.contractAddress, chainId: network.chainId });
                    this.runtime.isPaused = true;
                }
                else {
                    logger_1.default.info("Contract verified on-chain", { contractAddress: config_1.default.contractAddress });
                }
            }
            else {
                logger_1.default.warn("No valid CONTRACT_ADDRESS — skipping contract verification");
                this.runtime.isPaused = true;
            }
            this.runtime.isRunning = true;
            this.runtime.startTime = Date.now();
            this.runtime.isPaused = false;
            // Wire price updates from EventListener into both detectors
            this.eventListener.on("priceUpdate", (update) => {
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
                logger_1.default.error("EventListener hit max reconnect attempts — pausing bot");
                this.pause();
            });
            // Wire pool discovery into all consumers
            this.poolDiscoveryService.on("poolDiscovered", (candidate) => {
                const pool = {
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
                logger_1.default.info("New pool added to bot", {
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
                this.vaultService.on("deposited", (data) => {
                    this.dashboard.broadcastAlert({
                        type: "info",
                        message: `Vault: new deposit ${ethers_1.ethers.formatEther(data.amount)} ETH from ${data.user.slice(0, 10)}…`,
                    });
                });
                this.vaultService.on("withdrawn", (data) => {
                    this.dashboard.broadcastAlert({
                        type: "info",
                        message: `Vault: withdrawal ${ethers_1.ethers.formatEther(data.total)} ETH by ${data.user.slice(0, 10)}…`,
                    });
                });
                this.vaultService.on("profitDistributed", (data) => {
                    logger_1.default.info("Vault profit distribution confirmed", {
                        txHash: data.txHash,
                        profitEth: ethers_1.ethers.formatEther(data.profitWei),
                    });
                });
                logger_1.default.info("VaultService started", {
                    vaultAddress: config_1.default.vaultAddress,
                });
            }
            this.dashboard.start();
            this._startExecutionLoop();
            this._startMetricsLoop();
            this._startMaintenanceLoop();
            logger_1.default.info("ArbitrageBot started successfully");
        }
        catch (error) {
            logger_1.default.error("Failed to start bot", { error });
            throw error;
        }
    }
    async stop() {
        try {
            logger_1.default.info("Stopping ArbitrageBot…");
            this.runtime.isRunning = false;
            if (this.executionLoop)
                clearInterval(this.executionLoop);
            if (this.metricsLoop)
                clearInterval(this.metricsLoop);
            if (this.maintenanceLoop)
                clearInterval(this.maintenanceLoop);
            await this.eventListener.stop();
            await this.poolDiscoveryService.stop();
            if (this.vaultService)
                this.vaultService.stop();
            this.dashboard.stop();
            this.profitTracker.close();
            logger_1.default.info("ArbitrageBot stopped");
        }
        catch (error) {
            logger_1.default.error("Error stopping bot", { error });
        }
    }
    async pause() {
        this.runtime.isPaused = true;
        logger_1.default.info("Bot paused");
        this.dashboard.broadcastAlert({
            type: "info",
            message: "Bot execution paused",
        });
    }
    async resume() {
        this.runtime.isPaused = false;
        logger_1.default.info("Bot resumed");
        this.dashboard.broadcastAlert({
            type: "info",
            message: "Bot execution resumed",
        });
    }
    /**
     * Main execution loop — scans for arbitrage and executes when profitable
     */
    _startExecutionLoop() {
        this.executionLoop = setInterval(async () => {
            if (!this.runtime.isRunning || this.runtime.isPaused)
                return;
            if (this.executionLoopBusy)
                return;
            this.executionLoopBusy = true;
            try {
                const opportunities = await this.opportunityDetector.detectSimpleOpportunities();
                if (opportunities.length === 0)
                    return;
                this.runtime.opportunitiesFound += opportunities.length;
                for (const opportunity of opportunities) {
                    await this._processOpportunity(opportunity);
                }
                this.runtime.lastOpportunityTime = Date.now();
            }
            catch (error) {
                logger_1.default.error("Error in execution loop", { error });
                this.dashboard.broadcastAlert({
                    type: "error",
                    message: `Execution loop error: ${error.message}`,
                });
            }
            finally {
                this.executionLoopBusy = false;
            }
        }, config_1.default.monitoringInterval);
        logger_1.default.info("Execution loop started");
    }
    _startMetricsLoop() {
        this.metricsLoop = setInterval(() => {
            try {
                const metrics = this.profitTracker.getMetrics();
                this.dashboard.broadcastMetricsUpdate(metrics);
                if (Date.now() % (60 * 60 * 1000) < config_1.default.monitoringInterval) {
                    this.profitTracker.saveMetricsSnapshot(metrics);
                }
            }
            catch (error) {
                logger_1.default.error("Error collecting metrics", { error });
            }
        }, 5000);
        logger_1.default.info("Metrics loop started");
    }
    _startMaintenanceLoop() {
        this.maintenanceLoop = setInterval(async () => {
            try {
                const today = new Date().toISOString().split("T")[0];
                this.profitTracker.calculateDailySummary(today);
                if (Date.now() % (24 * 60 * 60 * 1000) <
                    config_1.default.monitoringInterval) {
                    this.profitTracker.cleanOldData(90);
                }
                const cbStatus = this.gasOptimizer.getCircuitBreakerStatus();
                if (cbStatus.isActive) {
                    this.dashboard.broadcastAlert({
                        type: "warning",
                        message: `Circuit breaker active: ${cbStatus.consecutiveFailures} consecutive failures`,
                    });
                }
                logger_1.default.info("Daily statistics", this.gasOptimizer.getDailyStats());
            }
            catch (error) {
                logger_1.default.error("Error in maintenance loop", { error });
            }
        }, 60000);
        logger_1.default.info("Maintenance loop started");
    }
    async _processOpportunity(opportunity) {
        const routeKey = opportunity.route.map((h) => h.pool).join("-");
        const cooldownUntil = this.routeCooldowns.get(routeKey) ?? 0;
        if (this.inFlightOpportunities.has(opportunity.id))
            return;
        if (this.activeRoutes.has(routeKey))
            return;
        if (cooldownUntil > Date.now()) {
            logger_1.default.debug("Route in cooldown after recent execution", {
                id: opportunity.id,
                routeKey,
                cooldownMsRemaining: cooldownUntil - Date.now(),
            });
            return;
        }
        this.inFlightOpportunities.add(opportunity.id);
        this.activeRoutes.add(routeKey);
        try {
            logger_1.default.info("Processing opportunity", {
                id: opportunity.id,
                profitPercentage: opportunity.profitPercentage,
                estimatedProfit: opportunity.estimatedProfit,
            });
            const { shouldExecute, reason, profitAfterGas } = await this.gasOptimizer.shouldExecuteOpportunity(opportunity);
            if (!shouldExecute) {
                logger_1.default.debug("Opportunity rejected", {
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
            const gasPrice = ethers_1.ethers.parseUnits(gasPriceGwei.toFixed(6), "gwei");
            const tokenIn = opportunity.route[0].tokenIn;
            const erc20 = new ethers_1.ethers.Contract(tokenIn, [
                "function balanceOf(address) view returns (uint256)",
                "function decimals() view returns (uint8)",
            ], this.provider);
            const [botBalance, decimalsRaw] = await Promise.all([
                erc20.balanceOf(config_1.default.contractAddress),
                erc20.decimals().catch(() => 18),
            ]);
            const tokenDecimals = typeof decimalsRaw === "number"
                ? decimalsRaw
                : Number(decimalsRaw);
            const MIN_TRADE_SIZE = this.getMinTradeSize(tokenIn, tokenDecimals);
            const initialAmountCandidate = this.getInitialTradeSize(tokenIn, botBalance, tokenDecimals);
            logger_1.default.warn("Balance check", {
                tokenIn,
                tokenDecimals,
                tokenBalance: botBalance.toString(),
                amountIn: initialAmountCandidate.toString(),
                minSize: MIN_TRADE_SIZE.toString(),
                passes: botBalance >= MIN_TRADE_SIZE,
                useFlashLoan: config_1.default.flashLoanEnabled,
            });
            if (!config_1.default.flashLoanEnabled && botBalance < MIN_TRADE_SIZE) {
                logger_1.default.warn("Skipping: bot tokenIn balance below minimum trade size", {
                    id: opportunity.id,
                    tokenIn,
                    tokenDecimals,
                    balance: botBalance.toString(),
                    minimum: MIN_TRADE_SIZE.toString(),
                });
                return;
            }
            logger_1.default.info("Opportunity approved", {
                id: opportunity.id,
                profitAfterGas,
                tokenIn,
                tokenBalance: botBalance.toString(),
                minTradeSize: MIN_TRADE_SIZE.toString(),
            });
            const initialAmount = initialAmountCandidate;
            const txParams = await this.transactionBuilder.buildOpportunityTransaction(opportunity, config_1.default.contractAddress, initialAmount, gasPrice, config_1.default.flashLoanEnabled);
            if (!txParams) {
                return;
            }
            const simulation = await this.transactionBuilder.simulateTransaction(txParams, new ethers_1.ethers.Wallet(config_1.default.privateKey).address);
            if (!simulation.success) {
                logger_1.default.warn("Simulation failed", {
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
            const result = await this.transactionSubmitter.submitTransaction(txParams);
            if (!result.hash) {
                logger_1.default.warn("No transaction hash returned from submitter", {
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
                logger_1.default.warn("Rejecting non-canonical transaction hash from submitter", {
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
            if (result.status === "success" &&
                result.realizedToken?.toLowerCase() ===
                    config_1.default.profitTokenAddress.toLowerCase() &&
                (result.realizedDelta ?? 0) > 0 &&
                this.vaultService) {
                try {
                    const profitUnits = ethers_1.ethers.parseUnits(Math.max(result.realizedDelta ?? 0, 0).toFixed(6), 6);
                    if (profitUnits > 0n) {
                        // Use batched accumulation
                        await this.vaultService.accumulateAndDistribute(profitUnits);
                    }
                }
                catch (vaultError) {
                    // Vault distribution failure MUST NOT stop bot execution
                    logger_1.default.error("Failed to distribute profit to vault", {
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
                logger_1.default.info("Opportunity executed", {
                    id: opportunity.id,
                    txHash: result.hash,
                    status: result.status,
                });
            }
            else if (result.status === "pending") {
                logger_1.default.info("Opportunity submitted to mempool", {
                    id: opportunity.id,
                    txHash: result.hash,
                    status: result.status,
                });
            }
            else {
                logger_1.default.warn("Opportunity execution failed", {
                    id: opportunity.id,
                    txHash: result.hash,
                    status: result.status,
                });
            }
        }
        catch (error) {
            logger_1.default.error("Error processing opportunity", { error });
            this.dashboard.broadcastAlert({
                type: "error",
                message: `Failed to process opportunity: ${error.message}`,
            });
        }
        finally {
            this.inFlightOpportunities.delete(opportunity.id);
            this.activeRoutes.delete(routeKey);
        }
    }
    _setupDashboardCallbacks() {
        this.dashboard.onBotPause(async () => {
            await this.pause();
        });
        this.dashboard.onBotResume(async () => {
            await this.resume();
        });
        this.dashboard.onBotMetrics(() => this.profitTracker.getMetrics());
        this.dashboard.onBotTrades(() => {
            const end = Date.now();
            return this.profitTracker.getTradesByPeriod(end - 3600000, end);
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
    getMinTradeSize(tokenAddress, decimals) {
        const normalized = tokenAddress.toLowerCase();
        const wrappedNative = this.wrappedNativeByChain[config_1.default.chain].toLowerCase();
        // Keep WETH minimum at 0.001 to avoid dust trades.
        if (normalized === wrappedNative) {
            return 1000000000000000n;
        }
        // For 6-decimal stablecoins (USDC/USDT), require >= 1 whole token.
        if (decimals === 6) {
            return 1000000n;
        }
        // Generic fallback: 0.001 token units for other ERC20s.
        const safeDecimals = Math.max(0, Math.min(decimals, 18));
        return 10n ** BigInt(Math.max(safeDecimals - 3, 0));
    }
    getInitialTradeSize(tokenAddress, balance, decimals) {
        const normalized = tokenAddress.toLowerCase();
        const wrappedNative = this.wrappedNativeByChain[config_1.default.chain].toLowerCase();
        let candidate = (balance * 3n) / 10n;
        if (config_1.default.chain === types_1.ChainType.BASE_SEPOLIA) {
            if (normalized === wrappedNative) {
                const cap = config_1.default.maxTradeSizeWeth;
                candidate = candidate > cap ? cap : candidate;
            }
            else if (decimals === 6) {
                const cap = config_1.default.maxTradeSizeUsdc;
                candidate = candidate > cap ? cap : candidate;
            }
        }
        return candidate > 0n ? candidate : 0n;
    }
    isValidTransactionHash(hash) {
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
                    activePrincipalEth: ethers_1.ethers.formatEther(vaultStats.activePrincipal),
                    pausedPrincipalEth: ethers_1.ethers.formatEther(vaultStats.pausedPrincipal),
                    userCount: vaultStats.userCount.toString(),
                    lifetimeProfitEth: ethers_1.ethers.formatEther(vaultStats.lifetimeProfitDistributed),
                    feeBps: vaultStats.currentFeeBps.toString(),
                    pendingDistributionEth: ethers_1.ethers.formatEther(this.vaultService.getPendingDistributionWei()),
                }
                : null,
        };
    }
    setupSignalHandlers() {
        process.on("SIGINT", async () => {
            logger_1.default.info("SIGINT received — shutting down");
            await this.stop();
            process.exit(0);
        });
        process.on("SIGTERM", async () => {
            logger_1.default.info("SIGTERM received — shutting down");
            await this.stop();
            process.exit(0);
        });
        process.on("uncaughtException", (error) => {
            logger_1.default.error("Uncaught exception", { error });
            this.dashboard.broadcastAlert({
                type: "error",
                message: `Uncaught: ${error.message}`,
            });
        });
        process.on("unhandledRejection", (reason) => {
            logger_1.default.error("Unhandled rejection", { reason });
            this.dashboard.broadcastAlert({
                type: "error",
                message: `Unhandled rejection: ${reason}`,
            });
        });
    }
}
exports.ArbitrageBot = ArbitrageBot;
async function main() {
    try {
        const bot = new ArbitrageBot();
        bot.setupSignalHandlers();
        await bot.start();
        logger_1.default.info("Bot running — dashboard at http://localhost:3000");
        await new Promise(() => { });
    }
    catch (error) {
        console.error("Fatal error:", error);
        logger_1.default.error("Fatal error", { error });
        process.exit(1);
    }
}
if (require.main === module) {
    main();
}
exports.default = ArbitrageBot;
//# sourceMappingURL=index.js.map