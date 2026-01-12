import mongoose from 'mongoose';

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
        type: { type: String, enum: ['gmail', 'sms', 'manual'], required: true },
        emailId: String, // Gmail message ID
        rawContent: String, // Original email/SMS content
        subject: String // Email subject
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
        correctedData: {
            amount: Number,
            type: String,
            category: String,
            description: String,
            merchant: String,
            date: Date
        },
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
    
    // Use corrected data if provided, otherwise use parsed data
    const transactionData = correctedData || this.parsedData;
    
    // Create actual transaction
    const transaction = await Transaction.create({
        user: this.user,
        amount: transactionData.amount,
        type: transactionData.type,
        category: transactionData.category,
        description: transactionData.description,
        merchant: transactionData.merchant,
        date: transactionData.date || new Date(),
        source: this.source.type,
        location: transactionData.location,
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
