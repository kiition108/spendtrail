import express from 'express';
import {
    addTransaction,
    getTransactionById, 
    updateTransaction,
    deleteTransaction,
    importTransactions,
    getTransactionByUser,
    getTransactionsBySearch
} from '../controllers/transaction.controller.js';
import {auth} from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', auth, addTransaction); // Add a new transaction
router.get('/user', auth, getTransactionByUser); // Get all transactions for the authenticated user
router.get('/:id', auth, getTransactionById); // Get a specific transaction by ID
router.put('/:id', auth, updateTransaction);
router.delete('/:id', auth, deleteTransaction);
router.get('/', auth, getTransactionsBySearch);
router.post('/import', auth, importTransactions);

export default router;
// Export the router to be used in the main app file