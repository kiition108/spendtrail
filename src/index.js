import dotenv from 'dotenv';
import connectDB from './db/index.js';
import mongoose from 'mongoose';
import { app } from './app.js';
dotenv.config({ path: './env' })

// Handle uncaught exceptions (synchronous errors)
process.on('uncaughtException', (err) => {
    console.error('UNCAUGHT EXCEPTION! 💥 Shutting down...');
    console.error(err.name, err.message);
    process.exit(1);
});

let server;

connectDB()
    .then(() => {
        server = app.listen(process.env.PORT || 8000, '0.0.0.0', () => {
            console.log(`Server is running on port :http://localhost:${process.env.PORT}`);
            console.log(`Environment: ${process.env.NODE_ENV}`);
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
process.on('SIGTERM', () => {
    console.log('👋 SIGTERM RECEIVED. Shutting down gracefully');
    if (server) {
        server.close(() => {
            console.log('💥 Process terminated!');
            mongoose.connection.close(false, () => {
                console.log('MongoDb connection closed.');
                process.exit(0);
            });
        });
    }
});

// Graceful Shutdown (SIGINT) - for Ctrl+C
process.on('SIGINT', () => {
    console.log('👋 SIGINT RECEIVED. Shutting down gracefully');
    if (server) {
        server.close(() => {
            console.log('💥 Process terminated!');
            mongoose.connection.close(false, () => {
                console.log('MongoDb connection closed.');
                process.exit(0);
            });
        });
    }
});