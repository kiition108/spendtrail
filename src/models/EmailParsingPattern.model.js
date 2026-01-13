import mongoose from 'mongoose';

/**
 * EmailParsingPattern Model
 * Stores email parsing patterns learned from user corrections
 * Helps improve parsing accuracy over time
 */
const emailParsingPatternSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: false, // Optional - null for global patterns
        index: true
    },

    // Pattern scope
    isGlobal: {
        type: Boolean,
        default: false,
        index: true // true = shared across all users, false = user-specific
    },

    // Number of unique users who confirmed this pattern
    confirmedByUsers: {
        type: Number,
        default: 1
    },

    // Email sender/source identification
    sender: {
        type: String,
        lowercase: true,
        trim: true,
        index: true // e.g., "alerts@hdfcbank.com"
    },

    senderDomain: {
        type: String,
        lowercase: true,
        trim: true // e.g., "hdfcbank.com"
    },

    // Original parsed data (what the parser extracted)
    originalParsed: mongoose.Schema.Types.Mixed,

    // Corrected data (what user actually confirmed/edited)
    correctedData: mongoose.Schema.Types.Mixed,

    // Raw email content for pattern analysis
    rawEmail: {
        subject: String,
        body: String // First 500 chars
    },

    // Pattern metadata
    metadata: {
        subjectPattern: String, // Regex pattern extracted from subject
        bodyPatterns: [String], // Key phrases that indicate transaction type
        amountFormat: String, // e.g., "Rs.70.00", "510 deduction"
        merchantPosition: String // Where merchant name appears (before/after keywords)
    },

    // Learning statistics
    confidence: {
        type: Number,
        min: 0,
        max: 1,
        default: 0.5
    },

    timesApplied: {
        type: Number,
        default: 0
    },

    successRate: {
        type: Number,
        min: 0,
        max: 1,
        default: 0
    }
}, {
    timestamps: true
});

// Compound index for efficient lookups
emailParsingPatternSchema.index({ user: 1, senderDomain: 1 });
emailParsingPatternSchema.index({ user: 1, confidence: -1 });
emailParsingPatternSchema.index({ isGlobal: 1, senderDomain: 1, confidence: -1 });

// Static method to find matching pattern (checks user-specific first, then global)
emailParsingPatternSchema.statics.findPattern = async function(userId, sender, subject) {
    const domain = sender.match(/@([a-z0-9.-]+\.[a-z]{2,})$/i)?.[1]?.toLowerCase();
    
    // First, check user-specific patterns
    const userPatterns = await this.find({
        user: userId,
        isGlobal: false,
        $or: [
            { sender: sender.toLowerCase() },
            { senderDomain: domain }
        ],
        confidence: { $gt: 0.6 }
    }).sort({ confidence: -1, successRate: -1 }).limit(3);
    
    // Then check global patterns
    const globalPatterns = await this.find({
        isGlobal: true,
        $or: [
            { sender: sender.toLowerCase() },
            { senderDomain: domain }
        ],
        confidence: { $gt: 0.7 } // Higher threshold for global patterns
    }).sort({ confirmedByUsers: -1, confidence: -1 }).limit(2);
    
    // Return user patterns first, then global
    return [...userPatterns, ...globalPatterns];
};

// Static method to check and promote patterns to global
emailParsingPatternSchema.statics.promoteToGlobal = async function(senderDomain, sender) {
    // Find similar patterns from different users for the same sender
    const similarPatterns = await this.find({
        isGlobal: false,
        $or: [
            { sender: sender.toLowerCase() },
            { senderDomain: senderDomain }
        ],
        confidence: { $gt: 0.7 }
    });
    
    // Group by corrected data (same parsing result)
    const patternGroups = {};
    similarPatterns.forEach(pattern => {
        const key = `${pattern.correctedData.amount}_${pattern.correctedData.type}_${pattern.correctedData.merchant}`;
        if (!patternGroups[key]) {
            patternGroups[key] = [];
        }
        patternGroups[key].push(pattern);
    });
    
    // Check if any group has 3+ different users with similar corrections
    for (const [key, patterns] of Object.entries(patternGroups)) {
        const uniqueUsers = new Set(patterns.map(p => p.user?.toString()).filter(Boolean));
        
        if (uniqueUsers.size >= 3) {
            // Promote to global pattern
            const representativePattern = patterns[0];
            
            // Check if global pattern already exists
            const existingGlobal = await this.findOne({
                isGlobal: true,
                senderDomain: senderDomain,
                'correctedData.type': representativePattern.correctedData.type
            });
            
            if (!existingGlobal) {
                // Create new global pattern
                await this.create({
                    user: null,
                    isGlobal: true,
                    confirmedByUsers: uniqueUsers.size,
                    sender: representativePattern.sender,
                    senderDomain: representativePattern.senderDomain,
                    originalParsed: representativePattern.originalParsed,
                    correctedData: representativePattern.correctedData,
                    rawEmail: representativePattern.rawEmail,
                    metadata: representativePattern.metadata,
                    confidence: Math.min(0.95, 0.7 + (uniqueUsers.size * 0.05)), // Increase confidence with more users
                    successRate: 0.9
                });
                
                return true;
            } else {
                // Update existing global pattern
                existingGlobal.confirmedByUsers = uniqueUsers.size;
                existingGlobal.confidence = Math.min(0.95, 0.7 + (uniqueUsers.size * 0.05));
                await existingGlobal.save();
            }
        }
    }
    
    return false;
};

// Instance method to apply pattern to new email
emailParsingPatternSchema.methods.applyPattern = function(emailData) {
    const suggestions = {};

    // Suggest corrections based on learned patterns
    if (this.metadata.merchantPosition && emailData.body) {
        // Try to extract merchant using learned position
        suggestions.merchant = this.correctedData.merchant;
    }

    if (this.metadata.amountFormat) {
        // Suggest amount format
        suggestions.amountFormat = this.metadata.amountFormat;
    }

    if (this.correctedData.category) {
        suggestions.category = this.correctedData.category;
    }

    if (this.correctedData.paymentMethod) {
        suggestions.paymentMethod = this.correctedData.paymentMethod;
    }

    return suggestions;
};

export const EmailParsingPattern = mongoose.model('EmailParsingPattern', emailParsingPatternSchema);
