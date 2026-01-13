import mongoose from 'mongoose';
import { LOCATION_PATTERN_TYPES } from '../constants/locationConstants.js';

/**
 * Location learning patterns from email parsing
 * Learns location extraction patterns from user corrections
 */
const emailLocationPatternSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Email sender details
    sender: {
        type: String,
        required: true,
        lowercase: true,
        trim: true
    },

    senderDomain: {
        type: String,
        lowercase: true,
        index: true
    },

    // Pattern to extract location
    locationPattern: {
        // Text pattern that indicates location in email
        pattern: String,
        
        // Type of location extraction
        type: {
            type: String,
            enum: Object.values(LOCATION_PATTERN_TYPES),
            default: LOCATION_PATTERN_TYPES.ADDRESS_TEXT
        },

        // Sample text that was matched
        example: String
    },

    // Merchant association (if location is tied to a specific merchant)
    merchantKey: String,
    merchantName: String,

    // Learned location data
    location: {
        lat: Number,
        lng: Number,
        address: String,
        city: String,
        placeName: String
    },

    // Pattern confidence and usage stats
    confidence: {
        type: Number,
        min: 0,
        max: 1,
        default: 0.5
    },

    timesMatched: {
        type: Number,
        default: 0
    },

    successfulExtractions: {
        type: Number,
        default: 0
    },

    // Is this pattern global (applicable to all users)?
    isGlobal: {
        type: Boolean,
        default: false
    },

    lastUsed: Date
}, {
    timestamps: true
});

// Compound indexes
emailLocationPatternSchema.index({ user: 1, sender: 1 });
emailLocationPatternSchema.index({ senderDomain: 1, isGlobal: 1 });
emailLocationPatternSchema.index({ merchantKey: 1 });

/**
 * Find location patterns for a sender
 */
emailLocationPatternSchema.statics.findPatternForSender = async function(userId, sender, merchantName = null) {
    const senderDomain = sender.match(/@([a-z0-9.-]+\.[a-z]{2,})$/i)?.[1]?.toLowerCase();
    
    const query = {
        $or: [
            { user: userId, sender: sender.toLowerCase() },
            { isGlobal: true, senderDomain: senderDomain }
        ]
    };

    // If merchant name provided, prioritize merchant-specific patterns
    if (merchantName) {
        const merchantKey = merchantName.toLowerCase().trim();
        query.$or.push({ merchantKey });
    }

    const patterns = await this.find(query)
        .sort({ confidence: -1, successfulExtractions: -1 })
        .limit(5)
        .lean();

    return patterns;
};

/**
 * Record successful location extraction
 */
emailLocationPatternSchema.methods.recordSuccess = async function() {
    this.timesMatched += 1;
    this.successfulExtractions += 1;
    this.confidence = Math.min(this.successfulExtractions / this.timesMatched, 1.0);
    this.lastUsed = new Date();
    await this.save();
};

/**
 * Record failed location extraction
 */
emailLocationPatternSchema.methods.recordFailure = async function() {
    this.timesMatched += 1;
    this.confidence = this.successfulExtractions / this.timesMatched;
    this.lastUsed = new Date();
    await this.save();
};

export const EmailLocationPattern = mongoose.model('EmailLocationPattern', emailLocationPatternSchema);
