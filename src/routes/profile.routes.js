import express from 'express';
import { auth as protect } from '../middleware/authMiddleware.js';
import { User } from '../models/User.model.js';
import logger from '../utils/logger.js';
import * as Sentry from '@sentry/node';
import bcrypt from 'bcryptjs';

const router = express.Router();

/**
 * @route   GET /api/v1/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('-password');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: user
        });
    } catch (error) {
        logger.error('Error fetching profile', { error: error.message });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch profile'
        });
    }
});

/**
 * @route   PUT /api/v1/profile
 * @desc    Update user profile (name, email)
 * @access  Private
 */
router.put('/', protect, async (req, res) => {
    try {
        const { name, email } = req.body;
        
        const updateData = {};
        
        // Update name if provided
        if (name !== undefined) {
            if (name.trim().length < 2) {
                return res.status(400).json({
                    success: false,
                    message: 'Name must be at least 2 characters'
                });
            }
            updateData.name = name.trim();
        }

        // Update email if provided
        if (email !== undefined) {
            // Check if email is valid
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid email format'
                });
            }

            // Check if email is already taken by another user
            const existingUser = await User.findOne({ 
                email: email.toLowerCase(),
                _id: { $ne: req.user._id }
            });

            if (existingUser) {
                return res.status(400).json({
                    success: false,
                    message: 'Email is already in use'
                });
            }

            updateData.email = email.toLowerCase();
            // If changing email, require re-verification
            updateData.isVerified = false;
            
            // Disable Gmail integration - requires re-authorization with new email
            updateData['gmailIntegration.enabled'] = false;
            updateData['gmailIntegration.authorizedEmail'] = null;
            
            // Generate OTP for email verification
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            updateData.otp = otp;
            updateData.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
            
            // TODO: Send OTP email to new email address
            logger.info('OTP generated for email change', {
                userId: req.user._id,
                newEmail: email.toLowerCase()
            });
        }

        if (Object.keys(updateData).length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No update data provided'
            });
        }

        const updatedUser = await User.findByIdAndUpdate(
            req.user._id,
            updateData,
            { new: true, runValidators: true }
        ).select('-password');

        logger.info('Profile updated', {
            userId: req.user._id,
            updates: Object.keys(updateData),
            emailChanged: updateData.email ? true : false
        });

        res.json({
            success: true,
            message: updateData.email ? 'Profile updated. Please verify your new email with the OTP sent.' : 'Profile updated successfully',
            data: updatedUser,
            emailChanged: updateData.email ? true : false,
            requiresOTP: updateData.email ? true : false
        });
    } catch (error) {
        logger.error('Error updating profile', { 
            error: error.message,
            userId: req.user._id
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile'
        });
    }
});

/**
 * @route   POST /api/v1/profile/verify-email
 * @desc    Verify new email with OTP after email change
 * @access  Private
 */
router.post('/verify-email', protect, async (req, res) => {
    try {
        const { otp } = req.body;

        if (!otp) {
            return res.status(400).json({
                success: false,
                message: 'OTP is required'
            });
        }

        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if user is already verified
        if (user.isVerified) {
            return res.status(400).json({
                success: false,
                message: 'Email is already verified'
            });
        }

        // Check if OTP exists and hasn't expired
        if (!user.otp || !user.otpExpires) {
            return res.status(400).json({
                success: false,
                message: 'No OTP found. Please request a new one.'
            });
        }

        if (user.otpExpires < new Date()) {
            return res.status(400).json({
                success: false,
                message: 'OTP has expired. Please request a new one.'
            });
        }

        // Verify OTP
        if (user.otp !== otp) {
            return res.status(400).json({
                success: false,
                message: 'Invalid OTP'
            });
        }

        // Mark email as verified and clear OTP
        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        logger.info('Email verified after change', { userId: user._id, email: user.email });

        res.json({
            success: true,
            message: 'Email verified successfully',
            data: user
        });
    } catch (error) {
        logger.error('Error verifying email', { 
            error: error.message,
            userId: req.user._id
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to verify email'
        });
    }
});

/**
 * @route   POST /api/v1/profile/resend-otp
 * @desc    Resend OTP for email verification
 * @access  Private
 */
router.post('/resend-otp', protect, async (req, res) => {
    try {
        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        if (user.isVerified) {
            return res.status(400).json({
                success: false,
                message: 'Email is already verified'
            });
        }

        // Generate new OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp;
        user.otpExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
        await user.save();

        // TODO: Send OTP email
        logger.info('OTP resent for email verification', {
            userId: user._id,
            email: user.email
        });

        res.json({
            success: true,
            message: 'OTP sent to your email'
        });
    } catch (error) {
        logger.error('Error resending OTP', { 
            error: error.message,
            userId: req.user._id
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to resend OTP'
        });
    }
});

/**
 * @route   PUT /api/v1/profile/password
 * @desc    Change password
 * @access  Private
 */
router.put('/password', protect, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                message: 'Current password and new password are required'
            });
        }

        // Validate new password strength
        if (newPassword.length < 6) {
            return res.status(400).json({
                success: false,
                message: 'New password must be at least 6 characters'
            });
        }

        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Check if user has a password (OAuth users might not)
        if (!user.password) {
            return res.status(400).json({
                success: false,
                message: 'Cannot change password for OAuth accounts. Please use your OAuth provider.'
            });
        }

        // Verify current password
        const isMatch = await user.comparePassword(currentPassword);

        if (!isMatch) {
            return res.status(401).json({
                success: false,
                message: 'Current password is incorrect'
            });
        }

        // Hash new password
        user.password = newPassword; // Will be hashed by pre-save hook
        await user.save();

        logger.info('Password changed', { userId: req.user._id });

        res.json({
            success: true,
            message: 'Password changed successfully'
        });
    } catch (error) {
        logger.error('Error changing password', { 
            error: error.message,
            userId: req.user._id
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to change password'
        });
    }
});

/**
 * @route   DELETE /api/v1/profile
 * @desc    Delete user account
 * @access  Private
 */
router.delete('/', protect, async (req, res) => {
    try {
        const { password } = req.body;

        const user = await User.findById(req.user._id);

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        // Verify password if user has one (not OAuth)
        if (user.password) {
            if (!password) {
                return res.status(400).json({
                    success: false,
                    message: 'Password is required to delete account'
                });
            }

            const isMatch = await user.comparePassword(password);

            if (!isMatch) {
                return res.status(401).json({
                    success: false,
                    message: 'Incorrect password'
                });
            }
        }

        // Delete user (cascade delete of transactions will be handled by application logic if needed)
        await User.findByIdAndDelete(req.user._id);

        logger.info('Account deleted', { userId: req.user._id, email: user.email });

        res.json({
            success: true,
            message: 'Account deleted successfully'
        });
    } catch (error) {
        logger.error('Error deleting account', { 
            error: error.message,
            userId: req.user._id
        });
        Sentry.captureException(error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete account'
        });
    }
});

export default router;
