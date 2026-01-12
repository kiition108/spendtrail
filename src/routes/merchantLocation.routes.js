import express from 'express';
import { MerchantLocation } from '../models/MerchantLocation.model.js';
import { auth } from '../middleware/authMiddleware.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * POST /merchant-locations/learn
 * Learn or update merchant location from transaction
 */
router.post('/learn', auth, async (req, res) => {
    try {
        const { merchant, location, timestamp } = req.body;
        
        if (!merchant || !location?.lat || !location?.lng) {
            return res.status(400).json({
                success: false,
                message: 'Merchant name and location coordinates required'
            });
        }

        const merchantKey = merchant.toLowerCase().trim();
        
        // Find or create merchant location entry
        let merchantLoc = await MerchantLocation.findOne({
            user: req.user.id,
            merchantKey
        });

        if (!merchantLoc) {
            // First visit - create new entry
            merchantLoc = new MerchantLocation({
                user: req.user.id,
                merchantKey,
                merchantName: merchant,
                location: {
                    lat: location.lat,
                    lng: location.lng,
                    city: location.city,
                    address: location.address,
                },
                visits: 1,
                confidence: 0.2, // Low confidence initially
                visitHistory: [{
                    lat: location.lat,
                    lng: location.lng,
                    timestamp: timestamp || new Date(),
                    accuracy: location.accuracy || 100,
                }],
                firstVisit: new Date(),
                lastVisit: new Date(),
            });
        } else {
            // Subsequent visit - update
            merchantLoc.visits += 1;
            merchantLoc.lastVisit = new Date();
            
            // Add to visit history
            merchantLoc.visitHistory.push({
                lat: location.lat,
                lng: location.lng,
                timestamp: timestamp || new Date(),
                accuracy: location.accuracy || 100,
            });
            
            // Keep only last 20 visits to avoid bloat
            if (merchantLoc.visitHistory.length > 20) {
                merchantLoc.visitHistory = merchantLoc.visitHistory.slice(-20);
            }
            
            // Calculate average location from all visits
            const totalLat = merchantLoc.visitHistory.reduce((sum, v) => sum + v.lat, 0);
            const totalLng = merchantLoc.visitHistory.reduce((sum, v) => sum + v.lng, 0);
            const count = merchantLoc.visitHistory.length;
            
            merchantLoc.location.lat = totalLat / count;
            merchantLoc.location.lng = totalLng / count;
            
            // Update city/address if provided and not already set
            if (location.city && !merchantLoc.location.city) {
                merchantLoc.location.city = location.city;
            }
            if (location.address && !merchantLoc.location.address) {
                merchantLoc.location.address = location.address;
            }
            
            // Increase confidence with more visits (cap at 1.0)
            // Formula: min(visits / 10, 1.0)
            merchantLoc.confidence = Math.min(merchantLoc.visits / 10, 1.0);
        }

        await merchantLoc.save();

        res.json({
            success: true,
            merchant: merchantLoc.merchantName,
            visits: merchantLoc.visits,
            confidence: merchantLoc.confidence,
            location: merchantLoc.location,
        });
    } catch (error) {
        logger.error('Merchant learning error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to learn merchant location'
        });
    }
});

/**
 * GET /merchant-locations/lookup/:merchant
 * Get learned location for a merchant
 */
router.get('/lookup/:merchant', auth, async (req, res) => {
    try {
        const merchantKey = req.params.merchant.toLowerCase().trim();
        
        const merchantLoc = await MerchantLocation.findOne({
            user: req.user.id,
            merchantKey
        });

        if (!merchantLoc) {
            return res.json({
                success: true,
                found: false,
            });
        }

        res.json({
            success: true,
            found: true,
            merchant: merchantLoc.merchantName,
            location: {
                type: 'approx',
                lat: merchantLoc.location.lat,
                lng: merchantLoc.location.lng,
                city: merchantLoc.location.city,
                address: merchantLoc.location.address,
                confidence: merchantLoc.confidence,
                source: 'learned_pattern',
            },
            visits: merchantLoc.visits,
            lastVisit: merchantLoc.lastVisit,
        });
    } catch (error) {
        logger.error('Merchant lookup error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to lookup merchant'
        });
    }
});

/**
 * GET /merchant-locations
 * Get all learned merchant locations for user
 */
router.get('/', auth, async (req, res) => {
    try {
        const merchants = await MerchantLocation.find({
            user: req.user.id
        })
        .sort({ visits: -1, confidence: -1 })
        .limit(100);

        res.json({
            success: true,
            count: merchants.length,
            merchants: merchants.map(m => ({
                merchant: m.merchantName,
                visits: m.visits,
                confidence: m.confidence,
                location: m.location,
                lastVisit: m.lastVisit,
            })),
        });
    } catch (error) {
        logger.error('Get merchant locations error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to get merchant locations'
        });
    }
});

/**
 * DELETE /merchant-locations/:merchant
 * Delete learned merchant location
 */
router.delete('/:merchant', auth, async (req, res) => {
    try {
        const merchantKey = req.params.merchant.toLowerCase().trim();
        
        await MerchantLocation.deleteOne({
            user: req.user.id,
            merchantKey
        });

        res.json({
            success: true,
            message: 'Merchant location deleted'
        });
    } catch (error) {
        logger.error('Delete merchant location error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Failed to delete merchant location'
        });
    }
});

export default router;
