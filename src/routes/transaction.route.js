import express from 'express';
import {addTransaction, getTransactions, getTransactionById} from '../controllers/transaction.controller.js';
import {auth} from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', auth, addTransaction); // Add a new transaction
router.get('/', auth, getTransactions); // Get all transactions for the authenticated user
router.get('/:id', auth, getTransactionById); // Get a specific transaction by ID

export default router;
// Export the router to be used in the main app file