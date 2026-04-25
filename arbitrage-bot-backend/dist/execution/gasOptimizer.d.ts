import { GasMetrics, ArbitrageOpportunity } from '../types';
export interface GasOptimizerConfig {
    maxGasPriceGwei: number;
    minProfitBps: number;
    dailyLossLimit: number;
    gasMultiplier: number;
}
export declare class GasOptimizer {
    private provider;
    private config;
    private dailyStats;
    private lastResetTime;
    private dexGasCosts;
    private circuitBreakerThresholds;
    private consecutiveFailures;
    constructor(rpcUrl: string, config: GasOptimizerConfig);
    /**
     * Get current gas metrics from the chain
     */
    getGasMetrics(): Promise<GasMetrics>;
    /**
     * Estimate gas cost for a specific DEX type
     */
    estimateGasCost(dexType: string, gasPrice: bigint): bigint;
    /**
     * Check if an opportunity is profitable after gas costs
     */
    shouldExecuteOpportunity(opportunity: ArbitrageOpportunity): Promise<{
        shouldExecute: boolean;
        reason?: string;
        profitAfterGas?: number;
    }>;
    /**
     * Record execution result and update stats
     */
    recordExecution(result: {
        profit: number;
        gasCost: number;
        success: boolean;
    }): void;
    /**
     * Check if daily loss limit has been exceeded
     */
    private isDailyLossLimitOk;
    /**
     * Reset daily statistics
     */
    private resetDailyStats;
    /**
     * Get current daily statistics
     */
    getDailyStats(): {
        netProfit: number;
        avgProfitPerTrade: number;
        totalProfit: number;
        totalLoss: number;
        totalGasCost: number;
        tradeCount: number;
        resetTime: number;
    };
    /**
     * Get circuit breaker status
     */
    getCircuitBreakerStatus(): {
        isActive: boolean;
        consecutiveFailures: number;
        threshold: number;
    };
    /**
     * Reset circuit breaker manually
     */
    resetCircuitBreaker(): void;
    /**
     * Validate transaction and ensure profitability
     */
    validateExecution(opportunity: ArbitrageOpportunity, gasPrice: bigint): Promise<boolean>;
    /**
     * Calculate adaptive gas limit based on opportunity size
     */
    calculateAdaptiveGasLimit(estimatedBaseGas: number, opportunitySize: number): bigint;
}
export default GasOptimizer;
//# sourceMappingURL=gasOptimizer.d.ts.map