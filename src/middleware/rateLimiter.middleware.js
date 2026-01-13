// middlewares/rateLimiter.js
import rateLimit from 'express-rate-limit';

export const smsWebhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 30,             // max 30 requests per minute
  message: 'Too many requests, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
