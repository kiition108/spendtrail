import express from 'express';
import { handleSmsWebhook } from '../controllers/smsWebhook.controller.js';
import { verifyApiKey } from '../middleware/verifyApiKey.js';
import { smsWebhookLimiter } from '../middleware/rateLimiter.js';
import { auth } from '../middleware/authMiddleware.js';

const router = express.Router();


router.post('/',auth,smsWebhookLimiter,verifyApiKey, handleSmsWebhook);

export default router;
