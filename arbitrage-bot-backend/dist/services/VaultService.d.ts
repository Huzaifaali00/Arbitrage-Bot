import { EventEmitter } from "events";
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
export declare class VaultService extends EventEmitter {
    private provider;
    private signer;
    private vault;
    private readonly vaultRead;
    private bot;
    private vaultAddress;
    private botAddress;
    private isListening;
    private isDistributing;
    private distributionHistory;
    private readonly MAX_HISTORY;
    private pendingDistributionWei;
    private readonly MIN_DISTRIBUTION_UNITS;
    private pollTimer?;
    private lastPollBlock;
    private readonly POLL_INTERVAL_MS;
    constructor(rpcUrls: string | string[], vaultAddress: string, privateKey?: string, botAddress?: string);
    /**
     * Distribute arbitrage profit to all active vault depositors.
     * profitUnits represents the amount of USDC (6 decimals) to distribute.
     */
    distributeProfit(profitUnits: bigint): Promise<string>;
    accumulateAndDistribute(profitUnits: bigint): Promise<void>;
    getVaultStats(): Promise<VaultStats>;
    getActivePrincipal(): Promise<bigint>;
    getPendingOperatorFees(): Promise<bigint>;
    isExecutorAuthorized(address: string): Promise<boolean>;
    startEventListening(): void;
    getPendingDistributionWei(): bigint;
    stop(): void;
}
export default VaultService;
//# sourceMappingURL=VaultService.d.ts.map