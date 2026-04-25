import { BotMetrics, ExecutionResult } from '../types';
interface TradeData {
    timestamp: number;
    txHash: string;
    profit: number;
    loss: number;
    gasCost: number;
    netProfit: number;
    opportunityId: string;
    dexType: string;
    success: boolean;
    gasCostUsd?: number;
    realizedToken?: string;
    realizedTokenSymbol?: string;
    realizedDelta?: number;
    realizedUsdEquivalent?: number;
    profitSource?: string;
}
export declare class ProfitTracker {
    private db;
    private metricsCache;
    private cacheExpiry;
    constructor(dbPath?: string);
    /**
     * Initialize database schema
     */
    private initializeDatabase;
    /**
     * Record a trade execution
     */
    recordTrade(trade: TradeData): void;
    /**
     * Record execution result
     */
    recordExecution(result: ExecutionResult, opportunityId: string, dexType: string): void;
    /**
     * Get total profit/loss
     */
    getTotalProfit(): number;
    /**
     * Get total gas costs
     */
    getTotalGasCost(): number;
    /**
     * Get success rate
     */
    getSuccessRate(): number;
    /**
     * Get trades for a time period
     */
    getTradesByPeriod(startTime: number, endTime: number): TradeData[];
    /**
     * Get daily summary
     */
    getDailySummary(date: string): any;
    /**
     * Calculate and store daily summary
     */
    calculateDailySummary(date: string): void;
    /**
     * Get bot metrics
     */
    getMetrics(): BotMetrics;
    /**
     * Calculate metrics from cache
     */
    private calculateMetricsFromCache;
    /**
     * Save metrics snapshot
     */
    saveMetricsSnapshot(metrics: BotMetrics): void;
    /**
     * Get metrics history
     */
    getMetricsHistory(hours?: number): any[];
    /**
     * Get trade statistics by DEX
     */
    getStatsByDex(): Record<string, any>;
    /**
     * Export trades to CSV
     */
    exportTradesCSV(startTime: number, endTime: number): string;
    /**
     * Clean old data
     */
    cleanOldData(daysToKeep?: number): void;
    /**
     * Close database connection
     */
    close(): void;
    /**
     * Get database info
     */
    getDatabaseInfo(): {
        size: number;
        tradeCount: number;
        lastBackup?: number;
    };
}
export default ProfitTracker;
//# sourceMappingURL=profitTracker.d.ts.map