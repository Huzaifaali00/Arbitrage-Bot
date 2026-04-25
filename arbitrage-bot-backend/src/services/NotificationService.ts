// src/services/NotificationService.ts
import logger from "../utils/logger";
import webpush from "web-push";
import storageService from "./StorageService";
import dotenv from "dotenv";

dotenv.config();

export enum NotificationLevel {
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

export class NotificationService {
    constructor() {
        const publicKey = process.env.VAPID_PUBLIC_KEY;
        const privateKey = process.env.VAPID_PRIVATE_KEY;
        const subject = process.env.VAPID_SUBJECT || "mailto:admin@mevbot.io";

        if (publicKey && privateKey) {
            webpush.setVapidDetails(subject, publicKey, privateKey);
            logger.info("NotificationService: VAPID details set for Web Push");
        } else {
            logger.warn("NotificationService: VAPID keys missing in .env. Web Push disabled.");
        }
    }

    /**
     * Sends a notification to the user via Web Push
     */
    async notify(payload: NotificationPayload): Promise<void> {
        const { title, message, level, user, metadata } = payload;

        // 1. Log the notification
        const logMsg = `[NOTIFICATION][${level}] ${title}: ${message}`;
        if (level === NotificationLevel.CRITICAL) {
            logger.error(logMsg, { user, ...metadata });
        } else if (level === NotificationLevel.WARN) {
            logger.warn(logMsg, { user, ...metadata });
        } else {
            logger.info(logMsg, { user, ...metadata });
        }

        // 2. Send Web Push to all active subscriptions
        await this.sendWebPush(payload);
    }

    private async sendWebPush(payload: NotificationPayload): Promise<void> {
        const subscriptions = storageService.getAllSubscriptions();
        
        if (subscriptions.length === 0) {
            logger.debug("NotificationService: No active push subscriptions found");
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
                await webpush.sendNotification(sub as any, pushPayload);
            } catch (error: any) {
                if (error.statusCode === 410 || error.statusCode === 404) {
                    // Subscription expired or invalid, remove it
                    logger.info("NotificationService: Removing expired subscription", { endpoint: sub.endpoint });
                    storageService.removeSubscription(sub.endpoint);
                } else {
                    logger.error("NotificationService: Push delivery failed", { 
                        endpoint: sub.endpoint, 
                        error: error.message 
                    });
                }
            }
        });

        await Promise.allSettled(promises);
    }
}

export default new NotificationService();
