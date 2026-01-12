import mongoose from 'mongoose';

const transactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'INR' },

  category: { type: String, required: true },       // e.g. "Food"
  subCategory: { type: String },                    // e.g. "Dining"

  merchant: { type: String },                       // e.g. "Starbucks"
  note: { type: String },

  paymentMethod: { type: String, enum: ['cash', 'card', 'upi', 'wallet', 'other'], default: 'other' },
  source: { type: String, enum: ['manual', 'sms', 'email', 'gmail', 'imported'], default: 'manual' },

  tags: [{ type: String }],

  location: {
    type: { 
      type: String, 
      enum: ['exact', 'approx', 'online', 'unknown'], 
      default: 'unknown' 
    },
    lat: { type: Number, default: null },
    lng: { type: Number, default: null },
    address: { type: String },
    city: { type: String },
    country: { type: String, default: 'India' },
    placeName: { type: String },  // e.g. Starbucks Koramangala
    confidence: { 
      type: Number, 
      min: 0, 
      max: 1, 
      default: 0 
    },
    source: { 
      type: String, 
      enum: ['gps_exact', 'gps_correlation', 'merchant_lookup', 'bank_hint', 'manual', 'unknown'],
      default: 'unknown'
    },
  },

  timestamp: { type: Date, default: Date.now },
  messageHash: { type: String },
}, {
  timestamps: true,
});

transactionSchema.index({ user: 1, messageHash: 1 }); // Deduplication scope
transactionSchema.index({ user: 1, timestamp: -1 }); // Fast recent lookups
transactionSchema.index({ note: 'text', merchant: 'text' }); // Text search

export const Transaction = mongoose.model('Transaction', transactionSchema);
// This code defines a Mongoose schema for a Transaction model with fields for user ID, amount, category, note, timestamp, and location details.