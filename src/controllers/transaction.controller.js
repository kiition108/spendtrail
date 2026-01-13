import {Transaction} from '../models/Transaction.model.js';
import { reverseGeocode } from '../utils/geocode.helper.js';
import { logInfo, logError, logWarn } from '../utils/logService.js';
import moment from 'moment-timezone'




export const addTransaction = async (req, res) => {
    const {amount,currency,category,subCategory,merchant,note,paymentMethod,tags=[],location,source="manual", timestamp } = req.body;
    const user = req.user._id; // Assuming user ID is available in req.user
    if (!amount || !category || !location) {
        logWarn("required field missing",req);
        return res.status(400).json({ message: 'Amount, location and category are required' });
    }
    let locationData = {
      lat:location?.lat,
      lng:location?.lng,
      address:location?.address,
      city:location?.city,
      country:location?.country,
      placeName:location?.placeName,
    };

    // 🧠 If address info missing but lat/lng exist — reverse geocode
    if ((!location?.address || !location?.city || !location?.country) && location?.lat && location?.lng) {
      const geo = await reverseGeocode(location?.lat, location?.lng);
      locationData = {
        ...locationData,
        ...geo,
      };
    }
    try {
        const transaction = await Transaction.create({
      user,
      amount,
      currency,
      category,
      subCategory:subCategory||'',
      merchant,
      note,
      paymentMethod,
      tags,
      location:locationData,
      timestamp:timestamp||new Date(),
      source,
    });
    logInfo('Transaction created', req, { transactionId: transaction._id });
        res.status(201).json({
            message: 'Transaction created successfully',
            transaction
        });
    } catch (error) {
        logError('Failed to create transaction', error, req);
        res.status(500).json({
            message: 'Error creating transaction'
        });
    }
}

export const getTransactionByUser = async (req, res) => {
    const user = req.user._id; // Assuming user ID is available in req.user
    try {
        const transactions = await Transaction.find({ user }).sort({ timestamp: -1 });
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
    const user = req.user._id; // Assuming user ID is available in req.user
    try {
        const transaction = await Transaction.findOne({ _id: id, user });
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
    const user=req.user.id
  try {
    const transactions = req.body.map(tx => ({
      ...tx,
      user,
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
    const user= req.user.id;

    const transaction = await Transaction.findOneAndUpdate(
      { _id: id, user },
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
    const user=req.user.id

    const deleted = await Transaction.findOneAndDelete({
      _id: id,
      user
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

    const filter = { user: req.user.id };

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

export const dayWeeklyTransactionSumm= async(req,res)=>{
  try{
  const user = req.user._id;
  const startOfToday = moment().tz('Asia/Kolkata').startOf('day').toDate();
  const startOfWeek = moment().tz('Asia/Kolkata').startOf('isoWeek').toDate();
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const sixMonthsAgo = moment().subtract(6, 'months').startOf('day').toDate();
  const now = new Date();

  if (startOfWeek < sixMonthsAgo) {
  return res.status(403).json({ message: 'Data older than 6 months requires premium access.' });
}

// Fetch today's transactions
const todayTransactions = await Transaction.find({
  user,
  timestamp: { $gte: startOfToday, $lte: now }
}).select('amount timestamp');

// Separate income and expenses for today
const todayExpenses = todayTransactions.filter(txn => txn.amount > 0);
const todayIncome = todayTransactions.filter(txn => txn.amount < 0);

// Weekly aggregation grouped by day
const weekAggregation = await Transaction.aggregate([
  {
    $match: {
      user,
      timestamp: { $gte: startOfWeek, $lte: now }
    }
  },
  {
    $group: {
      _id: { $dayOfWeek: "$timestamp" }, // 1 (Sun) - 7 (Sat)
      total: { $sum: "$amount" },
      expenses: { $sum: { $cond: [{ $gt: ["$amount", 0] }, "$amount", 0] } },
      income: { $sum: { $cond: [{ $lt: ["$amount", 0] }, { $abs: "$amount" }, 0] } },
      count: { $sum: 1 }
    }
  },
  { $sort: { _id: 1 } }
]);

// Total calculations
const totalTodayExpenses = todayExpenses.reduce((acc, txn) => acc + txn.amount, 0);
const totalTodayIncome = Math.abs(todayIncome.reduce((acc, txn) => acc + txn.amount, 0));
const totalWeekExpenses = weekAggregation.reduce((acc, t) => acc + t.expenses, 0);
const totalWeekIncome = weekAggregation.reduce((acc, t) => acc + t.income, 0);

// Response
res.json({
  today: {
    expenses: totalTodayExpenses,
    income: totalTodayIncome,
    count: todayTransactions.length,
    chart: todayTransactions.map(txn => ({
      time: txn.timestamp,
      amount: txn.amount
    }))
  },
  week: {
    expenses: totalWeekExpenses,
    income: totalWeekIncome,
    count: weekAggregation.reduce((acc, t) => acc + t.count, 0),
    chart: weekAggregation.map(t => ({
      day: dayNames[(t._id - 1) % 7],
      expenses: t.expenses,
      income: t.income
    }))
  }
});
}
catch(err){
  console.log(err);
}

}