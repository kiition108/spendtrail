import {Transaction} from '../models/Transaction.model.js';
import { logInfo, logError, logWarn } from '../utils/logService.js';





export const addTransaction = async (req, res) => {
    const {amount,currency, category,subCategory,merchant, note,paymentMethod,tags, location,source, timestamp } = req.body;
    const userId = req.user._id; // Assuming user ID is available in req.user
    if (!amount || !category || !location) {
        logWarn("required field missing",req);
        return res.status(400).json({ message: 'Amount, location and category are required' });
    }
    try {
        const transaction = await Transaction.create({
      userId,
      amount,
      currency,
      category,
      subCategory,
      merchant,
      note,
      paymentMethod,
      tags,
      location,
      timestamp,
      source,
    });
    logInfo('Transaction created', req, { transactionId: transaction._id });
        res.status(201).json({
            message: 'Transaction created successfully',
            transaction
        });
    } catch (error) {
        logError('Failed to create transaction', err, req);
        res.status(500).json({
            message: 'Error creating transaction'
        });
    }
}

export const getTransactionByUser = async (req, res) => {
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

export const importTransactions = async (req, res) => {
    const userId=req.user.id
  try {
    const transactions = req.body.map(tx => ({
      ...tx,
      userId,
    }));

    const result = await Transaction.insertMany(transactions);

    res.status(201).json(result);
  } catch (err) {
    res.status(500).json({ error: 'Batch import failed' });
  }
};


export const updateTransaction = async (req, res) => {
  try {
    const id = req.params.id;
    const update = req.body;
    const userId= req.user.id;

    const transaction = await Transaction.findOneAndUpdate(
      { _id: id, userId },
      update,
      { new: true }
    );

    if (!transaction) return res.status(404).json({ error: 'Transaction not found' });

    res.json(transaction);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update transaction' });
  }
};

export const deleteTransaction = async (req, res) => {
  try {
    const id = req.params.id;
    const userId=req.user.id

    const deleted = await Transaction.findOneAndDelete({
      _id: id,
      userId
    });

    if (!deleted) return res.status(404).json({ error: 'Transaction not found' });

    res.json({ message: 'Transaction deleted' });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete transaction' });
  }
};

export const getTransactionsBySearch = async (req, res) => {
  try {
    const { start, end, category, tags, source, q } = req.query;

    const filter = { userId: req.user.id };

    if (start || end) {
      filter.timestamp = {};
      if (start) filter.timestamp.$gte = new Date(start);
      if (end) filter.timestamp.$lte = new Date(end);
    }

    if (category) filter.category = category;
    if (source) filter.source = source;
    if (tags) filter.tags = { $in: tags.split(',') };

    let query = Transaction.find(filter).sort({ timestamp: -1 });

    if (q) {
      query = query.find({ $text: { $search: q } });
    }

    const transactions = await query.exec();
    res.json(transactions);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
};
