import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';

const userSchema = new mongoose.Schema({
    email: { 'type': String, required: true, unique: true },
    password: { 'type': String, required: false }, // Optional for OAuth users
    name: { type: String },
    isVerified: { type: Boolean, default: false },
    otp: { type: String },
    otpExpires: { type: Date },
    
    // Google OAuth
    googleId: { type: String, sparse: true, unique: true },
    profilePicture: { type: String },
    
    // Gmail Integration for transaction emails
    gmailIntegration: {
        enabled: { type: Boolean, default: false },
        authorizedEmail: { type: String },
        tokens: {
            access_token: { type: String },
            refresh_token: { type: String },
            expiry_date: { type: Number }
        },
        lastSync: { type: Date }
    },
    
    // Push notification device tokens
    deviceTokens: [{
        token: { type: String, required: true },
        platform: { type: String, enum: ['android', 'ios', 'web'], default: 'android' },
        addedAt: { type: Date, default: Date.now },
        lastUsed: { type: Date, default: Date.now }
    }]
}, {
    timestamps: true
});

userSchema.pre('save', async function () {
    if (this.isModified('password') && this.password) {
        this.password = await bcrypt.hash(this.password, 10);
    }
});

userSchema.methods.comparePassword = async function (password) {
    return await bcrypt.compare(password, this.password);
}

export const User = mongoose.model('User', userSchema);
// This code defines a Mongoose schema for a User model with email and password fields.