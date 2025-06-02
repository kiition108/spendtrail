import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit'

import authRoutes from './routes/auth.route.js';
import transactionRoutes from './routes/transaction.route.js';
import logger from './utils/logger.js';
import webhookRoutes from './routes/webhook.routes.js';


const app = express();
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser())
app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 100 }));
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    body: req.body,
    userId: req.user ? req.user.id : null,
  });

  res.status(500).json({ error: 'Something went wrong. Please try again later.' });
});
//sms parse route
app.use('/api/v1/smswebhook', webhookRoutes);

// authentication routes
app.use('/api/v1/auth', authRoutes);
// transaction routes
app.use('/api/v1/transactions', transactionRoutes);
// Add after routes

export {app};
