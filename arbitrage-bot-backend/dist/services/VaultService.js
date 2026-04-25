"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VaultService = void 0;
const ethers_1 = require("ethers");
const events_1 = require("events");
const logger_1 = __importDefault(require("../utils/logger"));
const NotificationService_1 = __importStar(require("./NotificationService"));
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
class VaultService extends events_1.EventEmitter {
    constructor(rpcUrls, vaultAddress, privateKey, botAddress) {
        super();
        this.signer = null;
        this.bot = null;
        this.botAddress = null;
        this.isListening = false;
        this.isDistributing = false;
        this.distributionHistory = [];
        this.MAX_HISTORY = 500;
        this.pendingDistributionWei = 0n;
        this.MIN_DISTRIBUTION_UNITS = BigInt(1000000);
        this.lastPollBlock = 0;
        this.POLL_INTERVAL_MS = 15000;
        if (!vaultAddress || vaultAddress === ethers_1.ethers.ZeroAddress) {
            throw new Error("VaultService: vaultAddress is required");
        }
        const urls = Array.isArray(rpcUrls) ? rpcUrls : [rpcUrls];
        if (urls.length > 1) {
            const providers = urls.map(url => new ethers_1.ethers.JsonRpcProvider(url));
            this.provider = new ethers_1.ethers.FallbackProvider(providers);
            logger_1.default.info("VaultService: using FallbackProvider", { count: urls.length });
        }
        else {
            this.provider = new ethers_1.ethers.JsonRpcProvider(urls[0]);
        }
        this.vaultAddress = vaultAddress;
        this.botAddress = botAddress || null;
        if (privateKey && privateKey.startsWith("0x") && privateKey.length === 66) {
            this.signer = new ethers_1.ethers.Wallet(privateKey, this.provider);
        }
        const signerOrProvider = this.signer ?? this.provider;
        this.vault = new ethers_1.ethers.Contract(vaultAddress, VAULT_ABI, signerOrProvider);
        this.vaultRead = new ethers_1.ethers.Contract(vaultAddress, VAULT_ABI, this.provider);
        if (this.botAddress) {
            this.bot = new ethers_1.ethers.Contract(this.botAddress, BOT_ABI, signerOrProvider);
        }
        logger_1.default.info("VaultService initialised", {
            vaultAddress,
            botAddress: this.botAddress ?? "not set",
            readOnly: !this.signer,
        });
    }
    /**
     * Distribute arbitrage profit to all active vault depositors.
     * profitUnits represents the amount of USDC (6 decimals) to distribute.
     */
    async distributeProfit(profitUnits) {
        if (!this.signer) {
            throw new Error("VaultService: no signer — cannot distribute profit");
        }
        if (profitUnits <= 0n)
            return "";
        const activePrincipal = await this.getActivePrincipal();
        if (activePrincipal === 0n) {
            logger_1.default.warn("VaultService: no active principal — skipping distribution");
            return "";
        }
        if (this.isDistributing)
            return "";
        try {
            this.isDistributing = true;
            let tx;
            if (this.bot) {
                // Optimized: trigger distribution via the bot which holds the USDC
                tx = await this.bot.distributeToVault(profitUnits, { gasLimit: 300000n });
                logger_1.default.info("VaultService: triggered bot.distributeToVault", { txHash: tx.hash, amount: profitUnits.toString() });
            }
            else {
                // Fallback: try direct distribution from signer (requires USDC allowance)
                tx = await this.vault.distributeProfit(profitUnits, { gasLimit: 200000n });
                logger_1.default.info("VaultService: triggered vault.distributeProfit directly", { txHash: tx.hash, amount: profitUnits.toString() });
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
        }
        catch (error) {
            logger_1.default.error("VaultService: distributeProfit failed", { error: error.message });
            throw error;
        }
        finally {
            this.isDistributing = false;
        }
    }
    async accumulateAndDistribute(profitUnits) {
        this.pendingDistributionWei += profitUnits;
        if (this.pendingDistributionWei >= this.MIN_DISTRIBUTION_UNITS) {
            const toDistribute = this.pendingDistributionWei;
            this.pendingDistributionWei = 0n;
            try {
                await this.distributeProfit(toDistribute);
            }
            catch (error) {
                this.pendingDistributionWei += toDistribute;
            }
        }
    }
    async getVaultStats() {
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
        }
        catch (error) {
            logger_1.default.warn("VaultService: getVaultStats failed, returning zeroed stats", {
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
    async getActivePrincipal() {
        return await this.vault.totalActivePrincipal();
    }
    async getPendingOperatorFees() {
        return await this.vault.pendingOperatorFees();
    }
    async isExecutorAuthorized(address) {
        return await this.vault.isExecutor(address);
    }
    startEventListening() {
        if (this.isListening)
            return;
        this.isListening = true;
        const poll = async () => {
            if (!this.isListening)
                return;
            try {
                const currentBlock = await this.provider.getBlockNumber();
                if (this.lastPollBlock === 0) {
                    this.lastPollBlock = currentBlock;
                    return;
                }
                if (currentBlock <= this.lastPollBlock)
                    return;
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
                    const [user, amount, newPrincipal] = e.args;
                    this.emit("deposited", { user, amount, newPrincipal });
                }
                for (const e of withdrawn) {
                    const [user, profit, principal, total] = e.args;
                    this.emit("withdrawn", { user, profitAmount: profit, principalAmount: principal, total });
                }
                for (const e of profitDist) {
                    const [gross, fee, net, acc] = e.args;
                    if (this.distributionHistory.length > 0) {
                        this.distributionHistory[0].operatorFee = fee;
                        this.distributionHistory[0].netToUsers = net;
                    }
                    this.emit("profitDistributedEvent", { grossProfit: gross, operatorFee: fee, netToUsers: net, newAccProfitPerUnit: acc });
                }
                for (const e of withdrawReq) {
                    const [user, profit, principal, executeAt] = e.args;
                    logger_1.default.warn("VaultService: WithdrawalRequested", { user, profit: profit.toString(), principal: principal.toString() });
                    await NotificationService_1.default.notify({
                        title: "Withdrawal Requested",
                        message: `User ${user} requested withdrawal of ${ethers_1.ethers.formatEther(profit)} profit and ${ethers_1.ethers.formatEther(principal)} principal.`,
                        level: NotificationService_1.NotificationLevel.WARN,
                        user,
                        metadata: { profit: profit.toString(), principal: principal.toString(), executeAt: executeAt.toString() }
                    });
                    this.emit("withdrawalRequested", { user, profit, principal, executeAt });
                }
                for (const e of frozen) {
                    const [user, by] = e.args;
                    logger_1.default.error("VaultService: AccountFrozen", { user, by });
                    await NotificationService_1.default.notify({
                        title: "ACCOUNT FROZEN",
                        message: `Account ${user} has been frozen by ${by}. All withdrawals are blocked.`,
                        level: NotificationService_1.NotificationLevel.CRITICAL,
                        user,
                        metadata: { frozenBy: by }
                    });
                    this.emit("accountFrozen", { user, by });
                }
                for (const e of unfreezeInit) {
                    const [user, availableAt] = e.args;
                    logger_1.default.info("VaultService: UnfreezeInitiated", { user, availableAt: availableAt.toString() });
                    await NotificationService_1.default.notify({
                        title: "Unfreeze Initiated",
                        message: `Account ${user} has initiated unfreeze. Available after 3-day cooling period.`,
                        level: NotificationService_1.NotificationLevel.INFO,
                        user,
                        metadata: { availableAt: availableAt.toString() }
                    });
                    this.emit("unfreezeInitiated", { user, availableAt });
                }
                this.lastPollBlock = toBlock;
            }
            catch (error) {
                logger_1.default.warn("VaultService: event poll error", { error: error.message });
            }
        };
        poll();
        this.pollTimer = setInterval(poll, this.POLL_INTERVAL_MS);
    }
    getPendingDistributionWei() {
        return this.pendingDistributionWei;
    }
    stop() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        this.isListening = false;
        logger_1.default.info("VaultService: stopped");
    }
}
exports.VaultService = VaultService;
exports.default = VaultService;
//# sourceMappingURL=VaultService.js.map