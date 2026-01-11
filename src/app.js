import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import compression from 'compression';
import mongoSanitize from 'express-mongo-sanitize';
import hpp from 'hpp';
import * as Sentry from '@sentry/node';

import authRoutes from './routes/auth.route.js';
import transactionRoutes from './routes/transaction.route.js';
import logger from './utils/logger.js';
import webhookRoutes from './routes/webhook.routes.js';
import gmailRoutes from './routes/gmail.routes.js';
import settingsRoutes from './routes/settings.routes.js';
import googleAuthRoutes from './routes/googleAuth.routes.js';
import pendingTransactionRoutes from './routes/pendingTransaction.routes.js';
import deviceRoutes from './routes/device.routes.js';
import profileRoutes from './routes/profile.routes.js';




const app = express();

// Security: Set various HTTP headers
app.use(helmet());

// Performance: Compress responses bodies
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

// Rate limiting with Sentry alerts
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  handler: (req, res) => {
    // Alert on rate limit hit
    Sentry.captureMessage('Rate limit exceeded', {
      level: 'warning',
      tags: {
        ip: req.ip,
        path: req.path,
        method: req.method
      },
      extra: {
        userAgent: req.headers['user-agent'],
        userId: req.user?.id
      }
    });

    logger.warn('Rate limit exceeded', {
      ip: req.ip,
      path: req.path,
      userAgent: req.headers['user-agent']
    });

    res.status(429).json({
      status: 'error',
      message: 'Too many requests from this IP, please try again later.'
    });
  }
});
app.use('/api', limiter); // Apply to all API routes

// Performance Monitoring - Track slow requests
app.use((req, res, next) => {
  const start = Date.now();

  res.on('finish', () => {
    const duration = Date.now() - start;

    // Log all requests
    logger.info('API Request', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration,
      userId: req.user?.id
    });

    // Alert on slow requests (>1 second)
    if (duration > 1000) {
      logger.warn('Slow request detected', {
        path: req.path,
        method: req.method,
        duration,
        userId: req.user?.id
      });

      Sentry.captureMessage('Slow API Request', {
        level: 'warning',
        tags: {
          endpoint: req.path,
          method: req.method,
          duration: `${duration}ms`
        },
        extra: {
          userId: req.user?.id,
          query: req.query,
          params: req.params
        }
      });
    }
  });

  next();
});

// Health Check Endpoint (not rate limited)
app.get('/api/v1/health', async (req, res) => {
  try {
    // Import mongoose dynamically to check connection
    const mongoose = (await import('mongoose')).default;

    // Check database connection
    const dbStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    // Optionally ping database to verify it's responsive
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.admin().ping();
    }

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      mongodb: dbStatus,
      environment: process.env.NODE_ENV || 'development',
      version: '1.0.0'
    });
  } catch (error) {
    // Log to Sentry on health check failure
    Sentry.captureException(error);
    logger.error('Health check failed', { error: error.message });

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Debug Sentry endpoint (only in development)
if (process.env.NODE_ENV !== 'production') {
  app.get('/api/v1/debug-sentry', (req, res) => {
    throw new Error('Backend Sentry test error!');
  });
}

// Routes
app.use('/api/v1/smswebhook', webhookRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/auth', googleAuthRoutes);  // Google OAuth routes
app.use('/api/v1/transactions', transactionRoutes);
app.use('/api/v1/gmail', gmailRoutes);
app.use('/api/v1/settings', settingsRoutes);  // User settings routes
app.use('/api/v1/pending-transactions', pendingTransactionRoutes);  // Pending transactions
app.use('/api/v1/device', deviceRoutes);  // Device token registration
app.use('/api/v1/profile', profileRoutes);  // Profile management



// Global Error Handler
app.use((err, req, res, next) => {
  // Capture error in Sentry with additional context
  Sentry.captureException(err, {
    user: req.user ? {
      id: req.user.id,
      email: req.user.email
    } : undefined,
    tags: {
      endpoint: req.path,
      method: req.method,
      statusCode: err.statusCode || 500
    },
    extra: {
      body: req.body,
      query: req.query,
      params: req.params,
      ip: req.ip
    }
  });

  // Log to Winston logger
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
