import mongoose from 'mongoose';
import { fuzzyMatch, normalizeMerchantName } from '../utils/stringSimilarity.js';

/**
 * MerchantPattern Model
 * Stores learned patterns from user corrections:
 * - Merchant name variations ("SBUX" → "Starbucks")
 * - Category preferences (Pizza Hut → Food, not Shopping)
 * - Payment method patterns (Amazon → card, local shop → cash)
 */
const merchantPatternSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Merchant identification
    merchantKey: {
        type: String,
        required: true,
        lowercase: true,
        trim: true,
        index: true
    },

    merchantName: {
        type: String, // Canonical/corrected name
        required: true
    },

    // Known variations from SMS/email parsing
    variations: [{
        parsedName: String,      // How parser saw it (e.g., "SBUX", "STRBKS")
        occurrences: {
            type: Number,
            default: 1
        },
        lastSeen: Date
    }],

    // Category learning
    categoryPattern: {
        preferredCategory: String,  // Most common user-corrected category
        confidence: {
            type: Number,
            min: 0,
            max: 1,
            default: 0
        },
        history: [{
            parsedCategory: String,
            correctedCategory: String,
            date: Date
        }]
    },

    // Payment method learning
    paymentMethodPattern: {
        preferredMethod: {
            type: String,
            enum: ['cash', 'card', 'upi', 'wallet', 'other']
        },
        confidence: {
            type: Number,
            min: 0,
            max: 1,
            default: 0
        },
        history: [{
            parsedMethod: String,
            correctedMethod: String,
            date: Date
        }]
    },

    // Transaction count for confidence calculation
    totalTransactions: {
        type: Number,
        default: 1
    },

    totalCorrections: {
        type: Number,
        default: 0
    }
}, {
    timestamps: true
});

// Compound index for efficient lookups
merchantPatternSchema.index({ user: 1, merchantKey: 1 }, { unique: true });

// Method to add a variation
merchantPatternSchema.methods.addVariation = function(parsedName) {
    const existing = this.variations.find(v => v.parsedName.toLowerCase() === parsedName.toLowerCase());
    
    if (existing) {
        existing.occurrences += 1;
        existing.lastSeen = new Date();
    } else {
        this.variations.push({
            parsedName,
            occurrences: 1,
            lastSeen: new Date()
        });
    }
};

// Method to learn category from correction
merchantPatternSchema.methods.learnCategory = function(parsedCategory, correctedCategory) {
    if (!this.categoryPattern) {
        this.categoryPattern = { history: [] };
    }

    // Add to history
    this.categoryPattern.history.push({
        parsedCategory,
        correctedCategory,
        date: new Date()
    });

    // Keep only last 20 corrections
    if (this.categoryPattern.history.length > 20) {
        this.categoryPattern.history = this.categoryPattern.history.slice(-20);
    }

    // Find most common corrected category
    const categoryCounts = {};
    this.categoryPattern.history.forEach(h => {
        categoryCounts[h.correctedCategory] = (categoryCounts[h.correctedCategory] || 0) + 1;
    });

    const mostCommon = Object.entries(categoryCounts)
        .sort((a, b) => b[1] - a[1])[0];

    this.categoryPattern.preferredCategory = mostCommon[0];
    this.categoryPattern.confidence = mostCommon[1] / this.categoryPattern.history.length;
};

// Method to learn payment method from correction
merchantPatternSchema.methods.learnPaymentMethod = function(parsedMethod, correctedMethod) {
    if (!this.paymentMethodPattern) {
        this.paymentMethodPattern = { history: [] };
    }

    // Add to history
    this.paymentMethodPattern.history.push({
        parsedMethod,
        correctedMethod,
        date: new Date()
    });

    // Keep only last 20 corrections
    if (this.paymentMethodPattern.history.length > 20) {
        this.paymentMethodPattern.history = this.paymentMethodPattern.history.slice(-20);
    }

    // Find most common corrected method
    const methodCounts = {};
    this.paymentMethodPattern.history.forEach(h => {
        methodCounts[h.correctedMethod] = (methodCounts[h.correctedMethod] || 0) + 1;
    });

    const mostCommon = Object.entries(methodCounts)
        .sort((a, b) => b[1] - a[1])[0];

    this.paymentMethodPattern.preferredMethod = mostCommon[0];
    this.paymentMethodPattern.confidence = mostCommon[1] / this.paymentMethodPattern.history.length;
};

// Static method to suggest corrections for a parsed transaction
merchantPatternSchema.statics.suggestCorrections = async function(userId, parsedData) {
    const merchantKey = parsedData.merchant?.toLowerCase().trim();
    
    if (!merchantKey) return null;

    const pattern = await this.findOne({ user: userId, merchantKey });

    if (!pattern) return null;

    const suggestions = {};

    // Suggest canonical merchant name
    suggestions.merchant = pattern.merchantName;

    // Suggest category if confidence >= 0.6
    if (pattern.categoryPattern?.confidence >= 0.6) {
        suggestions.category = pattern.categoryPattern.preferredCategory;
    }

    // Suggest payment method if confidence >= 0.6
    if (pattern.paymentMethodPattern?.confidence >= 0.6) {
        suggestions.paymentMethod = pattern.paymentMethodPattern.preferredMethod;
    }

    return {
        suggestions,
        confidence: {
            merchant: 1.0, // Always suggest canonical name
            category: pattern.categoryPattern?.confidence || 0,
            paymentMethod: pattern.paymentMethodPattern?.confidence || 0
        }
    };
};

// Static method to find pattern by variation (with fuzzy matching)
merchantPatternSchema.statics.findByVariation = async function(userId, parsedMerchant) {
    const patterns = await this.find({ user: userId });
    
    // First try exact match on variations
    for (const pattern of patterns) {
        const exactMatch = pattern.variations.find(v => 
            v.parsedName.toLowerCase() === parsedMerchant.toLowerCase()
        );
        
        if (exactMatch) {
            return { pattern, similarity: 1.0, matchType: 'exact' };
        }
    }
    
    // Try fuzzy matching with 75% similarity threshold
    let bestMatch = null;
    let bestSimilarity = 0;
    const threshold = 0.75;
    
    for (const pattern of patterns) {
        // Check against canonical name
        const canonicalMatch = fuzzyMatch(parsedMerchant, pattern.merchantName, threshold);
        if (canonicalMatch.match && canonicalMatch.similarity > bestSimilarity) {
            bestMatch = pattern;
            bestSimilarity = canonicalMatch.similarity;
        }
        
        // Check against all variations
        for (const variation of pattern.variations) {
            const varMatch = fuzzyMatch(parsedMerchant, variation.parsedName, threshold);
            if (varMatch.match && varMatch.similarity > bestSimilarity) {
                bestMatch = pattern;
                bestSimilarity = varMatch.similarity;
            }
        }
    }
    
    if (bestMatch) {
        return { 
            pattern: bestMatch, 
            similarity: bestSimilarity,
            matchType: 'fuzzy'
        };
    }
    
    return null;
};

// Static method to suggest merchant name from fuzzy matching
merchantPatternSchema.statics.suggestMerchantName = async function(userId, parsedMerchant) {
    const result = await this.findByVariation(userId, parsedMerchant);
    
    if (!result) return null;
    
    return {
        suggestedName: result.pattern.merchantName,
        similarity: result.similarity,
        matchType: result.matchType,
        confidence: result.similarity
    };
};

export const MerchantPattern = mongoose.model('MerchantPattern', merchantPatternSchema);
