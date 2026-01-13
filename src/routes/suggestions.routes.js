import express from 'express';
import { auth as protect } from '../middleware/auth.middleware.js';
import { PendingTransaction } from '../models/PendingTransaction.model.js';
import { MerchantPattern } from '../models/MerchantPattern.model.js';
import logger from '../utils/logger.js';
import * as Sentry from '@sentry/node';

const router = express.Router();

/**
 * @route   GET /api/v1/suggestions/all
 * @desc    Get all learned merchant patterns for user
 * @access  Private
 */
router.get('/all', protect, async (req, res) => {
    try {
        const patterns = await MerchantPattern.find({ user: req.user._id })
            .sort({ totalTransactions: -1 })
            .limit(100);

        const summary = patterns.map(p => ({
            merchantName: p.merchantName,
            variations: p.variations.length,
            totalTransactions: p.totalTransactions,
            totalCorrections: p.totalCorrections,
            hasCategory: !!p.categoryPattern?.preferredCategory,
            categoryConfidence: p.categoryPattern?.confidence || 0,
            hasPaymentMethod: !!p.paymentMethodPattern?.preferredMethod,
            paymentMethodConfidence: p.paymentMethodPattern?.confidence || 0
        }));

        res.json({
            success: true,
            count: patterns.length,
            patterns: summary
        });
    } catch (error) {
        logger.error('Error getting all patterns', {
            error: error.message
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to get patterns'
        });
    }
});

/**
 * @route   GET /api/v1/suggestions/:transactionId
 * @desc    Get AI suggestions for pending transaction based on learned patterns
 * @access  Private
 */
router.get('/:transactionId', protect, async (req, res) => {
    try {
        const pendingTransaction = await PendingTransaction.findOne({
            _id: req.params.transactionId,
            user: req.user._id,
            status: 'pending'
        });

        if (!pendingTransaction) {
            return res.status(404).json({
                success: false,
                message: 'Pending transaction not found'
            });
        }

        const parsedData = pendingTransaction.parsedData;
        
        // Get suggestions from learned patterns
        const suggestions = await MerchantPattern.suggestCorrections(
            req.user._id,
            parsedData
        );

        if (!suggestions) {
            return res.json({
                success: true,
                hasSuggestions: false,
                message: 'No learned patterns found for this merchant'
            });
        }

        res.json({
            success: true,
            hasSuggestions: true,
            parsedData,
            suggestions: suggestions.suggestions,
            confidence: suggestions.confidence,
            message: 'Suggestions based on your previous corrections'
        });
    } catch (error) {
        logger.error('Error getting suggestions', {
            error: error.message,
            transactionId: req.params.transactionId
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to get suggestions'
        });
    }
});

/**
 * @route   GET /api/v1/suggestions/merchant/:merchantName
 * @desc    Get learned patterns for a specific merchant
 * @access  Private
 */
router.get('/merchant/:merchantName', protect, async (req, res) => {
    try {
        const merchantKey = req.params.merchantName.toLowerCase().trim();
        
        // Try exact match first
        let pattern = await MerchantPattern.findOne({
            user: req.user._id,
            merchantKey
        });

        // Try fuzzy variation match if exact not found
        if (!pattern) {
            const result = await MerchantPattern.findByVariation(
                req.user._id,
                req.params.merchantName
            );
            pattern = result?.pattern;
        }

        if (!pattern) {
            return res.json({
                success: true,
                found: false,
                message: 'No learned patterns for this merchant'
            });
        }

        res.json({
            success: true,
            found: true,
            pattern: {
                merchantName: pattern.merchantName,
                variations: pattern.variations,
                categoryPattern: pattern.categoryPattern,
                paymentMethodPattern: pattern.paymentMethodPattern,
                totalTransactions: pattern.totalTransactions,
                totalCorrections: pattern.totalCorrections
            }
        });
    } catch (error) {
        logger.error('Error getting merchant pattern', {
            error: error.message,
            merchant: req.params.merchantName
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to get merchant pattern'
        });
    }
});

/**
 * @route   DELETE /api/v1/suggestions/merchant/:merchantName
 * @desc    Delete learned pattern for a merchant
 * @access  Private
 */
router.delete('/merchant/:merchantName', protect, async (req, res) => {
    try {
        const merchantKey = req.params.merchantName.toLowerCase().trim();
        
        const result = await MerchantPattern.deleteOne({
            user: req.user._id,
            merchantKey
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Merchant pattern not found'
            });
        }

        logger.info('Merchant pattern deleted', {
            userId: req.user._id,
            merchant: req.params.merchantName
        });

        res.json({
            success: true,
            message: 'Merchant pattern deleted'
        });
    } catch (error) {
        logger.error('Error deleting merchant pattern', {
            error: error.message,
            merchant: req.params.merchantName
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete merchant pattern'
        });
    }
});

export default router;
