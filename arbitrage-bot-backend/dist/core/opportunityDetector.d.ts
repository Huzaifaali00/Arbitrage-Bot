import { ethers } from "ethers";
import { ArbitrageOpportunity, Pool, PriceCache, CycleDetectionResult } from "../types";
/**
 * Advanced opportunity detector using Bellman-Ford negative cycle detection
 * This finds 2-3x more opportunities than simple pattern matching
 */
export declare class OpportunityDetector {
    private minProfitPercentage;
    private pools;
    private priceCache;
    private provider;
    private readonly poolFeeCache;
    private readonly tokenDecimalsCache;
    private readonly blacklistedPools;
    private readonly maxProfitPercentageCap;
    private readonly maxPlausibleProfitUsd;
    private readonly quoterAddress;
    private readonly v2PoolAbi;
    private readonly v3PoolAbi;
    private readonly erc20Abi;
    private readonly v3QuoterV2Abi;
    private readonly preferredStartTokens;
    constructor(pools: Pool[], provider: ethers.Provider, minProfitPercentage?: number);
    updatePriceCache(cache: PriceCache): void;
    updatePools(pools: Pool[]): void;
    addPool(pool: Pool): void;
    /**
     * Bellman-Ford algorithm for detecting arbitrage cycles
     * Time: O(V*E) where V=tokens, E=pools
     * Returns profitable cycles to execute
     */
    detectArbitrageCycles(startToken: string): CycleDetectionResult;
    /**
     * Detect simple 2-hop and 3-hop arbitrage opportunities
     * Faster than Bellman-Ford for simple patterns
     */
    detectSimpleOpportunities(): Promise<ArbitrageOpportunity[]>;
    private getTokenDecimals;
    private resolvePoolFee;
    private quoteV2Hop;
    private quoteV3Hop;
    private quoteRouteExactInput;
    private validateOpportunityWithQuote;
    private prioritizeTwoHopPools;
    private shouldSkipTwoHopPair;
    private calculateTwoHopArb;
    private buildTwoHopReverseOpportunity;
    private buildTwoHopForwardOpportunity;
    /**
     * Calculate 3-hop triangular arbitrage across all 6 valid traversal orderings.
     * Requires exactly 3 unique tokens across the 3 pools. Returns null if any
     * price cache entry is missing or stale (>5 s), or if no traversal beats
     * minProfitPercentage. Returns the most profitable traversal found.
     */
    private calculateThreeHopTriangle;
    private getSlippageForDex;
    private getPoolPrice;
    private getUniqueTokens;
    estimateGasCost(hopCount: number): number;
}
//# sourceMappingURL=opportunityDetector.d.ts.map