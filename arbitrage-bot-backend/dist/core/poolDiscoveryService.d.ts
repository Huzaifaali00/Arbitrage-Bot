import { EventEmitter } from "events";
import { ethers } from "ethers";
import { DEXType } from "../types";
interface DiscoveryConfig {
    minTVL: number;
    minVolume24h: number;
    minPoolAge: number;
    maxPoolsPerBatch: number;
    discoveryInterval: number;
    metricsRefreshInterval: number;
    maxFailuresBeforeCircuitBreaker: number;
    rpcRetries: number;
    rpcRetryDelay: number;
}
export interface PoolCandidate {
    address: string;
    dexType: DEXType;
    token0: string;
    token1: string;
    fee?: number;
    tvl: number;
    volume24h: number;
    createdAt: number;
    opportunityScore: number;
}
export interface DiscoveryStats {
    poolsDiscovered: number;
    poolsApproved: number;
    poolsRejected: number;
    totalTVLMonitored: number;
    avgOpportunityScore: number;
    lastDiscoveryTime: number;
    failureCount: number;
    isOperational: boolean;
}
export declare class PoolDiscoveryService extends EventEmitter {
    private provider;
    private config;
    private discoveredPools;
    private registryContractAddress;
    private registryABI;
    private stats;
    private discoveryLoop?;
    private metricsRefreshLoop?;
    private circuitBreakerTriggered;
    private dexHandlers;
    private dexConfigs;
    private _chain;
    private lastProcessedBlocks;
    constructor(rpcUrl: string, registryAddress: string, config?: Partial<DiscoveryConfig> & {
        chain?: string;
    });
    private _registerDefaultHandlers;
    /**
     * Start the pool discovery service.
     * Verifies registry contract reachability, seeds local cache from on-chain registry,
     * then starts discovery and metrics loops.
     */
    start(): Promise<void>;
    /**
     * Stop all discovery and metrics loops.
     */
    stop(): Promise<void>;
    /**
     * Register a DEX-specific discovery handler at runtime.
     */
    registerDEXHandler(dexType: DEXType, handler: DEXDiscoveryHandler): void;
    /**
     * Discover new pools on a specific DEX from startBlock to current chain head.
     * Validates each discovered pool before adding it to the registry.
     */
    discoverPoolsOnDEX(dexType: DEXType, startBlock?: number): Promise<void>;
    /**
     * Returns a snapshot of current discovery statistics.
     */
    getStats(): DiscoveryStats;
    /**
     * Returns all pools currently held in the local registry.
     */
    getDiscoveredPools(): PoolCandidate[];
    /**
     * Returns pools sorted by opportunity score, filtered to those above minScore.
     */
    getHighOpportunityPools(minScore?: number): PoolCandidate[];
    /**
     * Returns a map of DEXType to factory address for all configured DEXes.
     */
    getFactoryAddresses(): Map<DEXType, string>;
    /**
     * Query the on-chain DEXRegistry for all high-opportunity pools and seed
     * the local in-memory cache. Runs once on startup before the scan loop.
     */
    private _loadPoolsFromRegistry;
    private _validatePool;
    private _calculateOpportunityScore;
    private _registerPoolsWithRegistry;
    private _refreshPoolMetrics;
    private _handleDiscoveryFailure;
    private _startDiscoveryLoop;
    private _startMetricsRefreshLoop;
}
export interface DEXDiscoveryHandler {
    name: string;
    /** Discover pools created between startBlock and endBlock */
    discoverPools(provider: ethers.JsonRpcProvider, startBlock: number, endBlock: number): Promise<any[]>;
    /** Fetch on-chain pool metrics */
    fetchPoolMetrics(provider: ethers.JsonRpcProvider, poolAddress: string): Promise<any>;
    /** Validate pool legitimacy by inspecting token contracts */
    validatePool(provider: ethers.JsonRpcProvider, poolAddress: string): Promise<boolean>;
}
export {};
//# sourceMappingURL=poolDiscoveryService.d.ts.map