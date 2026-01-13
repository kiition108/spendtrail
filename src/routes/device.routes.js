import express from 'express';
import { auth as protect } from '../middleware/auth.middleware.js';
import { User } from '../models/User.model.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * @route   POST /api/v1/device/register
 * @desc    Register device token for push notifications
 * @access  Private
 */
router.post('/register', protect, async (req, res) => {
    try {
        const { token, platform = 'android' } = req.body;

        if (!token) {
            return res.status(400).json({ 
                success: false, 
                message: 'Device token is required' 
            });
        }

        // Check if token already exists
        const existingToken = req.user.deviceTokens?.find(dt => dt.token === token);

        if (existingToken) {
            // Update last used timestamp
            await User.findOneAndUpdate(
                { _id: req.user._id, 'deviceTokens.token': token },
                { $set: { 'deviceTokens.$.lastUsed': new Date() } }
            );

            return res.json({ 
                success: true, 
                message: 'Device token already registered' 
            });
        }

        // Add new token
        await User.findByIdAndUpdate(req.user._id, {
            $push: {
                deviceTokens: {
                    token,
                    platform,
                    addedAt: new Date(),
                    lastUsed: new Date()
                }
            }
        });

        logger.info('Device token registered', {
            userId: req.user._id,
            platform
        });

        res.json({ 
            success: true, 
            message: 'Device token registered successfully' 
        });
    } catch (error) {
        logger.error('Error registering device token', { 
            error: error.message,
            userId: req.user._id
        });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to register device token' 
        });
    }
});

/**
 * @route   DELETE /api/v1/device/unregister
 * @desc    Remove device token
 * @access  Private
 */
router.delete('/unregister', protect, async (req, res) => {
    try {
        const { token } = req.body;

        if (!token) {
            return res.status(400).json({ 
                success: false, 
                message: 'Device token is required' 
            });
        }

        await User.findByIdAndUpdate(req.user._id, {
            $pull: { deviceTokens: { token } }
        });

        logger.info('Device token unregistered', {
            userId: req.user._id
        });

        res.json({ 
            success: true, 
            message: 'Device token removed successfully' 
        });
    } catch (error) {
        logger.error('Error unregistering device token', { 
            error: error.message 
        });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to remove device token' 
        });
    }
});

/**
 * @route   POST /api/v1/device/test-notification
 * @desc    Send test notification (Development/Testing)
 * @access  Private
 */
router.post('/test-notification', protect, async (req, res) => {
    try {
        const { title, body } = req.body;

        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        if (!user.deviceTokens || user.deviceTokens.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No device tokens registered. Please login on the mobile app first.',
                help: 'Device tokens are automatically registered when you login via the mobile app.'
            });
        }

        // Lazy import NotificationService
        const { default: NotificationService } = await import('../services/notification.service.js');
        const notificationService = new NotificationService();

        await notificationService.sendNotification(
            user.deviceTokens.map(d => d.token),
            {
                title: title || 'Test Notification',
                body: body || 'This is a test notification from SpendTrail',
                data: { 
                    type: 'test',
                    timestamp: new Date().toISOString()
                }
            }
        );

        logger.info('Test notification sent', {
            userId: user._id,
            deviceCount: user.deviceTokens.length
        });

        res.json({
            success: true,
            message: 'Test notification sent successfully',
            sentTo: user.deviceTokens.length,
            devices: user.deviceTokens.map(d => ({
                platform: d.platform,
                addedAt: d.addedAt,
                lastUsed: d.lastUsed
            }))
        });
    } catch (error) {
        logger.error('Error sending test notification', {
            error: error.message,
            userId: req.user._id
        });
        res.status(500).json({
            success: false,
            message: error.message || 'Failed to send test notification',
            hint: 'Make sure Firebase is configured. Check PUSH_NOTIFICATIONS_SETUP.md for details.'
        });
    }
});

export default router;
