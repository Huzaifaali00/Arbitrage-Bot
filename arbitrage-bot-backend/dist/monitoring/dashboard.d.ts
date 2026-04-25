import { BotMetrics } from '../types';
interface DashboardConfig {
    port: number;
    host?: string;
    enableCors?: boolean;
    vaultAddress?: string;
    rpcUrl?: string;
    chain?: string;
}
export declare class Dashboard {
    private app;
    private httpServer;
    private io;
    private config;
    private botState;
    private onPause?;
    private onResume?;
    private onGetMetrics?;
    private onGetRecentTrades?;
    private onGetAlerts?;
    private onGetDEXes?;
    constructor(config?: DashboardConfig);
    /**
     * Setup Express routes
     */
    private setupRoutes;
    /**
     * Setup WebSocket handlers
     */
    private setupWebSocket;
    /**
     * Broadcast metrics update to all connected clients
     */
    broadcastMetricsUpdate(metrics: BotMetrics): void;
    /**
     * Broadcast trade update to all connected clients
     */
    broadcastTradeUpdate(trade: any): void;
    /**
     * Broadcast alert to all connected clients
     */
    broadcastAlert(alert: {
        type: 'warning' | 'error' | 'info';
        message: string;
        timestamp?: number;
    }): void;
    /**
     * Set callback for pause action
     */
    onBotPause(callback: () => Promise<void>): void;
    /**
     * Set callback for resume action
     */
    onBotResume(callback: () => Promise<void>): void;
    /**
     * Set callback for getting metrics
     */
    onBotMetrics(callback: () => BotMetrics): void;
    /**
     * Set callback for getting recent trades
     */
    onBotTrades(callback: () => any[]): void;
    /**
     * Set callback for getting alerts
     */
    onBotAlerts(callback: () => any[]): void;
    /**
     * Set callback for getting list of DEXes the bot currently monitors
     */
    onBotDEXes(callback: () => any[]): void;
    /**
     * Start dashboard server
     */
    start(): void;
    /**
     * Stop dashboard server
     */
    stop(): void;
    /**
     * Get dashboard HTML
     */
    private getDashboardHTML;
}
export default Dashboard;
//# sourceMappingURL=dashboard.d.ts.map