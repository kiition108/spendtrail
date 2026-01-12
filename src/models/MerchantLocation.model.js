import mongoose from 'mongoose';

/**
 * Learned merchant locations from user GPS history
 * Improves location accuracy for frequently visited merchants
 */
const merchantLocationSchema = new mongoose.Schema({
  user: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  
  // Normalized merchant name (lowercase, trimmed)
  merchantKey: { 
    type: String, 
    required: true 
  },
  
  // Original merchant name as seen in transactions
  merchantName: { 
    type: String, 
    required: true 
  },
  
  // Learned location data
  location: {
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    city: String,
    address: String,
    placeName: String,
  },
  
  // Learning metadata
  visits: { 
    type: Number, 
    default: 1 
  },
  
  confidence: { 
    type: Number, 
    min: 0, 
    max: 1, 
    default: 0 
  },
  
  // Track visits for averaging
  visitHistory: [{
    lat: Number,
    lng: Number,
    timestamp: Date,
    accuracy: Number,
  }],
  
  firstVisit: { type: Date, default: Date.now },
  lastVisit: { type: Date, default: Date.now },
  
}, {
  timestamps: true,
});

// Compound index for fast lookups
merchantLocationSchema.index({ user: 1, merchantKey: 1 }, { unique: true });
merchantLocationSchema.index({ user: 1, confidence: -1 }); // High confidence first

export const MerchantLocation = mongoose.model('MerchantLocation', merchantLocationSchema);
