import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';

import authRoutes from './routes/auth.route.js';
import transactionRoutes from './routes/transaction.route.js';
import logger from './utils/logger.js';
import webhookRoutes from './routes/webhook.routes.js';


const app = express();

// Security: Set various HTTP headers
app.use(helmet());

// Performance: Compress response bodies
app.use(compression());

// CORS configuration
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*', // Fallback for safety, but env should be set
  credentials: true
}));

// Body parsing
app.use(express.json({ limit: '10kb' })); // Limit body size to prevent DoS
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// Security: Data sanitization against NoSQL query injection
// Security: Data sanitization against NoSQL query injection
// Custom implementation to handle Express 5 req.query read-only issue
app.use((req, res, next) => {
  const sanitize = (obj) => {
    if (obj instanceof Object) {
      for (const key in obj) {
        if (/^\$/.test(key)) {
          delete obj[key];
        } else {
          sanitize(obj[key]);
        }
      }
    }
    return obj;
  };

  if (req.body) sanitize(req.body);
  if (req.params) sanitize(req.params);
  if (req.query) sanitize(req.query);

  next();
});

// Security: Prevent HTTP Parameter Pollution
app.use(hpp());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
app.use('/api', limiter); // Apply to all API routes

// Routes
app.use('/api/v1/smswebhook', webhookRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/transactions', transactionRoutes);

// Global Error Handler
app.use((err, req, res, next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    method: req.method,
    url: req.originalUrl,
    body: req.body,
    userId: req.user ? req.user.id : null,
  });

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Something went wrong. Please try again later.';

  res.status(statusCode).json({
    status: 'error',
    statusCode,
    message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

export { app };
