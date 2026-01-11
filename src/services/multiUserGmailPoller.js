import { google } from 'googleapis';
import { convert } from 'html-to-text';
import { User } from '../models/User.model.js';
import { Transaction } from '../models/Transaction.model.js';
import { PendingTransaction } from '../models/PendingTransaction.model.js';
import { parseTransactionMessage } from '../utils/transactionParser.js';
import { notificationService } from './notificationService.js';
import logger from '../utils/logger.js';
import * as Sentry from '@sentry/node';

/**
 * Multi-User Gmail API Email Poller Service
 * Fetches and processes transaction emails from Gmail for all users with enabled integration
 */
export class MultiUserGmailPollerService {
    constructor() {
        this.isPolling = false;
        this.pollInterval = 60000; // 60 seconds
        this.processedMessageIds = new Map(); // userId -> Set of message IDs
    }

    /**
     * Create OAuth2 client for a user
     */
    createOAuth2Client(tokens) {
        const oauth2Client = new google.auth.OAuth2(
            process.env.GMAIL_CLIENT_ID || process.env.GOOGLE_CLIENT_ID,
            process.env.GMAIL_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET,
            process.env.GMAIL_REDIRECT_URI
        );

        oauth2Client.setCredentials({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expiry_date: tokens.expiry_date
        });

        // Setup automatic token refresh
        oauth2Client.on('tokens', async (newTokens) => {
            logger.info('Token refreshed for user, updating in database');
            // Note: Need userId context to update - handled in processUserEmails
        });

        return oauth2Client;
    }

    /**
     * Start polling for all users
     */
    async start() {
        if (this.isPolling) {
            logger.warn('Gmail poller already running');
            return;
        }

        const gmailEnabled = process.env.GMAIL_ENABLED === 'true';
        if (!gmailEnabled) {
            logger.info('📧 Gmail integration is disabled via GMAIL_ENABLED flag');
            return;
        }

        this.isPolling = true;
        logger.info('🚀 Starting multi-user Gmail poller...');
        
        // Start polling loop
        this.poll();
    }

    /**
     * Stop polling
     */
    stop() {
        this.isPolling = false;
        if (this.pollTimeout) {
            clearTimeout(this.pollTimeout);
        }
        logger.info('🛑 Multi-user Gmail poller stopped');
    }

    /**
     * Main polling loop
     */
    async poll() {
        if (!this.isPolling) return;

        try {
            await this.fetchAndProcessAllUsers();
        } catch (error) {
            logger.error('Error in Gmail polling loop', { error: error.message });
            Sentry.captureException(error, { tags: { service: 'gmail_poller' } });
        }

        // Schedule next poll
        this.pollTimeout = setTimeout(() => this.poll(), this.pollInterval);
    }

    /**
     * Fetch and process emails for all users with Gmail integration enabled
     */
    async fetchAndProcessAllUsers() {
        try {
            // Find all users with Gmail integration enabled
            const users = await User.find({ 
                'gmailIntegration.enabled': true,
                'gmailIntegration.tokens.access_token': { $exists: true }
            }).select('_id email gmailIntegration');

            if (users.length === 0) {
                logger.debug('No users with Gmail integration enabled');
                return;
            }

            logger.info(`📧 Processing Gmail for ${users.length} user(s)`);

            // Process each user sequentially to avoid rate limits
            for (const user of users) {
                try {
                    await this.processUserEmails(user);
                } catch (error) {
                    logger.error(`Error processing Gmail for user ${user.email}`, { 
                        error: error.message,
                        userId: user._id 
                    });
                    Sentry.captureException(error, { 
                        tags: { service: 'gmail_poller', userId: user._id.toString() },
                        user: { id: user._id.toString(), email: user.email }
                    });
                }

                // Small delay between users to avoid rate limits
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        } catch (error) {
            logger.error('Error fetching users for Gmail polling', { error: error.message });
            Sentry.captureException(error, { tags: { service: 'gmail_poller' } });
        }
    }

    /**
     * Process emails for a specific user
     */
    async processUserEmails(user) {
        try {
            // Create OAuth2 client with user's tokens
            const oauth2Client = this.createOAuth2Client(user.gmailIntegration.tokens);
            const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

            // Initialize processed messages set for this user if not exists
            if (!this.processedMessageIds.has(user._id.toString())) {
                this.processedMessageIds.set(user._id.toString(), new Set());
            }

            // Build query for transaction emails
            const query = [
                'is:unread',
                '(from:*@*bank.* OR from:*@paytm.* OR from:*@amazonpay.* OR from:*@googlepay.* OR from:*@phonepe.*)',
                '(subject:transaction OR subject:debited OR subject:credited OR subject:payment)',
                '-category:promotions',
                '-category:social'
            ].join(' ');

            // Fetch messages
            const response = await gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: 20
            });

            const messages = response.data.messages || [];
            
            if (messages.length === 0) {
                logger.debug(`No new transaction emails for user ${user.email}`);
                return;
            }

            logger.info(`Found ${messages.length} potential transaction email(s) for ${user.email}`);

            // Process each message
            for (const message of messages) {
                try {
                    // Skip if already processed
                    const processedSet = this.processedMessageIds.get(user._id.toString());
                    if (processedSet.has(message.id)) {
                        continue;
                    }

                    // Fetch full message
                    const fullMessage = await gmail.users.messages.get({
                        userId: 'me',
                        id: message.id,
                        format: 'full'
                    });

                    // Process the message
                    await this.processMessage(fullMessage.data, user);

                    // Mark as processed
                    processedSet.add(message.id);

                    // Mark as read in Gmail
                    await this.markAsRead(gmail, message.id);

                } catch (error) {
                    logger.error(`Error processing message ${message.id} for user ${user.email}`, { 
                        error: error.message 
                    });
                }
            }

            // Update last sync time
            await User.findByIdAndUpdate(user._id, {
                'gmailIntegration.lastSync': new Date()
            });

            // Check if tokens were refreshed during this process
            const currentCredentials = oauth2Client.credentials;
            if (currentCredentials.access_token !== user.gmailIntegration.tokens.access_token) {
                // Tokens were refreshed, update in database
                await User.findByIdAndUpdate(user._id, {
                    'gmailIntegration.tokens': {
                        access_token: currentCredentials.access_token,
                        refresh_token: currentCredentials.refresh_token,
                        expiry_date: currentCredentials.expiry_date
                    }
                });
                logger.info(`Updated refreshed tokens for user ${user.email}`);
            }

        } catch (error) {
            if (error.code === 401 || error.message.includes('invalid_grant')) {
                // Token expired or revoked, disable integration
                logger.error(`Gmail authorization invalid for user ${user.email}, disabling integration`);
                await User.findByIdAndUpdate(user._id, {
                    'gmailIntegration.enabled': false
                });
            }
            throw error;
        }
    }

    /**
     * Process a single message
     */
    async processMessage(message, user) {
        try {
            // Extract headers
            const headers = {};
            message.payload.headers.forEach(header => {
                headers[header.name.toLowerCase()] = header.value;
            });

            const from = headers['from'] || '';
            const subject = headers['subject'] || '';
            const date = headers['date'] ? new Date(headers['date']) : new Date();

            // Extract body
            let body = '';
            if (message.payload.body.data) {
                body = Buffer.from(message.payload.body.data, 'base64').toString('utf-8');
            } else if (message.payload.parts) {
                for (const part of message.payload.parts) {
                    if (part.mimeType === 'text/plain' && part.body.data) {
                        body += Buffer.from(part.body.data, 'base64').toString('utf-8');
                    } else if (part.mimeType === 'text/html' && part.body.data) {
                        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
                        body += convert(html, { wordwrap: 130 });
                    }
                }
            }

            const messageText = `${subject}\n\n${body}`;

            // Parse transaction
            const parsed = parseTransactionMessage(messageText);
            
            if (!parsed) {
                logger.debug(`Could not parse transaction from email: ${subject.substring(0, 50)}`);
                return;
            }

            // Calculate confidence score based on parsing quality
            const confidenceScore = this.calculateConfidenceScore(parsed, messageText);

            // Create pending transaction for user approval
            const pendingTransaction = await PendingTransaction.create({
                user: user._id,
                parsedData: {
                    amount: parsed.amount,
                    type: parsed.type,
                    description: parsed.description || `Email from ${from}`,
                    category: parsed.category || 'Other',
                    merchant: parsed.merchant,
                    date: parsed.date || date,
                    accountNumber: parsed.accountNumber,
                    balance: parsed.balance,
                    paymentMethod: parsed.paymentMethod
                },
                source: {
                    type: 'gmail',
                    emailId: message.id,
                    rawContent: messageText,
                    subject: subject
                },
                confidenceScore: confidenceScore,
                status: 'pending'
            });

            logger.info(`📬 Created pending transaction from Gmail for user ${user.email}`, {
                pendingId: pendingTransaction._id,
                amount: parsed.amount,
                type: parsed.type,
                confidence: confidenceScore,
                userId: user._id
            });

            // Send push notification if user has device tokens
            if (user.deviceTokens && user.deviceTokens.length > 0) {
                for (const token of user.deviceTokens) {
                    try {
                        await notificationService.sendPendingTransactionNotification(
                            user._id,
                            token,
                            {
                                _id: pendingTransaction._id,
                                amount: parsed.amount,
                                type: parsed.type,
                                merchant: parsed.merchant,
                                category: parsed.category
                            }
                        );
                        
                        // Mark notification as sent
                        pendingTransaction.notificationSent = true;
                        pendingTransaction.notificationSentAt = new Date();
                        await pendingTransaction.save();
                        
                        break; // Only send to first valid token
                    } catch (notifError) {
                        logger.warn(`Failed to send notification to token`, { 
                            userId: user._id, 
                            error: notifError.message 
                        });
                    }
                }
            }

        } catch (error) {
            logger.error('Error processing message', { 
                error: error.message,
                messageId: message.id 
            });
            throw error;
        }
    }

    /**
     * Calculate confidence score for parsed transaction
     * Returns value between 0 and 1
     */
    calculateConfidenceScore(parsed, messageText) {
        let score = 0.5; // Base score

        // Higher confidence if we found specific fields
        if (parsed.merchant) score += 0.1;
        if (parsed.accountNumber) score += 0.1;
        if (parsed.balance) score += 0.1;
        if (parsed.paymentMethod) score += 0.1;
        if (parsed.category && parsed.category !== 'Other') score += 0.1;

        // Lower confidence if amount is very high (might be error)
        if (parsed.amount > 100000) score -= 0.2;

        // Check if message contains transaction keywords
        const transactionKeywords = ['debited', 'credited', 'spent', 'paid', 'received', 'transaction', 'purchase'];
        const hasKeywords = transactionKeywords.some(keyword => 
            messageText.toLowerCase().includes(keyword)
        );
        if (hasKeywords) score += 0.1;

        return Math.min(Math.max(score, 0), 1); // Clamp between 0 and 1
    }

    /**
     * Mark message as read in Gmail
     */
    async markAsRead(gmail, messageId) {
        try {
            await gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    removeLabelIds: ['UNREAD']
                }
            });
            logger.debug(`Marked message ${messageId} as read`);
        } catch (error) {
            logger.error(`Failed to mark message ${messageId} as read`, { error: error.message });
        }
    }

    /**
     * Manual trigger for a specific user (for testing)
     */
    async triggerForUser(userId) {
        try {
            const user = await User.findById(userId).select('_id email gmailIntegration');
            
            if (!user) {
                throw new Error('User not found');
            }

            if (!user.gmailIntegration?.enabled) {
                throw new Error('Gmail integration not enabled for this user');
            }

            await this.processUserEmails(user);
            return { success: true, message: 'Gmail processing triggered' };
        } catch (error) {
            logger.error('Error triggering Gmail processing for user', { 
                error: error.message,
                userId 
            });
            throw error;
        }
    }
}

// Create and export singleton instance
export const multiUserGmailPoller = new MultiUserGmailPollerService();
