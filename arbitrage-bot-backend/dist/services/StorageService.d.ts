export interface PushSubscription {
    endpoint: string;
    keys: {
        p256dh: string;
        auth: string;
    };
}
export declare class StorageService {
    private db;
    constructor(dbPath?: string);
    private init;
    /**
     * Store a new push subscription
     */
    addSubscription(sub: PushSubscription): void;
    /**
     * Remove a subscription (e.g., if it expired or user unsubscribed)
     */
    removeSubscription(endpoint: string): void;
    /**
     * Get all active subscriptions
     */
    getAllSubscriptions(): PushSubscription[];
}
declare const _default: StorageService;
export default _default;
//# sourceMappingURL=StorageService.d.ts.map