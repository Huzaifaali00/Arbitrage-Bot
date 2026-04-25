"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorageService = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const logger_1 = __importDefault(require("../utils/logger"));
class StorageService {
    constructor(dbPath = 'bot-data.db') {
        const absolutePath = path_1.default.resolve(process.cwd(), dbPath);
        this.db = new better_sqlite3_1.default(absolutePath);
        this.init();
    }
    init() {
        // Create subscriptions table if not exists
        this.db.prepare(`
            CREATE TABLE IF NOT EXISTS subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                endpoint TEXT UNIQUE,
                p256dh TEXT,
                auth TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `).run();
        logger_1.default.info('StorageService: Database initialised');
    }
    /**
     * Store a new push subscription
     */
    addSubscription(sub) {
        try {
            const stmt = this.db.prepare('INSERT OR REPLACE INTO subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)');
            stmt.run(sub.endpoint, sub.keys.p256dh, sub.keys.auth);
            logger_1.default.info('StorageService: Added/Updated subscription', { endpoint: sub.endpoint });
        }
        catch (error) {
            logger_1.default.error('StorageService: Failed to add subscription', { error });
        }
    }
    /**
     * Remove a subscription (e.g., if it expired or user unsubscribed)
     */
    removeSubscription(endpoint) {
        try {
            this.db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint);
            logger_1.default.info('StorageService: Removed subscription', { endpoint });
        }
        catch (error) {
            logger_1.default.error('StorageService: Failed to remove subscription', { error });
        }
    }
    /**
     * Get all active subscriptions
     */
    getAllSubscriptions() {
        const rows = this.db.prepare('SELECT endpoint, p256dh, auth FROM subscriptions').all();
        return rows.map(row => ({
            endpoint: row.endpoint,
            keys: {
                p256dh: row.p256dh,
                auth: row.auth
            }
        }));
    }
}
exports.StorageService = StorageService;
exports.default = new StorageService();
//# sourceMappingURL=StorageService.js.map