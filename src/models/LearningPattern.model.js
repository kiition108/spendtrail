import mongoose from 'mongoose';

/**
 * Stores user feedback patterns for ML improvement
 * Tracks corrections made to parsed transactions to improve future parsing
 */
const learningPatternSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Original parsed data that was incorrect
    originalParsed: {
        amount: Number,
        type: String,
        category: String,
        merchant: String,
        description: String
    },

    // Corrected data provided by user
    correctedData: mongoose.Schema.Types.Mixed,

    // Source information
    source: {
        type: String,
        enum: ['gmail', 'sms'],
        required: true
    },

    // Original raw content (for pattern analysis)
    rawContent: {
        type: String,
        required: true
    },

    // Pattern metadata
    metadata: {
        emailSubject: String,
        sender: String,
        keywords: [String],  // Extracted keywords
        confidence: Number    // Original confidence score
    },

    // Feedback statistics
    corrections: {
        amountChanged: Boolean,
        typeChanged: Boolean,
        categoryChanged: Boolean,
        merchantChanged: Boolean,
        descriptionChanged: Boolean
    },

    // Usage tracking
    timesApplied: {
        type: Number,
        default: 0
    },
    successRate: {
        type: Number,
        default: 0,
        min: 0,
        max: 1
    }
}, {
    timestamps: true
});

// Index for efficient pattern matching
learningPatternSchema.index({ user: 1, source: 1, createdAt: -1 });
learningPatternSchema.index({ 'metadata.sender': 1, 'metadata.keywords': 1 });

// Static method to find similar patterns
learningPatternSchema.statics.findSimilarPatterns = async function(userId, rawContent, sender) {
    // Simple keyword-based matching
    // In production, this would use ML/NLP for better matching
    const patterns = await this.find({
        user: userId,
        'metadata.sender': sender
    })
    .sort({ successRate: -1, createdAt: -1 })
    .limit(10);

    return patterns;
};

// Method to apply pattern to new parsing
learningPatternSchema.methods.apply = function(parsedData) {
    const improved = { ...parsedData };

    // Apply corrections based on learned pattern
    if (this.corrections.categoryChanged && this.correctedData.category) {
        improved.category = this.correctedData.category;
    }
    if (this.corrections.merchantChanged && this.correctedData.merchant) {
        improved.merchant = this.correctedData.merchant;
    }

    // Increment usage counter
    this.timesApplied += 1;
    this.save();

    return improved;
};

// Method to update success rate based on user feedback
learningPatternSchema.methods.recordFeedback = async function(wasSuccessful) {
    const totalApplications = this.timesApplied;
    const currentSuccessCount = this.successRate * (totalApplications - 1);
    
    this.successRate = (currentSuccessCount + (wasSuccessful ? 1 : 0)) / totalApplications;
    await this.save();
};

export const LearningPattern = mongoose.model('LearningPattern', learningPatternSchema);
