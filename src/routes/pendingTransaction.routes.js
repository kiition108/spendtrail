import express from 'express';
import { auth as protect } from '../middleware/auth.middleware.js';
import { PendingTransaction } from '../models/PendingTransaction.model.js';
import { MerchantPattern } from '../models/MerchantPattern.model.js';
import { LearningPattern } from '../models/LearningPattern.model.js';
import logger from '../utils/logger.js';
import * as Sentry from '@sentry/node';
import { notificationService } from '../services/notification.service.js';
import { locationMatchingService } from '../services/locationMatching.service.js';

const router = express.Router();

/**
 * @route   GET /api/v1/pending-transactions
 * @desc    Get all pending transactions for authenticated user
 * @access  Private
 */
router.get('/', protect, async (req, res) => {
    try {
        const { status = 'pending', limit = 50, skip = 0 } = req.query;

        const query = { user: req.user._id };
        if (status) query.status = status;

        const pendingTransactions = await PendingTransaction.find(query)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip(parseInt(skip))
            .lean();

        const total = await PendingTransaction.countDocuments(query);
        const pendingCount = await PendingTransaction.getPendingCount(req.user._id);

        res.json({
            success: true,
            data: pendingTransactions,
            pagination: {
                total,
                limit: parseInt(limit),
                skip: parseInt(skip),
                hasMore: total > parseInt(skip) + parseInt(limit)
            },
            pendingCount
        });
    } catch (error) {
        logger.error('Error fetching pending transactions', { 
            error: error.message, 
            userId: req.user._id 
        });
        Sentry.captureException(error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch pending transactions' 
        });
    }
});

/**
 * @route   GET /api/v1/pending-transactions/count
 * @desc    Get pending transaction count
 * @access  Private
 */
router.get('/count', protect, async (req, res) => {
    try {
        const count = await PendingTransaction.getPendingCount(req.user._id);
        res.json({ success: true, count });
    } catch (error) {
        logger.error('Error getting pending count', { error: error.message });
        res.status(500).json({ success: false, message: 'Failed to get count' });
    }
});

/**
 * @route   GET /api/v1/pending-transactions/:id
 * @desc    Get single pending transaction
 * @access  Private
 */
router.get('/:id', protect, async (req, res) => {
    try {
        const pendingTransaction = await PendingTransaction.findOne({
            _id: req.params.id,
            user: req.user._id
        });

        if (!pendingTransaction) {
            return res.status(404).json({ 
                success: false, 
                message: 'Pending transaction not found' 
            });
        }

        res.json({ success: true, data: pendingTransaction });
    } catch (error) {
        logger.error('Error fetching pending transaction', { error: error.message });
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

/**
 * @route   POST /api/v1/pending-transactions/:id/approve
 * @desc    Approve pending transaction (with optional corrections)
 * @access  Private
 */
router.post('/:id/approve', protect, async (req, res) => {
    try {
        const pendingTransaction = await PendingTransaction.findOne({
            _id: req.params.id,
            user: req.user._id,
            status: 'pending'
        });

        if (!pendingTransaction) {
            return res.status(404).json({ 
                success: false, 
                message: 'Pending transaction not found or already processed' 
            });
        }

        // Optional corrected data from user
        const { correctedData } = req.body;

        // Approve transaction (creates actual transaction)
        const transaction = await pendingTransaction.approve(correctedData);

        // Learn from location corrections using intelligent location matching service
        if (correctedData && correctedData.location) {
            try {
                // Learn from this correction to improve future location matching
                // This handles BOTH MerchantLocation and EmailLocationPattern
                await locationMatchingService.learnFromCorrection({
                    userId: req.user._id,
                    sender: pendingTransaction.source.emailId,
                    emailContent: pendingTransaction.source.rawContent,
                    merchantName: pendingTransaction.parsedData.merchant,
                    originalLocation: pendingTransaction.parsedData.location,
                    correctedLocation: correctedData.location
                });
                
                logger.info('Location learning from user correction completed', {
                    merchant: pendingTransaction.parsedData.merchant,
                    sender: pendingTransaction.source.emailId
                });
            } catch (locationLearningError) {
                logger.error('Failed to learn from location correction', {
                    error: locationLearningError.message
                });
            }
        }

        // Learn merchant patterns (category, payment method, variations)
        const merchant = correctedData?.merchant || pendingTransaction.parsedData.merchant;
        if (merchant) {
            try {
                const merchantKey = merchant.toLowerCase().trim();
                const parsedMerchant = pendingTransaction.parsedData.merchant;
                
                // Find or create merchant pattern
                let pattern = await MerchantPattern.findOne({
                    user: req.user._id,
                    merchantKey,
                });

                if (!pattern) {
                    // Create new pattern
                    pattern = await MerchantPattern.create({
                        user: req.user._id,
                        merchantKey,
                        merchantName: merchant,
                        variations: parsedMerchant ? [{
                            parsedName: parsedMerchant,
                            occurrences: 1,
                            lastSeen: new Date()
                        }] : [],
                        totalTransactions: 1
                    });
                } else {
                    pattern.totalTransactions += 1;
                    
                    // Add variation if parsed name different from canonical
                    if (parsedMerchant && parsedMerchant.toLowerCase() !== merchantKey) {
                        pattern.addVariation(parsedMerchant);
                    }
                }

                // Learn from corrections
                if (correctedData) {
                    pattern.totalCorrections += 1;

                    // Learn category correction
                    if (correctedData.category && 
                        correctedData.category !== pendingTransaction.parsedData.category) {
                        pattern.learnCategory(
                            pendingTransaction.parsedData.category,
                            correctedData.category
                        );
                        logger.info('Learned category pattern', {
                            merchant,
                            from: pendingTransaction.parsedData.category,
                            to: correctedData.category
                        });
                    }

                    // Learn payment method correction
                    if (correctedData.paymentMethod && 
                        correctedData.paymentMethod !== pendingTransaction.parsedData.paymentMethod) {
                        pattern.learnPaymentMethod(
                            pendingTransaction.parsedData.paymentMethod,
                            correctedData.paymentMethod
                        );
                        logger.info('Learned payment method pattern', {
                            merchant,
                            from: pendingTransaction.parsedData.paymentMethod,
                            to: correctedData.paymentMethod
                        });
                    }
                }

                await pattern.save();
                logger.info('Merchant pattern updated', {
                    merchant,
                    totalTransactions: pattern.totalTransactions,
                    totalCorrections: pattern.totalCorrections,
                    categoryConfidence: pattern.categoryPattern?.confidence || 0,
                    paymentMethodConfidence: pattern.paymentMethodPattern?.confidence || 0
                });
            } catch (patternError) {
                logger.error('Failed to learn merchant pattern', {
                    error: patternError.message,
                    merchant
                });
            }
        }

        // Store learning pattern if user made corrections
        if (correctedData) {
            try {
                const corrections = {
                    amountChanged: correctedData.amount !== pendingTransaction.parsedData.amount,
                    typeChanged: correctedData.type !== pendingTransaction.parsedData.type,
                    categoryChanged: correctedData.category !== pendingTransaction.parsedData.category,
                    merchantChanged: correctedData.merchant !== pendingTransaction.parsedData.merchant,
                    descriptionChanged: correctedData.description !== pendingTransaction.parsedData.description
                };

                await LearningPattern.create({
                    user: req.user._id,
                    originalParsed: pendingTransaction.parsedData,
                    correctedData: correctedData,
                    source: pendingTransaction.source.type,
                    rawContent: pendingTransaction.source.rawContent,
                    metadata: {
                        emailSubject: pendingTransaction.source.subject,
                        sender: pendingTransaction.source.emailId,
                        confidence: pendingTransaction.confidenceScore
                    },
                    corrections: corrections
                });

                logger.info('Learning pattern stored', {
                    userId: req.user._id,
                    corrections: Object.keys(corrections).filter(k => corrections[k])
                });
            } catch (learningError) {
                // Don't fail the approval if learning pattern storage fails
                logger.error('Failed to store learning pattern', { 
                    error: learningError.message 
                });
            }
        }

        logger.info('Pending transaction approved', {
            pendingId: pendingTransaction._id,
            transactionId: transaction._id,
            userId: req.user._id,
            hasCorrectedData: !!correctedData
        });

        // Send approval notification
        if (req.user.deviceTokens && req.user.deviceTokens.length > 0) {
            await notificationService.sendTransactionApprovedNotification(
                req.user.deviceTokens[0].token,
                transaction
            );
        }

        res.json({ 
            success: true, 
            message: 'Transaction approved and added',
            data: {
                transaction,
                pendingTransaction
            }
        });
    } catch (error) {
        logger.error('Error approving pending transaction', { 
            error: error.message,
            pendingId: req.params.id
        });
        Sentry.captureException(error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to approve transaction' 
        });
    }
});

/**
 * @route   POST /api/v1/pending-transactions/:id/reject
 * @desc    Reject pending transaction
 * @access  Private
 */
router.post('/:id/reject', protect, async (req, res) => {
    try {
        const pendingTransaction = await PendingTransaction.findOne({
            _id: req.params.id,
            user: req.user._id,
            status: 'pending'
        });

        if (!pendingTransaction) {
            return res.status(404).json({ 
                success: false, 
                message: 'Pending transaction not found or already processed' 
            });
        }

        const { reason } = req.body;

        // Reject transaction
        await pendingTransaction.reject(reason);

        logger.info('Pending transaction rejected', {
            pendingId: pendingTransaction._id,
            userId: req.user._id,
            reason: reason || 'No reason provided'
        });

        res.json({ 
            success: true, 
            message: 'Transaction rejected',
            data: pendingTransaction
        });
    } catch (error) {
        logger.error('Error rejecting pending transaction', { 
            error: error.message,
            pendingId: req.params.id
        });
        Sentry.captureException(error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to reject transaction' 
        });
    }
});

/**
 * @route   POST /api/v1/pending-transactions/bulk-approve
 * @desc    Approve multiple pending transactions
 * @access  Private
 */
router.post('/bulk-approve', protect, async (req, res) => {
    try {
        const { ids } = req.body;

        if (!ids || !Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Please provide array of transaction IDs' 
            });
        }

        const results = {
            approved: [],
            failed: []
        };

        for (const id of ids) {
            try {
                const pendingTransaction = await PendingTransaction.findOne({
                    _id: id,
                    user: req.user._id,
                    status: 'pending'
                });

                if (pendingTransaction) {
                    const transaction = await pendingTransaction.approve();
                    results.approved.push({ 
                        pendingId: id, 
                        transactionId: transaction._id 
                    });
                } else {
                    results.failed.push({ 
                        pendingId: id, 
                        reason: 'Not found or already processed' 
                    });
                }
            } catch (error) {
                results.failed.push({ 
                    pendingId: id, 
                    reason: error.message 
                });
            }
        }

        logger.info('Bulk approve completed', {
            userId: req.user._id,
            approved: results.approved.length,
            failed: results.failed.length
        });

        res.json({ 
            success: true, 
            message: `Approved ${results.approved.length} transactions`,
            data: results
        });
    } catch (error) {
        logger.error('Error in bulk approve', { error: error.message });
        Sentry.captureException(error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to process bulk approval' 
        });
    }
});

/**
 * @route   DELETE /api/v1/pending-transactions/:id
 * @desc    Delete/dismiss pending transaction
 * @access  Private
 */
router.delete('/:id', protect, async (req, res) => {
    try {
        const pendingTransaction = await PendingTransaction.findOneAndDelete({
            _id: req.params.id,
            user: req.user._id
        });

        if (!pendingTransaction) {
            return res.status(404).json({ 
                success: false, 
                message: 'Pending transaction not found' 
            });
        }

        res.json({ 
            success: true, 
            message: 'Pending transaction deleted' 
        });
    } catch (error) {
        logger.error('Error deleting pending transaction', { error: error.message });
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

export default router;
