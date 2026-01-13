import express from 'express';
import {
    addTransaction,
    getTransactionById, 
    updateTransaction,
    deleteTransaction,
    importTransactions,
    getTransactionByUser,
    getTransactionsBySearch,
    dayWeeklyTransactionSumm
} from '../controllers/transaction.controller.js';
import {auth} from '../middleware/auth.middleware.js';

const router = express.Router();

router.post('/', auth, addTransaction); // Add a new transaction
router.get('/user', auth, getTransactionByUser); // Get all transactions for the authenticated user
router.post('/import', auth, importTransactions);
router.get('/summary',auth,dayWeeklyTransactionSumm);
router.get('/', auth, getTransactionsBySearch);
router.get('/:id', auth, getTransactionById); // Get a specific transaction by ID
router.put('/:id', auth, updateTransaction);
router.delete('/:id', auth, deleteTransaction);


export default router;
// Export the router to be used in the main app file