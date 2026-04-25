"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.Dashboard = void 0;
const express_1 = __importDefault(require("express"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const logger_1 = __importDefault(require("../utils/logger"));
const express_rate_limit_1 = __importDefault(require("express-rate-limit"));
class Dashboard {
    constructor(config = { port: 3000 }) {
        this.botState = {
            isRunning: false,
            isPaused: false,
            lastUpdate: 0,
            metrics: null,
            recentTrades: [],
            alerts: [],
        };
        this.config = config;
        this.app = (0, express_1.default)();
        this.httpServer = require('http').createServer(this.app);
        this.io = new socket_io_1.Server(this.httpServer, {
            cors: config.enableCors ? { origin: '*' } : undefined,
        });
        this.setupRoutes();
        this.setupWebSocket();
    }
    /**
     * Setup Express routes
     */
    setupRoutes() {
        // Middleware
        if (this.config.enableCors) {
            this.app.use((0, cors_1.default)());
        }
        // Rate Limiting
        const limiter = (0, express_rate_limit_1.default)({
            windowMs: 15 * 60 * 1000, // 15 minutes
            max: 100, // Limit each IP to 100 requests per windowMs
            message: 'Too many requests from this IP, please try again after 15 minutes'
        });
        this.app.use('/api/', limiter);
        this.app.use(express_1.default.static('public'));
        // Health check
        this.app.get('/api/health', (req, res) => {
            res.json({
                status: 'ok',
                uptime: process.uptime(),
                timestamp: Date.now(),
            });
        });
        // SaaS Configuration
        this.app.get('/api/config', (req, res) => {
            res.json({
                vaultAddress: this.config.vaultAddress,
                rpcUrl: this.config.rpcUrl,
                chain: this.config.chain,
                timestamp: Date.now(),
            });
        });
        // Get bot state
        this.app.get('/api/bot/state', (req, res) => {
            res.json(this.botState);
        });
        // Get metrics
        this.app.get('/api/metrics', (req, res) => {
            if (this.onGetMetrics) {
                const metrics = this.onGetMetrics();
                res.json(metrics);
            }
            else {
                res.json({ error: 'Metrics not available' });
            }
        });
        // Get recent trades
        this.app.get('/api/trades/recent', (req, res) => {
            if (this.onGetRecentTrades) {
                const trades = this.onGetRecentTrades();
                res.json(trades);
            }
            else {
                res.json([]);
            }
        });
        // Get alerts
        this.app.get('/api/alerts', (req, res) => {
            if (this.onGetAlerts) {
                const alerts = this.onGetAlerts();
                res.json(alerts);
            }
            else {
                res.json([]);
            }
        });
        // Get DEXes currently monitored by the bot
        this.app.get('/api/dexes', (req, res) => {
            if (this.onGetDEXes) {
                res.json(this.onGetDEXes());
            }
            else {
                res.json([]);
            }
        });
        // Pause bot
        this.app.post('/api/bot/pause', async (req, res) => {
            try {
                if (this.onPause) {
                    await this.onPause();
                    this.botState.isPaused = true;
                    this.io.emit('bot-state-changed', { isPaused: true });
                    res.json({ status: 'paused' });
                }
                else {
                    res.status(400).json({ error: 'Pause handler not set' });
                }
            }
            catch (error) {
                logger_1.default.error('Error pausing bot', { error });
                res.status(500).json({ error: error.message });
            }
        });
        // Resume bot
        this.app.post('/api/bot/resume', async (req, res) => {
            try {
                if (this.onResume) {
                    await this.onResume();
                    this.botState.isPaused = false;
                    this.io.emit('bot-state-changed', { isPaused: false });
                    res.json({ status: 'running' });
                }
                else {
                    res.status(400).json({ error: 'Resume handler not set' });
                }
            }
            catch (error) {
                logger_1.default.error('Error resuming bot', { error });
                res.status(500).json({ error: error.message });
            }
        });
        // Get dashboard HTML
        this.app.get('/', (req, res) => {
            res.send(this.getDashboardHTML());
        });
        // Web Push Endpoints
        this.app.get('/api/push/key', (req, res) => {
            res.json({ publicKey: process.env.VAPID_PUBLIC_KEY });
        });
        this.app.post('/api/push/subscribe', (req, res) => {
            const subscription = req.body;
            const storageService = require('../services/StorageService').default;
            storageService.addSubscription(subscription);
            res.status(201).json({ status: 'subscribed' });
        });
        logger_1.default.info('Express routes configured');
    }
    /**
     * Setup WebSocket handlers
     */
    setupWebSocket() {
        this.io.on('connection', (socket) => {
            logger_1.default.info('Client connected', { clientId: socket.id });
            // Send initial state
            socket.emit('bot-state', this.botState);
            // Handle disconnect
            socket.on('disconnect', () => {
                logger_1.default.info('Client disconnected', { clientId: socket.id });
            });
            // Handle pause request
            socket.on('pause-bot', async () => {
                try {
                    if (this.onPause) {
                        await this.onPause();
                        this.botState.isPaused = true;
                        this.io.emit('bot-state-changed', { isPaused: true });
                    }
                }
                catch (error) {
                    logger_1.default.error('Error pausing bot via socket', { error });
                    socket.emit('error', { message: error.message });
                }
            });
            // Handle resume request
            socket.on('resume-bot', async () => {
                try {
                    if (this.onResume) {
                        await this.onResume();
                        this.botState.isPaused = false;
                        this.io.emit('bot-state-changed', { isPaused: false });
                    }
                }
                catch (error) {
                    logger_1.default.error('Error resuming bot via socket', { error });
                    socket.emit('error', { message: error.message });
                }
            });
            // Request metrics update
            socket.on('request-metrics', () => {
                if (this.onGetMetrics) {
                    const metrics = this.onGetMetrics();
                    socket.emit('metrics-update', metrics);
                }
            });
            // Request trades update
            socket.on('request-trades', () => {
                if (this.onGetRecentTrades) {
                    const trades = this.onGetRecentTrades();
                    socket.emit('trades-update', trades);
                }
            });
        });
        logger_1.default.info('WebSocket handlers configured');
    }
    /**
     * Broadcast metrics update to all connected clients
     */
    broadcastMetricsUpdate(metrics) {
        this.botState.metrics = metrics;
        this.botState.lastUpdate = Date.now();
        this.io.emit('metrics-update', metrics);
    }
    /**
     * Broadcast trade update to all connected clients
     */
    broadcastTradeUpdate(trade) {
        this.botState.recentTrades.unshift(trade);
        // Keep only last 50 trades in memory
        if (this.botState.recentTrades.length > 50) {
            this.botState.recentTrades.pop();
        }
        this.io.emit('trade-executed', trade);
    }
    /**
     * Broadcast alert to all connected clients
     */
    broadcastAlert(alert) {
        const fullAlert = {
            ...alert,
            timestamp: alert.timestamp || Date.now(),
        };
        this.botState.alerts.unshift(fullAlert);
        // Keep only last 100 alerts
        if (this.botState.alerts.length > 100) {
            this.botState.alerts.pop();
        }
        this.io.emit('alert', fullAlert);
        logger_1.default.info('Alert broadcasted', fullAlert);
    }
    /**
     * Set callback for pause action
     */
    onBotPause(callback) {
        this.onPause = callback;
    }
    /**
     * Set callback for resume action
     */
    onBotResume(callback) {
        this.onResume = callback;
    }
    /**
     * Set callback for getting metrics
     */
    onBotMetrics(callback) {
        this.onGetMetrics = callback;
    }
    /**
     * Set callback for getting recent trades
     */
    onBotTrades(callback) {
        this.onGetRecentTrades = callback;
    }
    /**
     * Set callback for getting alerts
     */
    onBotAlerts(callback) {
        this.onGetAlerts = callback;
    }
    /**
     * Set callback for getting list of DEXes the bot currently monitors
     */
    onBotDEXes(callback) {
        this.onGetDEXes = callback;
    }
    /**
     * Start dashboard server
     */
    start() {
        const port = this.config.port;
        const host = this.config.host || 'localhost';
        this.httpServer.listen(port, host, () => {
            this.botState.isRunning = true;
            logger_1.default.info('Dashboard started', { url: `http://${host}:${port}` });
        });
    }
    /**
     * Stop dashboard server
     */
    stop() {
        this.httpServer.close(() => {
            this.botState.isRunning = false;
            logger_1.default.info('Dashboard stopped');
        });
    }
    /**
     * Get dashboard HTML
     */
    getDashboardHTML() {
        return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Arbitrage Bot Dashboard</title>
  <script src="https://cdn.socket.io/4.5.4/socket.io.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: #333;
      min-height: 100vh;
    }

    .header {
      background: rgba(255, 255, 255, 0.95);
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
      padding: 20px 30px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .header h1 {
      color: #667eea;
      font-size: 28px;
    }

    .status {
      display: flex;
      gap: 15px;
      align-items: center;
    }

    .status-indicator {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: #4caf50;
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }

    .controls {
      display: flex;
      gap: 10px;
    }

    button {
      padding: 10px 20px;
      border: none;
      border-radius: 5px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      transition: all 0.3s ease;
    }

    button.pause {
      background: #ff9800;
      color: white;
    }

    button.resume {
      background: #4caf50;
      color: white;
    }

    button:hover {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .container {
      max-width: 1400px;
      margin: 30px auto;
      padding: 0 20px;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 20px;
      margin-bottom: 30px;
    }

    .card {
      background: white;
      border-radius: 10px;
      padding: 20px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transition: transform 0.3s ease;
    }

    .card:hover {
      transform: translateY(-4px);
    }

    .card h2 {
      color: #667eea;
      font-size: 14px;
      text-transform: uppercase;
      letter-spacing: 1px;
      margin-bottom: 15px;
      opacity: 0.7;
    }

    .card-value {
      font-size: 32px;
      font-weight: 700;
      color: #333;
      margin: 10px 0;
    }

    .card-subtext {
      font-size: 12px;
      color: #999;
      margin-top: 8px;
    }

    .positive {
      color: #4caf50;
    }

    .negative {
      color: #f44336;
    }

    .chart-container {
      background: white;
      border-radius: 10px;
      padding: 20px;
      margin-bottom: 30px;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .chart-container h2 {
      color: #667eea;
      margin-bottom: 20px;
      font-size: 16px;
    }

    .trades-table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 15px;
    }

    .trades-table th {
      background: #f5f5f5;
      padding: 12px;
      text-align: left;
      font-weight: 600;
      color: #667eea;
      border-bottom: 2px solid #e0e0e0;
      font-size: 12px;
    }

    .trades-table td {
      padding: 12px;
      border-bottom: 1px solid #e0e0e0;
      font-size: 13px;
    }

    .trades-table tr:hover {
      background: #f9f9f9;
    }

    .status-badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
    }

    .status-success {
      background: #e8f5e9;
      color: #2e7d32;
    }

    .status-failed {
      background: #ffebee;
      color: #c62828;
    }

    .alerts-container {
      background: white;
      border-radius: 10px;
      padding: 20px;
      max-height: 300px;
      overflow-y: auto;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .alerts-container h2 {
      color: #667eea;
      margin-bottom: 15px;
      font-size: 16px;
    }

    .alert-item {
      padding: 12px;
      border-left: 4px solid;
      margin-bottom: 10px;
      border-radius: 4px;
      font-size: 13px;
    }

    .alert-warning {
      border-left-color: #ff9800;
      background: #fff3e0;
    }

    .alert-error {
      border-left-color: #f44336;
      background: #ffebee;
    }

    .alert-info {
      border-left-color: #2196f3;
      background: #e3f2fd;
    }

    @media (max-width: 768px) {
      .header {
        flex-direction: column;
        gap: 15px;
      }

      .grid {
        grid-template-columns: 1fr;
      }

      .card-value {
        font-size: 24px;
      }
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>🤖 Arbitrage Bot Dashboard</h1>
    <div class="status">
      <div class="status-indicator"></div>
      <span>Live</span>
      <div class="controls">
        <button id="push-btn" class="resume" style="background: #2196f3; display: none;" onclick="subscribePush()">🔔 Enable Notifications</button>
        <button class="pause" onclick="pauseBot()">⏸ Pause</button>
        <button class="resume" onclick="resumeBot()">▶ Resume</button>
      </div>
    </div>
  </div>

  <div class="container">
    <div class="grid">
      <div class="card">
        <h2>Total Profit</h2>
        <div class="card-value positive" id="totalProfit">0.00</div>
        <div class="card-subtext">Since start of bot</div>
      </div>

      <div class="card">
        <h2>Total Trades</h2>
        <div class="card-value" id="totalTrades">0</div>
        <div class="card-subtext"><span id="successRate">0</span>% success rate</div>
      </div>

      <div class="card">
        <h2>Avg Profit/Trade</h2>
        <div class="card-value" id="avgProfit">0.00</div>
        <div class="card-subtext">Average net profit</div>
      </div>

      <div class="card">
        <h2>ROI</h2>
        <div class="card-value positive" id="roi">0.00%</div>
        <div class="card-subtext">Return on investment</div>
      </div>

      <div class="card">
        <h2>Gas Cost</h2>
        <div class="card-value" id="gasCost">0.00</div>
        <div class="card-subtext">Total spent on gas</div>
      </div>

      <div class="card">
        <h2>Last Trade</h2>
        <div class="card-value" id="lastTrade">Never</div>
        <div class="card-subtext" id="lastTradeTime">-</div>
      </div>
    </div>

    <div class="chart-container">
      <h2>📊 Profit Over Time</h2>
      <canvas id="profitChart"></canvas>
    </div>

    <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 20px; margin-bottom: 30px;">
      <div class="card" style="padding: 0;">
        <div style="padding: 20px;">
          <h2 style="margin-bottom: 20px;">Recent Trades</h2>
          <div id="tradesContainer">
            <p style="color: #999;">No trades yet</p>
          </div>
        </div>
      </div>

      <div class="alerts-container">
        <h2>🔔 Alerts</h2>
        <div id="alertsContainer">
          <p style="color: #999;">No alerts</p>
        </div>
      </div>
    </div>
  </div>

  <script>
    const socket = io();

    // Update metrics
    socket.on('metrics-update', (metrics) => {
      document.getElementById('totalProfit').textContent = metrics.totalProfit.toFixed(6);
      document.getElementById('totalTrades').textContent = metrics.totalTrades;
      document.getElementById('successRate').textContent = (metrics.successRate * 100).toFixed(1);
      document.getElementById('avgProfit').textContent = metrics.averageProfitPerTrade.toFixed(6);
      document.getElementById('gasCost').textContent = metrics.totalGasCost.toFixed(6);
      document.getElementById('roi').textContent = metrics.roi.toFixed(2);

      updateProfitChart(metrics);
    });

    // Update trades
    socket.on('trade-executed', (trade) => {
      const container = document.getElementById('tradesContainer');
      const html = \`
        <div style="padding: 12px; border-bottom: 1px solid #e0e0e0; font-size: 12px;">
          <div style="display: flex; justify-content: space-between; margin-bottom: 5px;">
            <strong>\${new Date(trade.timestamp).toLocaleTimeString()}</strong>
            <span class="status-badge \${trade.success ? 'status-success' : 'status-failed'}">
              \${trade.success ? 'Success' : 'Failed'}
            </span>
          </div>
          <div>Profit: <strong class="\${trade.netProfit > 0 ? 'positive' : 'negative'}">\${trade.netProfit.toFixed(6)}</strong></div>
        </div>
      \`;
      container.insertAdjacentHTML('afterbegin', html);
    });

    // Update alerts
    socket.on('alert', (alert) => {
      const container = document.getElementById('alertsContainer');
      const html = \`
        <div class="alert-item alert-\${alert.type}">
          <strong>\${new Date(alert.timestamp).toLocaleTimeString()}</strong><br>
          \${alert.message}
        </div>
      \`;
      container.insertAdjacentHTML('afterbegin', html);
    });

    function pauseBot() {
      socket.emit('pause-bot');
    }

    function resumeBot() {
      socket.emit('resume-bot');
    }

    function updateProfitChart(metrics) {
      // Placeholder for chart update
    }

    // Web Push Logic
    const pushBtn = document.getElementById('push-btn');
    
    if ('serviceWorker' in navigator && 'PushManager' in window) {
      pushBtn.style.display = 'inline-block';
      navigator.serviceWorker.register('/sw.js')
        .then(reg => console.log('SW Registered'))
        .catch(err => console.error('SW Error', err));
    }

    async function subscribePush() {
      try {
        const response = await fetch('/api/push/key');
        const { publicKey } = await response.json();
        
        const registration = await navigator.serviceWorker.ready;
        const subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });

        await fetch('/api/push/subscribe', {
          method: 'POST',
          body: JSON.stringify(subscription),
          headers: { 'Content-Type': 'application/json' }
        });

        alert('Notifications enabled!');
        pushBtn.style.display = 'none';
      } catch (err) {
        console.error('Failed to subscribe', err);
        alert('Failed to enable notifications. See console.');
      }
    }

    function urlBase64ToUint8Array(base64String) {
      const padding = '='.repeat((4 - base64String.length % 4) % 4);
      const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
    }
  </script>
</body>
</html>
    `;
    }
}
exports.Dashboard = Dashboard;
exports.default = Dashboard;
//# sourceMappingURL=dashboard.js.map