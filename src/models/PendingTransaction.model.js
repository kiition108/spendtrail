import mongoose from 'mongoose';
import logger from '../utils/logger.js';

const pendingTransactionSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    
    // Original parsed data
    parsedData: {
        amount: { type: Number, required: true },
        type: { type: String, enum: ['income', 'expense'], required: true },
        category: String,
        description: String,
        merchant: String,
        date: Date,
        accountNumber: String,
        balance: Number,
        paymentMethod: String,
        location: {
            type: { type: String, enum: ['Point'], default: 'Point' },
            coordinates: [Number]
        }
    },

    // Source information
    source: {
        type: { type: String, enum: ['gmail', 'email', 'sms', 'manual'], required: true },
        emailId: String, // Gmail message ID or email hash
        rawContent: String, // Original email/SMS content
        subject: String, // Email subject
        from: String, // Email sender
        parsingStrategy: String // Which parser was used: 'bank-pattern', 'generic-parser', 'learned-pattern', 'testmail_forwarded', 'failed'
    },

    // Additional metadata for learning
    metadata: {
        parsingError: String, // Error message if parsing failed
        needsManualReview: Boolean, // Flag for admin review
        bankName: String, // Detected bank name
        originalHTML: String // Original HTML content (first 1000 chars)
    },

    // Confidence score from parser (0-1)
    confidenceScore: {
        type: Number,
        default: 0.5,
        min: 0,
        max: 1
    },

    // Status
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'expired'],
        default: 'pending',
        index: true
    },

    // User feedback (for ML improvement)
    userFeedback: {
        approved: Boolean,
        correctedData: mongoose.Schema.Types.Mixed,
        feedbackDate: Date,
        notes: String
    },

    // Created transaction reference (if approved)
    approvedTransaction: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Transaction'
    },

    // Notification tracking
    notificationSent: {
        type: Boolean,
        default: false
    },
    notificationSentAt: Date,

    // Auto-expire after 7 days
    expiresAt: {
        type: Date,
        default: () => new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
}, {
    timestamps: true
});

// Index for efficient queries
pendingTransactionSchema.index({ user: 1, status: 1, createdAt: -1 });
pendingTransactionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

// Virtual for formatted amount
pendingTransactionSchema.virtual('formattedAmount').get(function() {
    return `₹${this.parsedData.amount.toFixed(2)}`;
});

// Method to approve transaction
pendingTransactionSchema.methods.approve = async function(correctedData = null) {
    const Transaction = mongoose.model('Transaction');
    const MerchantLocation = mongoose.model('MerchantLocation');
    const EmailParsingPattern = mongoose.model('EmailParsingPattern');
    
    // Use corrected data if provided, otherwise use parsed data
    const transactionData = correctedData || this.parsedData;
    
    // If user corrected the data, learn from it
    if (correctedData && this.source.type === 'gmail' && this.source.from) {
        try {
            const senderDomain = this.source.from.match(/@([a-z0-9.-]+\.[a-z]{2,})$/i)?.[1]?.toLowerCase();
            
            await EmailParsingPattern.create({
                user: this.user,
                sender: this.source.from.toLowerCase(),
                senderDomain: senderDomain,
                originalParsed: {
                    amount: this.parsedData.amount,
                    type: this.parsedData.type,
                    merchant: this.parsedData.merchant,
                    category: this.parsedData.category,
                    paymentMethod: this.parsedData.paymentMethod
                },
                correctedData: {
                    amount: correctedData.amount,
                    type: correctedData.type,
                    merchant: correctedData.merchant,
                    category: correctedData.category,
                    paymentMethod: correctedData.paymentMethod
                },
                rawEmail: {
                    subject: this.source.subject,
                    body: this.source.rawContent?.substring(0, 500)
                },
                confidence: 0.7, // Start with medium confidence
                timesApplied: 0,
                successRate: 0
            });
            
            logger.info(`📚 Created learning pattern from user correction`, {
                sender: this.source.from,
                originalMerchant: this.parsedData.merchant,
                correctedMerchant: correctedData.merchant
            });
            
            // Check if this pattern should be promoted to global
            try {
                const promoted = await EmailParsingPattern.promoteToGlobal(senderDomain, this.source.from);
                if (promoted) {
                    logger.info(`🌐 Pattern promoted to global`, {
                        sender: this.source.from,
                        senderDomain: senderDomain
                    });
                }
            } catch (promoteErr) {
                logger.error('Error checking pattern promotion', { error: promoteErr.message });
            }
        } catch (err) {
            logger.error('Error creating learning pattern', { error: err.message });
        }
    }
    
    // Create actual transaction
    const transaction = await Transaction.create({
        user: this.user,
        amount: transactionData.amount,
        category: transactionData.category || 'Other',
        note: transactionData.description,
        merchant: transactionData.merchant,
        timestamp: transactionData.date || new Date(),
        source: this.source.type,
        location: transactionData.location?.coordinates ? {
            type: 'exact',
            lat: transactionData.location.coordinates[1],
            lng: transactionData.location.coordinates[0],
            source: 'bank_hint'
        } : undefined,
        metadata: {
            fromPending: true,
            originalParsedData: this.parsedData,
            correctedData: correctedData ? true : false,
            userCorrected: !!correctedData
        }
    });

    // Update pending transaction
    this.status = 'approved';
    this.approvedTransaction = transaction._id;
    this.userFeedback = {
        approved: true,
        correctedData: correctedData,
        feedbackDate: new Date()
    };
    
    await this.save();
    
    return transaction;
};

// Method to reject transaction
pendingTransactionSchema.methods.reject = async function(reason = null) {
    this.status = 'rejected';
    this.userFeedback = {
        approved: false,
        feedbackDate: new Date(),
        notes: reason
    };
    
    await this.save();
};

// Static method to get pending count for user
pendingTransactionSchema.statics.getPendingCount = async function(userId) {
    return this.countDocuments({ user: userId, status: 'pending' });
};

// Static method to expire old pending transactions
pendingTransactionSchema.statics.expireOldTransactions = async function() {
    const result = await this.updateMany(
        {
            status: 'pending',
            expiresAt: { $lt: new Date() }
        },
        {
            $set: { status: 'expired' }
        }
    );
    
    return result.modifiedCount;
};

export const PendingTransaction = mongoose.model('PendingTransaction', pendingTransactionSchema);
