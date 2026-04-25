import { ethers } from "ethers";
import { EventEmitter } from "events";
import logger from "../utils/logger";
import notificationService, { NotificationLevel } from "./NotificationService";

interface VaultStats {
    activePrincipal: bigint;
    pausedPrincipal: bigint;
    userCount: bigint;
    lifetimeProfitDistributed: bigint;
    lifetimeFeesAccrued: bigint;
    currentFeeBps: bigint;
    vaultBalance: bigint;
    unclaimedOperatorFees: bigint;
}

interface UserAccountInfo {
    principal: bigint;
    pendingProfit: bigint;
    claimableProfit: bigint;
    isPaused: boolean;
}

interface ProfitDistributionRecord {
    txHash: string;
    grossProfit: bigint;
    operatorFee: bigint;
    netToUsers: bigint;
    timestamp: number;
    blockNumber: number;
}

const VAULT_ABI = [
    "function distributeProfit(uint256 profitTotal) external",
    "function claimOperatorFees() external",
    "function getVaultStats() external view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256)",
    "function getUserAccount(address user) external view returns (uint256,uint256,uint256,bool)",
    "function getMyAccount() external view returns (uint256,uint256,uint256,uint256,bool,uint256,uint256,uint256,uint256,uint256,bool,bool,address)",
    "function isExecutor(address) external view returns (bool)",
    "function totalActivePrincipal() external view returns (uint256)",
    "function pendingOperatorFees() external view returns (uint256)",
    "function performanceFeeBps() external view returns (uint256)",
    "event Deposited(address indexed user, uint256 amount, uint256 newPrincipal)",
    "event Withdrawn(address indexed user, uint256 profitAmount, uint256 principalAmount, uint256 total)",
    "event ProfitDistributed(uint256 grossProfit, uint256 operatorFee, uint256 netToUsers, uint256 newAccProfitPerUnit)",
    "event OperatorFeesClaimed(address indexed operator, uint256 amount)",
    "event FundsPaused(address indexed user, uint256 principal)",
    "event FundsUnpaused(address indexed user, uint256 principal)",
    "function requestWithdrawal(uint256 profitAmount, uint256 principalAmount) external",
    "function executeWithdrawal() external",
    "function cancelWithdrawal() external",
    "function freezeAccount(address user) external",
    "function initiateUnfreeze() external",
    "function completeUnfreeze() external",
    "function setGuardian(address guardian) external",
    "event WithdrawalRequested(address indexed user, uint256 profit, uint256 principal, uint256 executeAt)",
    "event WithdrawalCancelled(address indexed user)",
    "event AccountFrozen(address indexed user, address indexed by)",
    "event UnfreezeInitiated(address indexed user, uint256 availableAt)",
    "event AccountUnfrozen(address indexed user)",
    "event GuardianSet(address indexed user, address indexed guardian)",
];

const BOT_ABI = [
    "function distributeToVault(uint256 amount) external",
];

export class VaultService extends EventEmitter {
    private provider: ethers.Provider;
    private signer: ethers.Wallet | null = null;
    private vault: ethers.Contract;
    private readonly vaultRead: ethers.Contract;
    private bot: ethers.Contract | null = null;
    private vaultAddress: string;
    private botAddress: string | null = null;

    private isListening: boolean = false;
    private isDistributing: boolean = false;

    private distributionHistory: ProfitDistributionRecord[] = [];
    private readonly MAX_HISTORY = 500;

    private pendingDistributionWei: bigint = 0n;
    private readonly MIN_DISTRIBUTION_UNITS: bigint = BigInt(1_000_000);

    private pollTimer?: NodeJS.Timeout;
    private lastPollBlock: number = 0;
    private readonly POLL_INTERVAL_MS = 15_000;

    constructor(rpcUrls: string | string[], vaultAddress: string, privateKey?: string, botAddress?: string) {
        super();

        if (!vaultAddress || vaultAddress === ethers.ZeroAddress) {
            throw new Error("VaultService: vaultAddress is required");
        }

        const urls = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls];
        if (urls.length > 1) {
            const providers = urls.map(url => new ethers.JsonRpcProvider(url));
            this.provider = new ethers.FallbackProvider(providers);
            logger.info("VaultService: using FallbackProvider", { count: urls.length });
        } else {
            this.provider = new ethers.JsonRpcProvider(urls[0]);
        }

        this.vaultAddress = vaultAddress;
        this.botAddress = botAddress || null;

        if (privateKey && privateKey.startsWith("0x") && privateKey.length === 66) {
            this.signer = new ethers.Wallet(privateKey, this.provider);
        }

        const signerOrProvider = this.signer ?? this.provider;
        this.vault = new ethers.Contract(vaultAddress, VAULT_ABI, signerOrProvider);
        this.vaultRead = new ethers.Contract(vaultAddress, VAULT_ABI, this.provider);

        if (this.botAddress) {
            this.bot = new ethers.Contract(this.botAddress, BOT_ABI, signerOrProvider);
        }

        logger.info("VaultService initialised", {
            vaultAddress,
            botAddress: this.botAddress ?? "not set",
            readOnly: !this.signer,
        });
    }

    /**
     * Distribute arbitrage profit to all active vault depositors.
     * profitUnits represents the amount of USDC (6 decimals) to distribute.
     */
    async distributeProfit(profitUnits: bigint): Promise<string> {
        if (!this.signer) {
            throw new Error("VaultService: no signer — cannot distribute profit");
        }
        if (profitUnits <= 0n) return "";

        const activePrincipal = await this.getActivePrincipal();
        if (activePrincipal === 0n) {
            logger.warn("VaultService: no active principal — skipping distribution");
            return "";
        }

        if (this.isDistributing) return "";

        try {
            this.isDistributing = true;
            let tx;

            if (this.bot) {
                // Optimized: trigger distribution via the bot which holds the USDC
                tx = await this.bot.distributeToVault(profitUnits, { gasLimit: 300_000n });
                logger.info("VaultService: triggered bot.distributeToVault", { txHash: tx.hash, amount: profitUnits.toString() });
            } else {
                // Fallback: try direct distribution from signer (requires USDC allowance)
                tx = await this.vault.distributeProfit(profitUnits, { gasLimit: 200_000n });
                logger.info("VaultService: triggered vault.distributeProfit directly", { txHash: tx.hash, amount: profitUnits.toString() });
            }

            const receipt = await tx.wait(1);
            
            this.distributionHistory.unshift({
                txHash: receipt.hash,
                grossProfit: profitUnits,
                operatorFee: 0n, // Filled by event
                netToUsers: 0n,
                timestamp: Date.now(),
                blockNumber: receipt.blockNumber,
            });

            this.emit("profitDistributed", { txHash: receipt.hash, profitUnits, blockNumber: receipt.blockNumber });
            return receipt.hash;
        } catch (error: any) {
            logger.error("VaultService: distributeProfit failed", { error: error.message });
            throw error;
        } finally {
            this.isDistributing = false;
        }
    }

    async accumulateAndDistribute(profitUnits: bigint): Promise<void> {
        this.pendingDistributionWei += profitUnits;

        if (this.pendingDistributionWei >= this.MIN_DISTRIBUTION_UNITS) {
            const toDistribute = this.pendingDistributionWei;
            this.pendingDistributionWei = 0n;

            try {
                await this.distributeProfit(toDistribute);
            } catch (error) {
                this.pendingDistributionWei += toDistribute;
            }
        }
    }

    async getVaultStats(): Promise<VaultStats> {
        try {
            // Always use provider-backed contract for read calls so UI polling
            // does not depend on signer state and avoids noisy call exceptions.
            const result = await this.vaultRead.getVaultStats();
            return {
                activePrincipal: result[0],
                pausedPrincipal: result[1],
                userCount: result[2],
                lifetimeProfitDistributed: result[3],
                lifetimeFeesAccrued: result[4],
                currentFeeBps: result[5],
                vaultBalance: result[6],
                unclaimedOperatorFees: result[7],
            };
        } catch (error: any) {
            logger.warn("VaultService: getVaultStats failed, returning zeroed stats", {
                error: error?.shortMessage || error?.message || String(error),
            });
            return {
                activePrincipal: 0n,
                pausedPrincipal: 0n,
                userCount: 0n,
                lifetimeProfitDistributed: 0n,
                lifetimeFeesAccrued: 0n,
                currentFeeBps: 0n,
                vaultBalance: 0n,
                unclaimedOperatorFees: 0n,
            };
        }
    }

    async getActivePrincipal(): Promise<bigint> {
        return await this.vault.totalActivePrincipal();
    }

    async getPendingOperatorFees(): Promise<bigint> {
        return await this.vault.pendingOperatorFees();
    }

    async isExecutorAuthorized(address: string): Promise<boolean> {
        return await this.vault.isExecutor(address);
    }

    startEventListening(): void {
        if (this.isListening) return;
        this.isListening = true;

        const poll = async () => {
            if (!this.isListening) return;
            try {
                const currentBlock = await (this.provider as ethers.JsonRpcProvider).getBlockNumber();
                if (this.lastPollBlock === 0) {
                    this.lastPollBlock = currentBlock;
                    return;
                }
                if (currentBlock <= this.lastPollBlock) return;

                const fromBlock = this.lastPollBlock + 1;
                const toBlock = currentBlock;

                const [deposited, withdrawn, profitDist, withdrawReq, frozen, unfreezeInit] = await Promise.all([
                    this.vault.queryFilter(this.vault.filters.Deposited(), fromBlock, toBlock),
                    this.vault.queryFilter(this.vault.filters.Withdrawn(), fromBlock, toBlock),
                    this.vault.queryFilter(this.vault.filters.ProfitDistributed(), fromBlock, toBlock),
                    this.vault.queryFilter(this.vault.filters.WithdrawalRequested(), fromBlock, toBlock),
                    this.vault.queryFilter(this.vault.filters.AccountFrozen(), fromBlock, toBlock),
                    this.vault.queryFilter(this.vault.filters.UnfreezeInitiated(), fromBlock, toBlock),
                ]);

                for (const e of deposited) {
                    const [user, amount, newPrincipal] = (e as ethers.EventLog).args;
                    this.emit("deposited", { user, amount, newPrincipal });
                }

                for (const e of withdrawn) {
                    const [user, profit, principal, total] = (e as ethers.EventLog).args;
                    this.emit("withdrawn", { user, profitAmount: profit, principalAmount: principal, total });
                }

                for (const e of profitDist) {
                    const [gross, fee, net, acc] = (e as ethers.EventLog).args;
                    if (this.distributionHistory.length > 0) {
                        this.distributionHistory[0].operatorFee = fee;
                        this.distributionHistory[0].netToUsers = net;
                    }
                    this.emit("profitDistributedEvent", { grossProfit: gross, operatorFee: fee, netToUsers: net, newAccProfitPerUnit: acc });
                }

                for (const e of withdrawReq) {
                    const [user, profit, principal, executeAt] = (e as ethers.EventLog).args;
                    logger.warn("VaultService: WithdrawalRequested", { user, profit: profit.toString(), principal: principal.toString() });
                    await notificationService.notify({
                        title: "Withdrawal Requested",
                        message: `User ${user} requested withdrawal of ${ethers.formatEther(profit)} profit and ${ethers.formatEther(principal)} principal.`,
                        level: NotificationLevel.WARN,
                        user,
                        metadata: { profit: profit.toString(), principal: principal.toString(), executeAt: executeAt.toString() }
                    });
                    this.emit("withdrawalRequested", { user, profit, principal, executeAt });
                }

                for (const e of frozen) {
                    const [user, by] = (e as ethers.EventLog).args;
                    logger.error("VaultService: AccountFrozen", { user, by });
                    await notificationService.notify({
                        title: "ACCOUNT FROZEN",
                        message: `Account ${user} has been frozen by ${by}. All withdrawals are blocked.`,
                        level: NotificationLevel.CRITICAL,
                        user,
                        metadata: { frozenBy: by }
                    });
                    this.emit("accountFrozen", { user, by });
                }

                for (const e of unfreezeInit) {
                    const [user, availableAt] = (e as ethers.EventLog).args;
                    logger.info("VaultService: UnfreezeInitiated", { user, availableAt: availableAt.toString() });
                    await notificationService.notify({
                        title: "Unfreeze Initiated",
                        message: `Account ${user} has initiated unfreeze. Available after 3-day cooling period.`,
                        level: NotificationLevel.INFO,
                        user,
                        metadata: { availableAt: availableAt.toString() }
                    });
                    this.emit("unfreezeInitiated", { user, availableAt });
                }

                this.lastPollBlock = toBlock;
            } catch (error: any) {
                logger.warn("VaultService: event poll error", { error: error.message });
            }
        };

        poll();
        this.pollTimer = setInterval(poll, this.POLL_INTERVAL_MS);
    }

    getPendingDistributionWei(): bigint {
        return this.pendingDistributionWei;
    }

    stop(): void {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        this.isListening = false;
        logger.info("VaultService: stopped");
    }
}

export default VaultService;
