import express from 'express';
import { register, login, logout, getCurrentUser, verifyOtp, resendOtp, forgotPassword, resetPassword } from '../controllers/auth.controller.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();
// Register route
router.post('/register', register);
// OTP Verification route
router.post('/verify-otp', verifyOtp);
// Resend OTP route
router.post('/resend-otp', resendOtp);
// Forgot Password route
router.post('/forgot-password', forgotPassword);
// Reset Password route
router.post('/reset-password', resetPassword);
// Login route  
router.post('/login', login);
// Logout route
router.post('/logout', auth, logout);
//getCurrentUser
router.get('/me', auth, getCurrentUser)
export default router;
// Export the router to be used in the main app file