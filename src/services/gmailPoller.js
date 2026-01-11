import { google } from 'googleapis';
import { convert } from 'html-to-text';
import { User } from '../models/User.model.js';
import { Transaction } from '../models/Transaction.model.js';
import { parseTransactionMessage } from '../utils/transactionParser.js';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import * as Sentry from '@sentry/node';
import fs from 'fs/promises';
import path from 'path';

/**
 * Gmail API Email Poller Service
 * Fetches and processes transaction emails from Gmail inbox using Gmail API
 */
export class GmailPollerService {
    constructor() {
        this.isPolling = false;
        this.pollInterval = 30000; // 30 seconds
        this.processedMessageIds = new Set();
        this.oauth2Client = null;
        this.gmail = null;
        this.authorizedUserEmail = null; // Store authorized Gmail account email
    }

    /**
     * Initialize OAuth2 client with credentials
     */
    async initialize() {
        try {
            const credentials = {
                client_id: process.env.GMAIL_CLIENT_ID,
                client_secret: process.env.GMAIL_CLIENT_SECRET,
                redirect_uris: [process.env.GMAIL_REDIRECT_URI || 'http://localhost:3000/oauth2callback']
            };

            this.oauth2Client = new google.auth.OAuth2(
                credentials.client_id,
                credentials.client_secret,
                credentials.redirect_uris[0]
            );

            // Load saved tokens if exists
            const tokenPath = path.join(process.cwd(), 'gmail-tokens.json');
            try {
                const tokenData = await fs.readFile(tokenPath, 'utf8');
                const tokens = JSON.parse(tokenData);
                this.oauth2Client.setCredentials(tokens);
                
                // Setup automatic token refresh
                this.oauth2Client.on('tokens', async (tokens) => {
                    if (tokens.refresh_token) {
                        await this.saveTokens(tokens);
                    }
                });

                this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
                logger.info('✅ Gmail API initialized with saved tokens');
                
                // Get authorized user email
                await this.fetchAuthorizedUserEmail();
                
                return true;
            } catch (error) {
                logger.warn('⚠️ No saved tokens found. Please authorize the app first.');
                logger.info('🔗 Authorization URL: ' + this.getAuthUrl());
                return false;
            }
        } catch (error) {
            logger.error('Gmail API initialization error', { error: error.message });
            Sentry.captureException(error, { tags: { service: 'gmail_poller' } });
            return false;
        }
    }

    /**
     * Get OAuth2 authorization URL
     */
    getAuthUrl() {
        const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
        return this.oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent' // Force to get refresh token
        });
    }

    /**
     * Fetch the email address of the authorized Gmail account
     */
    async fetchAuthorizedUserEmail() {
        try {
            const profile = await this.gmail.users.getProfile({ userId: 'me' });
            this.authorizedUserEmail = profile.data.emailAddress;
            logger.info(`📧 Authorized Gmail account: ${this.authorizedUserEmail}`);
            return this.authorizedUserEmail;
        } catch (error) {
            logger.error('Failed to fetch authorized user email', { error: error.message });
            throw error;
        }
    }

    /**
     * Exchange authorization code for tokens
     */
    async authorizeWithCode(code) {
        try {
            const { tokens } = await this.oauth2Client.getToken(code);
            this.oauth2Client.setCredentials(tokens);
            await this.saveTokens(tokens);
            this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
            logger.info('✅ Gmail API authorized successfully');
            return true;
        } catch (error) {
            logger.error('Gmail authorization error', { error: error.message });
            throw error;
        }
    }

    /**
     * Save tokens to file
     */
    async saveTokens(tokens) {
        const tokenPath = path.join(process.cwd(), 'gmail-tokens.json');
        await fs.writeFile(tokenPath, JSON.stringify(tokens, null, 2));
        logger.info('💾 Tokens saved to gmail-tokens.json');
    }

    /**
     * Start polling Gmail inbox
     */
    async start() {
        if (this.isPolling) {
            logger.warn('📧 Gmail Poller already running');
            return;
        }

        const initialized = await this.initialize();
        if (!initialized) {
            logger.error('❌ Gmail Poller cannot start - not authorized');
            return;
        }

        this.isPolling = true;
        this.pollLoop();
        logger.info('📧 Gmail Poller Service Started');
    }

    /**
     * Stop polling
     */
    stop() {
        this.isPolling = false;
        this.processedMessageIds.clear();
        logger.info('📧 Gmail Poller Service Stopped');
    }

    /**
     * Main polling loop
     */
    async pollLoop() {
        while (this.isPolling) {
            try {
                await this.fetchAndProcessEmails();
                await new Promise(resolve => setTimeout(resolve, this.pollInterval));
            } catch (error) {
                logger.error('Gmail Poller Error', { error: error.message });
                Sentry.captureException(error, { tags: { service: 'gmail_poller' } });
                await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 1 min on error
            }
        }
    }

    /**
     * Fetch and process emails from Gmail
     */
    async fetchAndProcessEmails() {
        try {
            // Query for unread transaction-related emails
            const query = 'is:unread (from:alerts OR from:transactions OR from:bank OR subject:payment OR subject:transaction OR subject:spent OR subject:debited OR subject:credited OR subject:alert OR subject:purchase)';
            
            if (process.env.NODE_ENV === 'development') {
                logger.debug(`Gmail query: ${query}`);
                logger.debug(`Authorized user email: ${this.authorizedUserEmail}`);
            }
            
            const response = await this.gmail.users.messages.list({
                userId: 'me',
                q: query,
                maxResults: 10
            });

            const messages = response.data.messages || [];
            
            if (messages.length === 0) {
                return;
            }

            logger.info(`📧 Found ${messages.length} Gmail messages to process`);

            for (const message of messages) {
                if (this.processedMessageIds.has(message.id)) {
                    continue;
                }

                await this.processMessage(message.id);
                this.processedMessageIds.add(message.id);

                // Prevent memory leak
                if (this.processedMessageIds.size > 1000) {
                    const firstItem = this.processedMessageIds.values().next().value;
                    this.processedMessageIds.delete(firstItem);
                }
            }
        } catch (error) {
            if (error.code === 401) {
                logger.error('❌ Gmail API authentication expired. Please re-authorize.');
                this.isPolling = false;
            }
            throw error;
        }
    }

    /**
     * Process individual Gmail message
     */
    async processMessage(messageId) {
        try {
            // Fetch full message details
            const message = await this.gmail.users.messages.get({
                userId: 'me',
                id: messageId,
                format: 'full'
            });

            const { payload, snippet, internalDate } = message.data;

            // Extract headers
            const headers = payload.headers || [];
            const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || '';
            const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || '';
            const to = headers.find(h => h.name.toLowerCase() === 'to')?.value || '';

            // Extract body
            let emailBody = '';
            
            if (payload.parts) {
                // Multipart email
                for (const part of payload.parts) {
                    if (part.mimeType === 'text/plain' && part.body?.data) {
                        emailBody = Buffer.from(part.body.data, 'base64').toString('utf-8');
                        break;
                    } else if (part.mimeType === 'text/html' && part.body?.data && !emailBody) {
                        const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
                        emailBody = convert(html, { wordwrap: 130 });
                    }
                }
            } else if (payload.body?.data) {
                // Simple email
                const bodyData = Buffer.from(payload.body.data, 'base64').toString('utf-8');
                if (payload.mimeType === 'text/html') {
                    emailBody = convert(bodyData, { wordwrap: 130 });
                } else {
                    emailBody = bodyData;
                }
            }

            // Use snippet as fallback
            if (!emailBody) {
                emailBody = snippet || '';
            }

            logger.info(`📧 Processing Gmail: "${subject}" from ${from} to ${to}`);

            // Find user by authorized Gmail account email
            if (!this.authorizedUserEmail) {
                logger.error('❌ Authorized user email not available');
                await this.markAsRead(messageId);
                return;
            }

            logger.debug(`Looking for user with email: ${this.authorizedUserEmail}`);
            const user = await User.findOne({ email: this.authorizedUserEmail });
            
            if (!user) {
                logger.warn(`📧 No user found with email: ${this.authorizedUserEmail}. Please register this email in the app first.`);
                await this.markAsRead(messageId);
                return;
            }

            await this.parseAndCreateTransaction(user, subject, emailBody, messageId, internalDate);

            // Mark as read after successful processing
            await this.markAsRead(messageId);

            // Mark as read after successful processing
            await this.markAsRead(messageId);

        } catch (error) {
            logger.error(`Error processing Gmail message ${messageId}`, { error: error.message });
            Sentry.captureException(error);
        }
    }

    /**
     * Parse email content and create transaction
     */
    async parseAndCreateTransaction(user, subject, body, messageId, timestamp) {
        try {
            // Combine subject and body for better parsing
            const fullMessage = `${subject} ${body}`;
            const parsedData = parseTransactionMessage(fullMessage);

            if (parsedData.error || !parsedData.isParsed) {
                logger.warn(`📧 Could not parse transaction from Gmail: ${subject}`);
                return;
            }

            const {
                amount, merchant, paymentMethod, category, subCategory, type
            } = parsedData;

            // Deduplication using messageId
            const messageHash = crypto.createHash('sha256').update(messageId).digest('hex');

            const isDuplicate = await Transaction.findOne({ 
                user: user.id, 
                messageHash 
            });

            if (isDuplicate) {
                logger.info(`📧 Duplicate Gmail transaction detected for user ${user.id}`);
                return;
            }

            // Create Transaction
            const transaction = new Transaction({
                user: user.id,
                amount,
                currency: 'INR',
                category,
                subCategory,
                merchant,
                note: `Parsed from Gmail: ${subject}`,
                paymentMethod,
                source: 'gmail',
                tags: ['parsed', 'gmail'],
                timestamp: new Date(parseInt(timestamp)),
                messageHash
            });

            await transaction.save();
            logger.info(`✅ Created transaction via Gmail for user ${user.email}: ${amount} at ${merchant}`);

        } catch (error) {
            logger.error('Error creating transaction from Gmail', { error: error.message });
            Sentry.captureException(error);
        }
    }

    /**
     * Mark message as read
     */
    async markAsRead(messageId) {
        try {
            await this.gmail.users.messages.modify({
                userId: 'me',
                id: messageId,
                requestBody: {
                    removeLabelIds: ['UNREAD']
                }
            });
            logger.debug(`Marked Gmail message ${messageId} as read`);
        } catch (error) {
            logger.error(`Error marking Gmail message ${messageId} as read`, { error: error.message });
        }
    }
}

export const gmailPoller = new GmailPollerService();
