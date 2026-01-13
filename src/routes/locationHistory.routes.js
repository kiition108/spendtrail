import express from 'express';
import { auth as protect } from '../middleware/auth.middleware.js';
import { UserLocationHistory } from '../models/UserLocationHistory.model.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @route   POST /api/v1/location/history
 * @desc    Submit user's background location (from mobile app)
 * @access  Private
 */
router.post('/history', protect, async (req, res) => {
    try {
        const { latitude, longitude, accuracy, timestamp } = req.body;

        if (!latitude || !longitude) {
            return res.status(400).json({
                success: false,
                message: 'Latitude and longitude are required'
            });
        }

        // Validate coordinates
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({
                success: false,
                message: 'Invalid coordinates'
            });
        }

        const locationHistory = await UserLocationHistory.create({
            user: req.user._id,
            location: {
                type: 'Point',
                coordinates: [longitude, latitude]
            },
            accuracy: accuracy || 10,
            timestamp: timestamp ? new Date(timestamp) : new Date()
        });

        logger.info('Background location recorded', {
            userId: req.user._id,
            accuracy,
            timestamp: locationHistory.timestamp
        });

        res.json({
            success: true,
            message: 'Location recorded',
            data: {
                id: locationHistory._id,
                timestamp: locationHistory.timestamp
            }
        });
    } catch (error) {
        logger.error('Error recording location', {
            error: error.message,
            userId: req.user._id
        });
        res.status(500).json({
            success: false,
            message: 'Failed to record location'
        });
    }
});

/**
 * @route   POST /api/v1/location/history/batch
 * @desc    Submit multiple background locations at once (for offline sync)
 * @access  Private
 */
router.post('/history/batch', protect, async (req, res) => {
    try {
        const { locations } = req.body;

        if (!Array.isArray(locations) || locations.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Locations array is required'
            });
        }

        // Validate and prepare locations for bulk insert
        const validLocations = [];
        const errors = [];

        for (let i = 0; i < locations.length; i++) {
            const loc = locations[i];
            
            if (!loc.latitude || !loc.longitude) {
                errors.push({ index: i, error: 'Missing coordinates' });
                continue;
            }

            if (loc.latitude < -90 || loc.latitude > 90 || 
                loc.longitude < -180 || loc.longitude > 180) {
                errors.push({ index: i, error: 'Invalid coordinates' });
                continue;
            }

            validLocations.push({
                user: req.user._id,
                location: {
                    type: 'Point',
                    coordinates: [loc.longitude, loc.latitude]
                },
                accuracy: loc.accuracy || 10,
                timestamp: loc.timestamp ? new Date(loc.timestamp) : new Date()
            });
        }

        if (validLocations.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No valid locations provided',
                errors
            });
        }

        // Bulk insert
        const inserted = await UserLocationHistory.insertMany(validLocations, { ordered: false });

        logger.info('Batch location recorded', {
            userId: req.user._id,
            total: locations.length,
            inserted: inserted.length,
            errors: errors.length
        });

        res.json({
            success: true,
            message: `Recorded ${inserted.length} locations`,
            data: {
                inserted: inserted.length,
                failed: errors.length,
                errors: errors.length > 0 ? errors : undefined
            }
        });
    } catch (error) {
        logger.error('Error recording batch locations', {
            error: error.message,
            userId: req.user._id
        });
        res.status(500).json({
            success: false,
            message: 'Failed to record locations'
        });
    }
});

/**
 * @route   GET /api/v1/location/history
 * @desc    Get user's location history (with optional time range)
 * @access  Private
 */
router.get('/history', protect, async (req, res) => {
    try {
        const { startDate, endDate, limit = 100 } = req.query;

        const query = { user: req.user._id };

        // Add date range filter if provided
        if (startDate || endDate) {
            query.timestamp = {};
            if (startDate) query.timestamp.$gte = new Date(startDate);
            if (endDate) query.timestamp.$lte = new Date(endDate);
        }

        const locations = await UserLocationHistory.find(query)
            .sort({ timestamp: -1 })
            .limit(parseInt(limit))
            .lean();

        res.json({
            success: true,
            count: locations.length,
            data: locations.map(loc => ({
                id: loc._id,
                latitude: loc.location.coordinates[1],
                longitude: loc.location.coordinates[0],
                accuracy: loc.accuracy,
                timestamp: loc.timestamp
            }))
        });
    } catch (error) {
        logger.error('Error fetching location history', {
            error: error.message,
            userId: req.user._id
        });
        res.status(500).json({
            success: false,
            message: 'Failed to fetch location history'
        });
    }
});

/**
 * @route   DELETE /api/v1/location/history/old
 * @desc    Clean old location history (older than specified days)
 * @access  Private
 */
router.delete('/history/old', protect, async (req, res) => {
    try {
        const { daysToKeep = 90 } = req.query;

        const deleted = await UserLocationHistory.cleanOldHistory(
            req.user._id, 
            parseInt(daysToKeep)
        );

        logger.info('Old location history cleaned', {
            userId: req.user._id,
            daysToKeep,
            deleted
        });

        res.json({
            success: true,
            message: `Deleted ${deleted} old location records`,
            deleted
        });
    } catch (error) {
        logger.error('Error cleaning location history', {
            error: error.message,
            userId: req.user._id
        });
        res.status(500).json({
            success: false,
            message: 'Failed to clean location history'
        });
    }
});

/**
 * @route   GET /api/v1/location/near
 * @desc    Get location near a specific time (for debugging/testing)
 * @access  Private
 */
router.get('/near', protect, async (req, res) => {
    try {
        const { timestamp, windowMinutes = 15 } = req.query;

        if (!timestamp) {
            return res.status(400).json({
                success: false,
                message: 'Timestamp is required'
            });
        }

        const targetTime = new Date(timestamp);
        const location = await UserLocationHistory.findLocationNearTime(
            req.user._id,
            targetTime,
            parseInt(windowMinutes)
        );

        if (!location) {
            return res.json({
                success: true,
                found: false,
                message: 'No location found within time window'
            });
        }

        res.json({
            success: true,
            found: true,
            data: {
                latitude: location.location.coordinates[1],
                longitude: location.location.coordinates[0],
                accuracy: location.accuracy,
                timestamp: location.timestamp,
                timeDifference: Math.abs(location.timestamp - targetTime) / 60000 // minutes
            }
        });
    } catch (error) {
        logger.error('Error finding location near time', {
            error: error.message,
            userId: req.user._id
        });
        res.status(500).json({
            success: false,
            message: 'Failed to find location'
        });
    }
});

export default router;
