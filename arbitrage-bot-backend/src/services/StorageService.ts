import Database from 'better-sqlite3';
import path from 'path';
import logger from '../utils/logger';

export interface PushSubscription {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
}

export class StorageService {
    private db: Database.Database;

    constructor(dbPath: string = 'bot-data.db') {
        const absolutePath = path.resolve(process.cwd(), dbPath);
        this.db = new Database(absolutePath);
        this.init();
    }

    private init(): void {
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
        
        logger.info('StorageService: Database initialised');
    }

    /**
     * Store a new push subscription
     */
    addSubscription(sub: PushSubscription): void {
        try {
            const stmt = this.db.prepare(
                'INSERT OR REPLACE INTO subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)'
            );
            stmt.run(sub.endpoint, sub.keys.p256dh, sub.keys.auth);
            logger.info('StorageService: Added/Updated subscription', { endpoint: sub.endpoint });
        } catch (error) {
            logger.error('StorageService: Failed to add subscription', { error });
        }
    }

    /**
     * Remove a subscription (e.g., if it expired or user unsubscribed)
     */
    removeSubscription(endpoint: string): void {
        try {
            this.db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run(endpoint);
            logger.info('StorageService: Removed subscription', { endpoint });
        } catch (error) {
            logger.error('StorageService: Failed to remove subscription', { error });
        }
    }

    /**
     * Get all active subscriptions
     */
    getAllSubscriptions(): PushSubscription[] {
        const rows = this.db.prepare('SELECT endpoint, p256dh, auth FROM subscriptions').all() as any[];
        return rows.map(row => ({
            endpoint: row.endpoint,
            keys: {
                p256dh: row.p256dh,
                auth: row.auth
            }
        }));
    }
}

export default new StorageService();
