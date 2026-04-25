"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ProfitTracker = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const logger_1 = __importDefault(require("../utils/logger"));
class ProfitTracker {
    constructor(dbPath = './bot-data.db') {
        this.metricsCache = {
            totalProfit: 0,
            totalLoss: 0,
            totalTrades: 0,
            successCount: 0,
            totalGasCost: 0,
            lastUpdated: 0,
        };
        this.cacheExpiry = 60000; // 60 seconds
        try {
            this.db = new better_sqlite3_1.default(dbPath);
            this.db.pragma('journal_mode = WAL'); // Write-Ahead Logging for better concurrency
            this.initializeDatabase();
            logger_1.default.info('ProfitTracker initialized', { dbPath });
        }
        catch (error) {
            logger_1.default.error('Failed to initialize ProfitTracker', { error });
            throw error;
        }
    }
    /**
     * Initialize database schema
     */
    initializeDatabase() {
        try {
            // Create trades table
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS trades (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          txHash TEXT UNIQUE NOT NULL,
          profit REAL NOT NULL,
          loss REAL NOT NULL DEFAULT 0,
          gasCost REAL NOT NULL,
          netProfit REAL NOT NULL,
          opportunityId TEXT,
          dexType TEXT,
          success INTEGER NOT NULL DEFAULT 1,
          blockNumber INTEGER,
          gasUsed BIGINT,
          createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_timestamp ON trades(timestamp);
        CREATE INDEX IF NOT EXISTS idx_success ON trades(success);
        CREATE INDEX IF NOT EXISTS idx_txHash ON trades(txHash);
      `);
            const tradeColumns = this.db.prepare(`PRAGMA table_info(trades)`).all()
                .map((column) => column.name);
            const ensureColumn = (name, sql) => {
                if (!tradeColumns.includes(name)) {
                    this.db.exec(`ALTER TABLE trades ADD COLUMN ${sql}`);
                }
            };
            ensureColumn('gasCostUsd', 'gasCostUsd REAL NOT NULL DEFAULT 0');
            ensureColumn('realizedToken', 'realizedToken TEXT');
            ensureColumn('realizedTokenSymbol', 'realizedTokenSymbol TEXT');
            ensureColumn('realizedDelta', 'realizedDelta REAL NOT NULL DEFAULT 0');
            ensureColumn('realizedUsdEquivalent', 'realizedUsdEquivalent REAL NOT NULL DEFAULT 0');
            ensureColumn('profitSource', "profitSource TEXT NOT NULL DEFAULT 'unknown'");
            // Create daily summary table
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS daily_summary (
          date TEXT PRIMARY KEY,
          totalProfit REAL NOT NULL,
          totalLoss REAL NOT NULL,
          totalGasCost REAL NOT NULL,
          tradeCount INTEGER NOT NULL,
          successCount INTEGER NOT NULL,
          avgProfitPerTrade REAL,
          roi REAL,
          createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
        );
      `);
            // Create metrics snapshot table (for historical tracking)
            this.db.exec(`
        CREATE TABLE IF NOT EXISTS metrics_snapshot (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp INTEGER NOT NULL,
          totalProfit REAL NOT NULL,
          totalTrades INTEGER NOT NULL,
          successRate REAL NOT NULL,
          avgProfitPerTrade REAL,
          totalGasCost REAL,
          roi REAL,
          createdAt INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
        );
        CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON metrics_snapshot(timestamp);
      `);
            logger_1.default.info('Database schema initialized');
        }
        catch (error) {
            logger_1.default.error('Failed to initialize database schema', { error });
            throw error;
        }
    }
    /**
     * Record a trade execution
     */
    recordTrade(trade) {
        try {
            const stmt = this.db.prepare(`
        INSERT INTO trades (
          timestamp, txHash, profit, loss, gasCost, netProfit,
          opportunityId, dexType, success, blockNumber, gasCostUsd,
          realizedToken, realizedTokenSymbol, realizedDelta,
          realizedUsdEquivalent, profitSource
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
            stmt.run(trade.timestamp, trade.txHash, trade.profit, trade.loss, trade.gasCost, trade.netProfit, trade.opportunityId, trade.dexType, trade.success ? 1 : 0, 0, // blockNumber - would be set from receipt
            trade.gasCostUsd ?? 0, trade.realizedToken ?? null, trade.realizedTokenSymbol ?? null, trade.realizedDelta ?? 0, trade.realizedUsdEquivalent ?? 0, trade.profitSource ?? 'unknown');
            // Invalidate cache
            this.metricsCache.lastUpdated = 0;
            logger_1.default.debug('Trade recorded', {
                txHash: trade.txHash,
                netProfit: trade.netProfit,
                success: trade.success,
            });
        }
        catch (error) {
            logger_1.default.error('Failed to record trade', { error });
            throw error;
        }
    }
    /**
     * Record execution result
     */
    recordExecution(result, opportunityId, dexType) {
        this.recordTrade({
            timestamp: result.timestamp,
            txHash: result.hash,
            profit: result.profitMade,
            loss: result.profitMade < 0 ? Math.abs(result.profitMade) : 0,
            gasCost: result.gasCostActual,
            netProfit: result.netProfit,
            opportunityId,
            dexType,
            success: result.status === 'success',
            gasCostUsd: result.gasCostUsd,
            realizedToken: result.realizedToken,
            realizedTokenSymbol: result.realizedTokenSymbol,
            realizedDelta: result.realizedDelta,
            realizedUsdEquivalent: result.realizedUsdEquivalent,
            profitSource: result.profitSource,
        });
    }
    /**
     * Get total profit/loss
     */
    getTotalProfit() {
        const result = this.db.prepare(`
      SELECT COALESCE(SUM(netProfit), 0) as totalNetProfit
      FROM trades
      WHERE success = 1
    `).get();
        return result?.totalNetProfit || 0;
    }
    /**
     * Get total gas costs
     */
    getTotalGasCost() {
        const result = this.db.prepare(`
      SELECT COALESCE(SUM(gasCost), 0) as total FROM trades
    `).get();
        return result?.total || 0;
    }
    /**
     * Get success rate
     */
    getSuccessRate() {
        const result = this.db.prepare(`
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successful
      FROM trades
    `).get();
        if (result?.total === 0)
            return 0;
        return (result?.successful || 0) / result?.total;
    }
    /**
     * Get trades for a time period
     */
    getTradesByPeriod(startTime, endTime) {
        const stmt = this.db.prepare(`
      SELECT * FROM trades
      WHERE timestamp BETWEEN ? AND ?
        AND txHash LIKE '0x%'
        AND length(txHash) = 66
      ORDER BY timestamp DESC
    `);
        return stmt.all(startTime, endTime);
    }
    /**
     * Get daily summary
     */
    getDailySummary(date) {
        const stmt = this.db.prepare(`
      SELECT * FROM daily_summary WHERE date = ?
    `);
        return stmt.get(date);
    }
    /**
     * Calculate and store daily summary
     */
    calculateDailySummary(date) {
        try {
            const startOfDay = new Date(date).getTime();
            const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
            const result = this.db.prepare(`
        SELECT
          COALESCE(SUM(netProfit), 0) as totalNetProfit,
          COALESCE(SUM(gasCost), 0) as totalGasCost,
          COUNT(*) as tradeCount,
          SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successCount
        FROM trades
        WHERE timestamp BETWEEN ? AND ? AND success = 1
      `).get(startOfDay, endOfDay);
            const netProfit = result?.totalNetProfit || 0;
            const avgProfit = result?.tradeCount ? netProfit / result.tradeCount : 0;
            const successRate = result?.tradeCount ? (result?.successCount || 0) / result.tradeCount : 0;
            // Store summary
            const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO daily_summary (
          date, totalProfit, totalLoss, totalGasCost, tradeCount, successCount, avgProfitPerTrade
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
            stmt.run(date, Math.max(netProfit, 0), Math.max(-netProfit, 0), result?.totalGasCost || 0, result?.tradeCount || 0, result?.successCount || 0, avgProfit);
            logger_1.default.info('Daily summary calculated', {
                date,
                netProfit,
                tradeCount: result?.tradeCount,
                successRate: (successRate * 100).toFixed(2) + '%',
            });
        }
        catch (error) {
            logger_1.default.error('Failed to calculate daily summary', { error });
        }
    }
    /**
     * Get bot metrics
     */
    getMetrics() {
        // Check if cache is still valid
        if (Date.now() - this.metricsCache.lastUpdated < this.cacheExpiry) {
            return this.calculateMetricsFromCache();
        }
        try {
            const totalTrades = this.db.prepare(`
        SELECT COUNT(*) as count FROM trades
      `).get();
            const successCount = this.db.prepare(`
        SELECT COUNT(*) as count FROM trades WHERE success = 1
      `).get();
            const profitData = this.db.prepare(`
        SELECT
          COALESCE(SUM(netProfit), 0) as totalNetProfit,
          COALESCE(SUM(gasCost), 0) as totalGasCost
        FROM trades WHERE success = 1
      `).get();
            const latestTrade = this.db.prepare(`
        SELECT timestamp FROM trades ORDER BY timestamp DESC LIMIT 1
      `).get();
            const totalProfit = profitData?.totalNetProfit || 0;
            const tradeCount = totalTrades?.count || 0;
            const successCount_ = successCount?.count || 0;
            const successRate = tradeCount > 0 ? successCount_ / tradeCount : 0;
            const avgProfit = tradeCount > 0 ? totalProfit / tradeCount : 0;
            const gasCost = profitData?.totalGasCost || 0;
            // Update cache
            this.metricsCache = {
                totalProfit,
                totalLoss: 0,
                totalTrades: tradeCount,
                successCount: successCount_,
                totalGasCost: gasCost,
                lastUpdated: Date.now(),
            };
            return {
                totalProfit,
                totalTrades: tradeCount,
                successRate,
                averageProfitPerTrade: avgProfit,
                totalGasCost: gasCost,
                roi: totalProfit > 0 && gasCost > 0 ? (totalProfit / gasCost) * 100 : 0,
                uptime: Date.now(), // Placeholder
                lastTradeTime: latestTrade?.timestamp || 0,
            };
        }
        catch (error) {
            logger_1.default.error('Failed to get metrics', { error });
            return {
                totalProfit: 0,
                totalTrades: 0,
                successRate: 0,
                averageProfitPerTrade: 0,
                totalGasCost: 0,
                roi: 0,
                uptime: 0,
                lastTradeTime: 0,
            };
        }
    }
    /**
     * Calculate metrics from cache
     */
    calculateMetricsFromCache() {
        return {
            totalProfit: this.metricsCache.totalProfit,
            totalTrades: this.metricsCache.totalTrades,
            successRate: this.metricsCache.totalTrades > 0
                ? this.metricsCache.successCount / this.metricsCache.totalTrades
                : 0,
            averageProfitPerTrade: this.metricsCache.totalTrades > 0
                ? this.metricsCache.totalProfit / this.metricsCache.totalTrades
                : 0,
            totalGasCost: this.metricsCache.totalGasCost,
            roi: this.metricsCache.totalProfit > 0 && this.metricsCache.totalGasCost > 0
                ? (this.metricsCache.totalProfit / this.metricsCache.totalGasCost) * 100
                : 0,
            uptime: 0,
            lastTradeTime: 0,
        };
    }
    /**
     * Save metrics snapshot
     */
    saveMetricsSnapshot(metrics) {
        try {
            const stmt = this.db.prepare(`
        INSERT INTO metrics_snapshot (
          timestamp, totalProfit, totalTrades, successRate, avgProfitPerTrade, totalGasCost, roi
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
            stmt.run(Date.now(), metrics.totalProfit, metrics.totalTrades, metrics.successRate, metrics.averageProfitPerTrade, metrics.totalGasCost, metrics.roi);
        }
        catch (error) {
            logger_1.default.error('Failed to save metrics snapshot', { error });
        }
    }
    /**
     * Get metrics history
     */
    getMetricsHistory(hours = 24) {
        const cutoffTime = Date.now() - hours * 60 * 60 * 1000;
        const stmt = this.db.prepare(`
      SELECT * FROM metrics_snapshot
      WHERE timestamp >= ?
      ORDER BY timestamp ASC
    `);
        return stmt.all(cutoffTime);
    }
    /**
     * Get trade statistics by DEX
     */
    getStatsByDex() {
        const stmt = this.db.prepare(`
      SELECT
        dexType,
        COUNT(*) as count,
        SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successCount,
        COALESCE(SUM(netProfit), 0) as totalNetProfit,
        COALESCE(SUM(gasCost), 0) as totalGasCost
      FROM trades
      WHERE success = 1
      GROUP BY dexType
    `);
        const results = stmt.all();
        const stats = {};
        results.forEach(row => {
            stats[row.dexType || 'unknown'] = {
                tradeCount: row.count,
                successCount: row.successCount,
                successRate: row.count > 0 ? (row.successCount / row.count) * 100 : 0,
                totalProfit: row.totalNetProfit,
                totalGasCost: row.totalGasCost,
            };
        });
        return stats;
    }
    /**
     * Export trades to CSV
     */
    exportTradesCSV(startTime, endTime) {
        const trades = this.getTradesByPeriod(startTime, endTime);
        const headers = ['Timestamp', 'TxHash', 'Profit', 'Loss', 'GasCost', 'NetProfit', 'OpportunityId', 'DexType', 'Success'];
        const rows = trades.map(trade => [
            new Date(trade.timestamp).toISOString(),
            trade.txHash,
            trade.profit.toFixed(6),
            trade.loss.toFixed(6),
            trade.gasCost.toFixed(6),
            trade.netProfit.toFixed(6),
            trade.opportunityId,
            trade.dexType,
            trade.success ? 'Yes' : 'No',
        ]);
        return [headers, ...rows].map(row => row.join(',')).join('\n');
    }
    /**
     * Clean old data
     */
    cleanOldData(daysToKeep = 90) {
        try {
            const cutoffTime = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
            const deletedTrades = this.db.prepare(`
        DELETE FROM trades WHERE timestamp < ?
      `).run(cutoffTime).changes;
            const deletedSnapshots = this.db.prepare(`
        DELETE FROM metrics_snapshot WHERE timestamp < ?
      `).run(cutoffTime).changes;
            logger_1.default.info('Old data cleaned', {
                deletedTrades,
                deletedSnapshots,
                daysToKeep,
            });
        }
        catch (error) {
            logger_1.default.error('Failed to clean old data', { error });
        }
    }
    /**
     * Close database connection
     */
    close() {
        try {
            this.db.close();
            logger_1.default.info('ProfitTracker database closed');
        }
        catch (error) {
            logger_1.default.error('Failed to close database', { error });
        }
    }
    /**
     * Get database info
     */
    getDatabaseInfo() {
        try {
            const tradeCount = this.db.prepare(`SELECT COUNT(*) as count FROM trades`).get()?.count || 0;
            return {
                size: 0, // Would need fs to get actual size
                tradeCount,
            };
        }
        catch (error) {
            logger_1.default.error('Failed to get database info', { error });
            return { size: 0, tradeCount: 0 };
        }
    }
}
exports.ProfitTracker = ProfitTracker;
exports.default = ProfitTracker;
//# sourceMappingURL=profitTracker.js.map