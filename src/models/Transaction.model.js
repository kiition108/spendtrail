import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    amount: { type: Number, required: true },
    category: String,
    note: String,
    timestamp: { type: Date, default: Date.now },
    location: {
        lat: Number,
        lng: Number,
        address: String
    },
});

export const Transaction = mongoose.model('Transaction', transactionSchema);
// This code defines a Mongoose schema for a Transaction model with fields for user ID, amount, category, note, timestamp, and location details.