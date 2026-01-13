import express from 'express';
import { handleSmsWebhook } from '../controllers/smsWebhook.controller.js';
import { verifyApiKey } from '../middleware/verifyApiKey.middleware.js';
import { smsWebhookLimiter } from '../middleware/rateLimiter.middleware.js';
import { auth } from '../middleware/auth.middleware.js';

const router = express.Router();


router.post('/',auth,smsWebhookLimiter,verifyApiKey, handleSmsWebhook);

export default router;
