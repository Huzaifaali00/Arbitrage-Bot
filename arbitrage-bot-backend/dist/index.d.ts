export declare class ArbitrageBot {
    private readonly wrappedNativeByChain;
    private provider;
    private eventListener;
    private opportunityDetector;
    private routeCalculator;
    private poolDiscoveryService;
    private gasOptimizer;
    private transactionBuilder;
    private transactionSubmitter;
    private profitTracker;
    private dashboard;
    private vaultService;
    private priceCache;
    private inFlightOpportunities;
    private activeRoutes;
    private routeCooldowns;
    private executionLoopBusy;
    private readonly routeCooldownMs;
    private runtime;
    private executionLoop?;
    private metricsLoop?;
    private maintenanceLoop?;
    constructor();
    /**
     * Start the bot — verifies connection, boots all services, and wires event streams
     */
    start(): Promise<void>;
    stop(): Promise<void>;
    pause(): Promise<void>;
    resume(): Promise<void>;
    /**
     * Main execution loop — scans for arbitrage and executes when profitable
     */
    private _startExecutionLoop;
    private _startMetricsLoop;
    private _startMaintenanceLoop;
    private _processOpportunity;
    private _setupDashboardCallbacks;
    private getMinTradeSize;
    private getInitialTradeSize;
    private isValidTransactionHash;
    getStats(): Promise<{
        uptime: number;
        metrics: import("./types").BotMetrics;
        gasOptimizerStats: {
            netProfit: number;
            avgProfitPerTrade: number;
            totalProfit: number;
            totalLoss: number;
            totalGasCost: number;
            tradeCount: number;
            resetTime: number;
        };
        circuitBreakerStatus: {
            isActive: boolean;
            consecutiveFailures: number;
            threshold: number;
        };
        discoveryStats: import("./core/poolDiscoveryService").DiscoveryStats;
        poolCount: number;
        vault: {
            activePrincipalEth: string;
            pausedPrincipalEth: string;
            userCount: string;
            lifetimeProfitEth: string;
            feeBps: string;
            pendingDistributionEth: string;
        } | null;
        isRunning: boolean;
        isPaused: boolean;
        startTime: number;
        opportunitiesFound: number;
        opportunitiesExecuted: number;
        lastOpportunityTime: number;
    }>;
    setupSignalHandlers(): void;
}
export default ArbitrageBot;
//# sourceMappingURL=index.d.ts.map