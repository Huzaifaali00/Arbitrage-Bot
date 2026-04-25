export declare enum NotificationLevel {
    INFO = "INFO",
    WARN = "WARN",
    CRITICAL = "CRITICAL"
}
export interface NotificationPayload {
    title: string;
    message: string;
    level: NotificationLevel;
    user?: string;
    metadata?: Record<string, any>;
}
export declare class NotificationService {
    constructor();
    /**
     * Sends a notification to the user via Web Push
     */
    notify(payload: NotificationPayload): Promise<void>;
    private sendWebPush;
}
declare const _default: NotificationService;
export default _default;
//# sourceMappingURL=NotificationService.d.ts.map