import {Transaction} from '../models/Transaction.model.js';

export const addTransaction = async (req, res) => {
    const {amount, category, note, timestamp, location } = req.body;
    const userId = req.user._id; // Assuming user ID is available in req.user
    if (!amount || !category) {
        return res.status(400).json({ message: 'Amount and category are required' });
    }
    try {
        const transaction = await Transaction.create({
            userId,
            amount,
            category,
            note,
            timestamp: timestamp || new Date(),
            location
        });
        res.status(201).json({
            message: 'Transaction created successfully',
            transaction
        });
    } catch (error) {
        res.status(500).json({
            message: 'Error creating transaction'
        });
    }
}

export const getTransactions = async (req, res) => {
    const userId = req.user._id; // Assuming user ID is available in req.user
    try {
        const transactions = await Transaction.find({ userId }).sort({ timestamp: -1 });
        res.status(200).json({
            message: 'Transactions retrieved successfully',
            transactions
        }); 
    }
    catch (error) {
        res.status(500).json({
            message: 'Error retrieving transactions'
        });
    }
}
export const getTransactionById = async (req, res) => {
    const { id } = req.params;
    const userId = req.user._id; // Assuming user ID is available in req.user
    try {
        const transaction = await Transaction.findOne({ _id: id, userId });
        if (!transaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }
        res.status(200).json({
            message: 'Transaction retrieved successfully',
            transaction
        });
    } catch (error) {
        res.status(500).json({
            message: 'Error retrieving transaction'
        });
    }
}