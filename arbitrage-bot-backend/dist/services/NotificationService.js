"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationService = exports.NotificationLevel = void 0;
// src/services/NotificationService.ts
const logger_1 = __importDefault(require("../utils/logger"));
const web_push_1 = __importDefault(require("web-push"));
const StorageService_1 = __importDefault(require("./StorageService"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
var NotificationLevel;
(function (NotificationLevel) {
    NotificationLevel["INFO"] = "INFO";
    NotificationLevel["WARN"] = "WARN";
    NotificationLevel["CRITICAL"] = "CRITICAL";
})(NotificationLevel || (exports.NotificationLevel = NotificationLevel = {}));
class NotificationService {
    constructor() {
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        const privateKey = process.env.VAPID_PRIVATE_KEY;
        const subject = process.env.VAPID_SUBJECT || "mailto:admin@mevbot.io";
        if (publicKey && privateKey) {
            web_push_1.default.setVapidDetails(subject, publicKey, privateKey);
            logger_1.default.info("NotificationService: VAPID details set for Web Push");
        }
        else {
            logger_1.default.warn("NotificationService: VAPID keys missing in .env. Web Push disabled.");
        }
    }
    /**
     * Sends a notification to the user via Web Push
     */
    async notify(payload) {
        const { title, message, level, user, metadata } = payload;
        // 1. Log the notification
        const logMsg = `[NOTIFICATION][${level}] ${title}: ${message}`;
        if (level === NotificationLevel.CRITICAL) {
            logger_1.default.error(logMsg, { user, ...metadata });
        }
        else if (level === NotificationLevel.WARN) {
            logger_1.default.warn(logMsg, { user, ...metadata });
        }
        else {
            logger_1.default.info(logMsg, { user, ...metadata });
        }
        // 2. Send Web Push to all active subscriptions
        await this.sendWebPush(payload);
    }
    async sendWebPush(payload) {
        const subscriptions = StorageService_1.default.getAllSubscriptions();
        if (subscriptions.length === 0) {
            logger_1.default.debug("NotificationService: No active push subscriptions found");
            return;
        }
        const pushPayload = JSON.stringify({
            title: payload.title,
            body: payload.message,
            icon: "/favicon.ico", // Standard icon
            badge: "/badge.png",
            data: {
                level: payload.level,
                timestamp: Date.now(),
                ...payload.metadata
            }
        });
        const promises = subscriptions.map(async (sub) => {
            try {
                await web_push_1.default.sendNotification(sub, pushPayload);
            }
            catch (error) {
                if (error.statusCode === 410 || error.statusCode === 404) {
                    // Subscription expired or invalid, remove it
                    logger_1.default.info("NotificationService: Removing expired subscription", { endpoint: sub.endpoint });
                    StorageService_1.default.removeSubscription(sub.endpoint);
                }
                else {
                    logger_1.default.error("NotificationService: Push delivery failed", {
                        endpoint: sub.endpoint,
                        error: error.message
                    });
                }
            }
        });
        await Promise.allSettled(promises);
    }
}
exports.NotificationService = NotificationService;
exports.default = new NotificationService();
//# sourceMappingURL=NotificationService.js.map