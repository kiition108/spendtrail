import { convert } from 'html-to-text';
import { User } from '../models/User.model.js';
import { PendingTransaction } from '../models/PendingTransaction.model.js';
import { parseTransactionMessage } from '../utils/transactionParser.js';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import * as Sentry from '@sentry/node';

// Testmail Configuration
// Testmail Configuration
const TESTMAIL_NAMESPACE = process.env.TESTMAIL_NAMESPACE || 'e1wpm';
const TESTMAIL_API_KEY = process.env.TESTMAIL_API_KEY || 'a04e4d08-8e8f-45b5-995e-50b7be6896df';

export class EmailPollerService {
    constructor() {
        this.isPolling = false;
        this.pollInterval = 10000; // 10 seconds fallback, though Live Query handles wait
        this.processedEmailIds = new Set(); // Track processed emails
    }

    start() {
        if (this.isPolling) {
            logger.warn('📧 Email Poller already running');
            return;
        }
        this.isPolling = true;
        this.pollLoop();
        logger.info('📧 Email Poller Service Started');
    }

    stop() {
        this.isPolling = false;
        this.processedEmailIds.clear();
        logger.info('📧 Email Poller Service Stopped');
    }

    async pollLoop() {
        while (this.isPolling) {
            try {
                const shouldWait = await this.fetchAndProcessEmails();
                if (shouldWait) {
                    await new Promise(resolve => setTimeout(resolve, 60000)); // Wait 60s on error/rate limit
                } else {
                    // Small safety delay even on success/timeout to prevent tight loops
                    // Increased to 10s to stay well within 1000 calls/hour limit for free tier
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
            } catch (error) {
                logger.error('Email Poller Error - Testmail API fetch failed', { 
                    error: error.message,
                    code: error.code,
                    cause: error.cause?.message
                });
                Sentry.captureException(error, { tags: { service: 'email_poller', api: 'testmail' } });
                // Wait before retrying on crash
                await new Promise(resolve => setTimeout(resolve, 60000));
            }
        }
    }

    /**
     * @returns {Promise<boolean>} true if we should backoff (error occurred), false otherwise
     */
    async fetchAndProcessEmails() {
        // Construct polling URL with livequery=true for long polling
        // Using a wildcard tag to catch all emails sent to e1wpm.*@inbox.testmail.app
        const url = `https://api.testmail.app/api/json?namespace=${TESTMAIL_NAMESPACE}&apikey=${TESTMAIL_API_KEY}&livequery=true`;

        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.result === 'success') {
                if (data.emails && data.emails.length > 0) {
                    // Filter out already processed emails
                    const newEmails = data.emails.filter(email => {
                        const emailId = email.tag + email.timestamp; // Unique identifier
                        return !this.processedEmailIds.has(emailId);
                    });

                    if (newEmails.length > 0) {
                        logger.info(`📧 Received ${newEmails.length} new emails (${data.emails.length - newEmails.length} already processed)`);
                        for (const email of newEmails) {
                            const emailId = email.tag + email.timestamp;
                            await this.processEmail(email);
                            this.processedEmailIds.add(emailId);
                            
                            // Prevent memory leak - keep only last 1000 email IDs
                            if (this.processedEmailIds.size > 1000) {
                                const firstItem = this.processedEmailIds.values().next().value;
                                this.processedEmailIds.delete(firstItem);
                            }
                        }
                    }
                }
                return false; // Success, continue polling
            } else if (data.message === 'Timeout') {
                return false; // Timeout is normal for livequery, continue polling
            } else {
                // Log unexpected errors (rate limits, auth errors, etc)
                logger.warn('Testmail API response:', data);
                return true; // Request backoff
            }
        } catch (err) {
            throw err; // Let outer loop catch network errors
        }
    }

    async processEmail(emailData) {
        try {
            const { subject, html, text, from, tag } = emailData;

            // Strategy 1: Match by Sender Email (Forwarding use case)
            // Extract pure email from "Name <email@domain.com>" format
            const senderMatch = from.match(/<(.+)>/);
            const senderEmail = senderMatch ? senderMatch[1] : from;

            // Find user who has this email registered
            const user = await User.findOne({ email: senderEmail });

            if (!user) {
                logger.warn(`📧 Received email from unknown user: ${senderEmail}`);
                return;
            }

            // --- VERIFICATION LOGIC ---
            if (tag && tag.toLowerCase().startsWith('verify')) {
                if (!user.isVerified) {
                    user.isVerified = true;
                    user.otp = undefined; // Clear OTP as they are verified
                    user.otpExpires = undefined;
                    await user.save();
                    logger.info(`✅ User verified via email: ${senderEmail}`);
                } else {
                    logger.info(`ℹ️ User already verified: ${senderEmail}`);
                }
                return; // Stop processing, don't parse as transaction
            }
            // ---------------------------

            // Determine the email content (prefer text, fallback to html conversion)
            const rawMessage = text || convert(html || '', { wordwrap: 130 });
            if (!rawMessage) return;

            // Parse Transaction Details
            // Combine subject and body for better context
            const fullMessage = `${subject} ${rawMessage}`;
            const parsedData = parseTransactionMessage(fullMessage);

            if (parsedData.error || !parsedData.isParsed) {
                logger.warn(`📧 Could not parse transaction from email: ${subject}`);
                return;
            }

            const {
                amount, merchant, paymentMethod, category, subCategory, type
            } = parsedData;

            // Deduplication - Check both pending and existing transactions
            const dateStr = new Date().toISOString().slice(0, 10);
            const dedupeKey = `${amount}_${merchant}_${dateStr}_${user.id}`;
            const messageHash = crypto.createHash('sha256').update(dedupeKey).digest('hex');

            const isDuplicate = await PendingTransaction.findOne({ 
                user: user.id, 
                'source.emailId': messageHash 
            });
            
            if (isDuplicate) {
                logger.info(`📧 Duplicate transaction detected for user ${user.id}`);
                return;
            }

            // Calculate confidence score (testmail.app has lower confidence than Gmail OAuth)
            const confidenceScore = 0.7; // Medium confidence for forwarded emails

            // Create Pending Transaction for user approval
            const pendingTransaction = await PendingTransaction.create({
                user: user.id,
                parsedData: {
                    amount,
                    type: type || 'expense',
                    description: `Parsed from Email: ${subject}`,
                    category: category || 'Other',
                    merchant: merchant || 'Unknown',
                    date: new Date(emailData.timestamp || Date.now()),
                    paymentMethod: paymentMethod || 'email',
                },
                source: {
                    type: 'email',
                    emailId: messageHash,
                    rawContent: rawMessage,
                    subject: subject,
                    from: from,
                    parsingStrategy: 'testmail_forwarded'
                },
                confidenceScore: confidenceScore,
                status: 'pending'
            });

            logger.info(`📬 Created pending transaction from Testmail for user ${user.email}`, {
                pendingId: pendingTransaction._id,
                amount,
                merchant,
                userId: user.id
            });

        } catch (error) {
            logger.error('Error processing individual email', { error: error.message });
            Sentry.captureException(error);
        }
    }
}

export const emailPoller = new EmailPollerService();
