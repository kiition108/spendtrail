import express from 'express';
import { auth as protect } from '../middleware/authMiddleware.js';
import { Transaction } from '../models/Transaction.model.js';
import logger from '../utils/logger.js';
import * as Sentry from '@sentry/node';

const router = express.Router();

/**
 * @route   GET /api/v1/insights/summary
 * @desc    Get spending summary for current month
 * @access  Private
 */
router.get('/summary', protect, async (req, res) => {
    try {
        const { period = 'month', startDate, endDate } = req.query;
        
        // Calculate date range
        let dateFilter;
        const now = new Date();
        
        if (startDate && endDate) {
            dateFilter = {
                date: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate)
                }
            };
        } else {
            switch (period) {
                case 'week':
                    dateFilter = {
                        date: {
                            $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
                        }
                    };
                    break;
                case 'year':
                    dateFilter = {
                        date: {
                            $gte: new Date(now.getFullYear(), 0, 1)
                        }
                    };
                    break;
                case 'month':
                default:
                    dateFilter = {
                        date: {
                            $gte: new Date(now.getFullYear(), now.getMonth(), 1)
                        }
                    };
            }
        }
        
        // Get all transactions for period
        const transactions = await Transaction.find({
            user: req.user._id,
            ...dateFilter
        });
        
        // Calculate totals
        const income = transactions
            .filter(t => t.amount > 0)
            .reduce((sum, t) => sum + t.amount, 0);
            
        const expenses = Math.abs(transactions
            .filter(t => t.amount < 0)
            .reduce((sum, t) => sum + t.amount, 0));
        
        // Category breakdown
        const categoryMap = {};
        transactions.forEach(t => {
            if (t.amount < 0) { // Only expenses
                const category = t.category || 'Uncategorized';
                categoryMap[category] = (categoryMap[category] || 0) + Math.abs(t.amount);
            }
        });
        
        const categories = Object.entries(categoryMap)
            .map(([name, amount]) => ({
                name,
                amount,
                percentage: (amount / expenses * 100).toFixed(1)
            }))
            .sort((a, b) => b.amount - a.amount);
        
        // Top merchants
        const merchantMap = {};
        transactions.forEach(t => {
            if (t.amount < 0 && t.merchant) {
                merchantMap[t.merchant] = (merchantMap[t.merchant] || 0) + Math.abs(t.amount);
            }
        });
        
        const topMerchants = Object.entries(merchantMap)
            .map(([name, amount]) => ({ name, amount }))
            .sort((a, b) => b.amount - a.amount)
            .slice(0, 5);
        
        // Daily average
        const daysInPeriod = period === 'week' ? 7 : period === 'year' ? 365 : 30;
        const dailyAverage = expenses / daysInPeriod;
        
        res.json({
            success: true,
            period,
            summary: {
                income,
                expenses,
                balance: income - expenses,
                transactionCount: transactions.length,
                dailyAverage: dailyAverage.toFixed(2)
            },
            categories,
            topMerchants
        });
    } catch (error) {
        logger.error('Error getting insights summary', {
            error: error.message,
            userId: req.user._id
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to get insights'
        });
    }
});

/**
 * @route   GET /api/v1/insights/trends
 * @desc    Get spending trends over time
 * @access  Private
 */
router.get('/trends', protect, async (req, res) => {
    try {
        const { period = 'month', groupBy = 'day' } = req.query;
        
        // Calculate date range
        const now = new Date();
        let startDate;
        
        switch (period) {
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
            case 'month':
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        
        const transactions = await Transaction.find({
            user: req.user._id,
            date: { $gte: startDate }
        }).sort({ date: 1 });
        
        // Group by date
        const trendMap = {};
        
        transactions.forEach(t => {
            let key;
            const date = new Date(t.date);
            
            if (groupBy === 'week') {
                const weekStart = new Date(date);
                weekStart.setDate(date.getDate() - date.getDay());
                key = weekStart.toISOString().split('T')[0];
            } else if (groupBy === 'month') {
                key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            } else {
                key = date.toISOString().split('T')[0];
            }
            
            if (!trendMap[key]) {
                trendMap[key] = { income: 0, expenses: 0 };
            }
            
            if (t.amount > 0) {
                trendMap[key].income += t.amount;
            } else {
                trendMap[key].expenses += Math.abs(t.amount);
            }
        });
        
        const trends = Object.entries(trendMap)
            .map(([date, data]) => ({
                date,
                ...data,
                net: data.income - data.expenses
            }))
            .sort((a, b) => a.date.localeCompare(b.date));
        
        res.json({
            success: true,
            period,
            groupBy,
            trends
        });
    } catch (error) {
        logger.error('Error getting trends', {
            error: error.message,
            userId: req.user._id
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to get trends'
        });
    }
});

/**
 * @route   GET /api/v1/insights/categories
 * @desc    Get detailed category breakdown
 * @access  Private
 */
router.get('/categories', protect, async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        
        const now = new Date();
        let startDate;
        
        switch (period) {
            case 'week':
                startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                break;
            case 'year':
                startDate = new Date(now.getFullYear(), 0, 1);
                break;
            case 'month':
            default:
                startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        
        const transactions = await Transaction.aggregate([
            {
                $match: {
                    user: req.user._id,
                    date: { $gte: startDate },
                    amount: { $lt: 0 } // Only expenses
                }
            },
            {
                $group: {
                    _id: '$category',
                    total: { $sum: { $abs: '$amount' } },
                    count: { $sum: 1 },
                    avgAmount: { $avg: { $abs: '$amount' } }
                }
            },
            {
                $sort: { total: -1 }
            }
        ]);
        
        const totalExpenses = transactions.reduce((sum, t) => sum + t.total, 0);
        
        const categories = transactions.map(t => ({
            category: t._id || 'Uncategorized',
            total: t.total,
            count: t.count,
            avgAmount: t.avgAmount,
            percentage: ((t.total / totalExpenses) * 100).toFixed(1)
        }));
        
        res.json({
            success: true,
            period,
            totalExpenses,
            categories
        });
    } catch (error) {
        logger.error('Error getting category insights', {
            error: error.message,
            userId: req.user._id
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to get category insights'
        });
    }
});

/**
 * @route   GET /api/v1/insights/comparison
 * @desc    Compare current period with previous period
 * @access  Private
 */
router.get('/comparison', protect, async (req, res) => {
    try {
        const { period = 'month' } = req.query;
        
        const now = new Date();
        let currentStart, currentEnd, previousStart, previousEnd;
        
        switch (period) {
            case 'week':
                currentStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
                currentEnd = now;
                previousStart = new Date(currentStart.getTime() - 7 * 24 * 60 * 60 * 1000);
                previousEnd = currentStart;
                break;
            case 'year':
                currentStart = new Date(now.getFullYear(), 0, 1);
                currentEnd = now;
                previousStart = new Date(now.getFullYear() - 1, 0, 1);
                previousEnd = new Date(now.getFullYear() - 1, 11, 31);
                break;
            case 'month':
            default:
                currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
                currentEnd = now;
                previousStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                previousEnd = new Date(now.getFullYear(), now.getMonth(), 0);
        }
        
        const [currentPeriod, previousPeriod] = await Promise.all([
            Transaction.find({
                user: req.user._id,
                date: { $gte: currentStart, $lte: currentEnd }
            }),
            Transaction.find({
                user: req.user._id,
                date: { $gte: previousStart, $lte: previousEnd }
            })
        ]);
        
        const calculateStats = (transactions) => {
            const income = transactions.filter(t => t.amount > 0).reduce((sum, t) => sum + t.amount, 0);
            const expenses = Math.abs(transactions.filter(t => t.amount < 0).reduce((sum, t) => sum + t.amount, 0));
            return { income, expenses, count: transactions.length };
        };
        
        const current = calculateStats(currentPeriod);
        const previous = calculateStats(previousPeriod);
        
        const changes = {
            income: previous.income ? ((current.income - previous.income) / previous.income * 100).toFixed(1) : 0,
            expenses: previous.expenses ? ((current.expenses - previous.expenses) / previous.expenses * 100).toFixed(1) : 0,
            count: previous.count ? ((current.count - previous.count) / previous.count * 100).toFixed(1) : 0
        };
        
        res.json({
            success: true,
            period,
            current,
            previous,
            changes
        });
    } catch (error) {
        logger.error('Error getting comparison', {
            error: error.message,
            userId: req.user._id
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to get comparison'
        });
    }
});

export default router;
