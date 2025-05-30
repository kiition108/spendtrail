import express from 'express';
import cors from 'cors';

import authRoutes from './routes/auth.route.js';
import transactionRoutes from './routes/transaction.route.js';

const app = express();
app.use(cors({
    origin: process.env.CORS_ORIGIN,
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// authentication routes
app.use('/api/v1/auth', authRoutes);
// transaction routes
app.use('/api/v1/transactions', transactionRoutes);
export {app};
