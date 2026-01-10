// IMPORTANT: Sentry must be initialized FIRST, before any other imports
import * as Sentry from '@sentry/node';
import * as SentryProfiling from '@sentry/profiling-node';
import dotenv from 'dotenv';
dotenv.config();

// Initialize Sentry BEFORE importing app
Sentry.init({
    dsn: process.env.SENTRY_DSN || "https://9872c8a562565ec4ea15a2ee89f4899f@o4510684884107264.ingest.us.sentry.io/4510684888629248",

    environment: process.env.NODE_ENV || "development",

    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0, // 10% in production, 100% in development

    // Profiling
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    integrations: [
        SentryProfiling.nodeProfilingIntegration(),
    ],

    // Release tracking (optional, uncomment if you use releases)
    // release: process.env.npm_package_version,
});

import connectDB from './db/index.js';
import mongoose from 'mongoose';
import { app } from './app.js';

// Handle uncaught exceptions (synchronous errors)
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    process.exit(1);
});

let server;

import { emailPoller } from './services/emailPoller.js';

connectDB()
    .then(() => {
        server = app.listen(process.env.PORT || 8000, '0.0.0.0', () => {
            console.log(`Server is running on port :http://localhost:${process.env.PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV}`);

            // Start Email Poller
            emailPoller.start();
        });
    })
    .catch((error) => {
        console.error("Failed to connect to the database:", error);
        process.exit(1);
    })

// Handle unhandled rejections (asynchronous errors)
process.on('unhandledRejection', (err) => {
    console.error('UNHANDLED REJECTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    if (server) {
        server.close(() => {
            process.exit(1);
        });
    } else {
        process.exit(1);
    }
});

// Graceful Shutdown (SIGTERM)
// Graceful Shutdown (SIGTERM)
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM RECEIVED. Shutting down gracefully');
    if (server) {
        server.close(async () => {
            console.log('💥 Process terminated!');
            // Stop Email Poller
            if (emailPoller) emailPoller.isPolling = false;

            try {
                await mongoose.connection.close();
                console.log('MongoDb connection closed.');
                process.exit(0);
            } catch (err) {
                console.error('Error closing MongoDB connection:', err);
                process.exit(1);
            }
        });
    }
});

// Graceful Shutdown (SIGINT) - for Ctrl+C
process.on('SIGINT', () => {
    console.log('👋 SIGINT RECEIVED. Shutting down gracefully');
    if (server) {
        server.close(async () => {
            console.log('💥 Process terminated!');
            // Stop Email Poller
            if (emailPoller) emailPoller.isPolling = false;

            try {
                await mongoose.connection.close();
                console.log('MongoDb connection closed.');
                process.exit(0);
            } catch (err) {
                console.error('Error closing MongoDB connection:', err);
                process.exit(1);
            }
        });
    }
});