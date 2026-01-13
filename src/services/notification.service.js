import logger from '../utils/logger.js';
import * as Sentry from '@sentry/node';

// Lazy import Firebase Admin (optional dependency)
let admin = null;

/**
 * Notification Service using Firebase Cloud Messaging (FCM)
 * Handles push notifications for pending transactions and other events
 */
class NotificationService {
    constructor() {
        this.initialized = false;
        this.initialize();
    }

    async initialize() {
        try {
            // Check if Firebase credentials are provided
            if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
                logger.warn('Firebase service account not configured. Push notifications disabled.');
                return;
            }

            // Try to import firebase-admin (optional dependency)
            try {
                admin = (await import('firebase-admin')).default;
            } catch (importError) {
                logger.warn('firebase-admin package not installed. Push notifications disabled. Install with: npm install firebase-admin');
                return;
            }

            // Parse service account JSON
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

            // Initialize Firebase Admin
            if (!admin.apps.length) {
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount)
                });
                this.initialized = true;
                logger.info('✅ Firebase Admin initialized for push notifications');
            }
        } catch (error) {
            logger.error('Failed to initialize Firebase Admin', { error: error.message });
            Sentry.captureException(error);
        }
    }

    /**
     * Send pending transaction notification
     */
    async sendPendingTransactionNotification(userId, deviceToken, transactionData) {
        if (!this.initialized) {
            logger.warn('Push notifications not available - Firebase not initialized');
            return { success: false, reason: 'not_initialized' };
        }

        try {
            const message = {
                notification: {
                    title: '💰 New Transaction Detected',
                    body: `${transactionData.type === 'expense' ? 'Spent' : 'Received'} ₹${transactionData.amount} ${transactionData.merchant ? `at ${transactionData.merchant}` : ''}`,
                },
                data: {
                    type: 'pending_transaction',
                    pendingTransactionId: transactionData._id.toString(),
                    amount: transactionData.amount.toString(),
                    merchant: transactionData.merchant || '',
                    category: transactionData.category || '',
                    click_action: 'PENDING_TRANSACTIONS'
                },
                token: deviceToken,
                android: {
                    priority: 'high',
                    notification: {
                        channelId: 'pending_transactions',
                        priority: 'high',
                        sound: 'default'
                    }
                },
                apns: {
                    payload: {
                        aps: {
                            sound: 'default',
                            badge: 1
                        }
                    }
                }
            };

            const response = await admin.messaging().send(message);
            logger.info('Push notification sent', { userId, messageId: response });
            
            return { success: true, messageId: response };
        } catch (error) {
            logger.error('Failed to send push notification', {
                userId,
                error: error.message,
                errorCode: error.code
            });
            
            // Handle specific errors
            if (error.code === 'messaging/invalid-registration-token' ||
                error.code === 'messaging/registration-token-not-registered') {
                // Token is invalid - should be removed from user's device tokens
                return { success: false, reason: 'invalid_token', shouldRemoveToken: true };
            }
            
            Sentry.captureException(error);
            return { success: false, reason: error.code || 'unknown_error' };
        }
    }

    /**
     * Send batch notifications (for multiple users)
     */
    async sendBatchNotifications(notifications) {
        if (!this.initialized) {
            logger.warn('Push notifications not available - Firebase not initialized');
            return { successCount: 0, failureCount: notifications.length };
        }

        try {
            const messages = notifications.map(notif => ({
                notification: notif.notification,
                data: notif.data || {},
                token: notif.deviceToken,
                android: {
                    priority: 'high',
                    notification: {
                        channelId: notif.channelId || 'default',
                        priority: 'high'
                    }
                }
            }));

            const response = await admin.messaging().sendAll(messages);
            
            logger.info('Batch notifications sent', {
                successCount: response.successCount,
                failureCount: response.failureCount
            });

            return response;
        } catch (error) {
            logger.error('Failed to send batch notifications', { error: error.message });
            Sentry.captureException(error);
            return { successCount: 0, failureCount: notifications.length };
        }
    }

    /**
     * Send transaction approved notification
     */
    async sendTransactionApprovedNotification(deviceToken, transactionData) {
        if (!this.initialized) return { success: false };

        try {
            const message = {
                notification: {
                    title: '✅ Transaction Confirmed',
                    body: `Transaction of ₹${transactionData.amount} has been added to your records`,
                },
                data: {
                    type: 'transaction_approved',
                    transactionId: transactionData._id.toString()
                },
                token: deviceToken
            };

            const response = await admin.messaging().send(message);
            return { success: true, messageId: response };
        } catch (error) {
            logger.error('Failed to send approval notification', { error: error.message });
            return { success: false };
        }
    }

    /**
     * Subscribe token to topic
     */
    async subscribeToTopic(tokens, topic) {
        if (!this.initialized) return { success: false };

        try {
            const tokensArray = Array.isArray(tokens) ? tokens : [tokens];
            const response = await admin.messaging().subscribeToTopic(tokensArray, topic);
            logger.info('Subscribed to topic', { topic, successCount: response.successCount });
            return response;
        } catch (error) {
            logger.error('Failed to subscribe to topic', { error: error.message });
            return { success: false };
        }
    }
}

// Export singleton instance
export const notificationService = new NotificationService();
