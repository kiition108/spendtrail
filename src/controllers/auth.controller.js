import { User } from "../models/User.model.js";
import jwt from "jsonwebtoken";
import sendEmail from "../utils/sendEmail.js";
import { getOtpEmailTemplate } from "../utils/emailTemplates.js";
import crypto from "crypto";


const generateToken = (userId) => {
    return jwt.sign({ id: userId }, process.env.JWT_SECRET, {
        expiresIn: '7d', // Token expires in 7 days
    });
}

export const register = async (req, res) => {
    const { email, password } = req.body;
    try {
        // Check if user already exists
        let user = await User.findOne({ email });

        if (user) {
            if (user.isVerified) {
                return res.status(400).json({ message: "User already exists" });
            }

            // User exists but is NOT verified. Update details and resend OTP.
            // Update password in case they forgot the old one (will be hashed by pre-save)
            user.password = password;
            const otp = Math.floor(100000 + Math.random() * 900000).toString();
            user.otp = otp;
            user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
            await user.save();

            // Send OTP via email
            try {
                const emailHtml = getOtpEmailTemplate(otp);
                await sendEmail(email, "Verify Your SpendTrail Account", `Your OTP is: ${otp}`, emailHtml);

                return res.status(200).json({
                    message: "User already registered but not verified. OTP resent.",
                    userId: user._id,
                    isExistingUnverified: true
                });
            } catch (emailError) {
                console.error("Failed to send OTP email:", emailError);
                return res.status(500).json({ message: "Failed to send OTP email" });
            }
        }

        // New User Registration
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

        user = await User.create({
            email,
            password,
            otp,
            otpExpires,
            isVerified: false
        });

        // Send OTP via email
        try {
            const emailHtml = getOtpEmailTemplate(otp);
            await sendEmail(email, "Verify Your SpendTrail Account", `Your OTP is: ${otp}`, emailHtml);

            res.status(201).json({
                message: "User registered successfully. Please verify your email with the OTP sent.",
                userId: user._id
            });
        } catch (emailError) {
            console.error("Failed to send OTP email:", emailError);
            res.status(201).json({
                message: "User registered. OTP email failed to send.",
                userId: user._id
            });
        }
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

export const verifyOtp = async (req, res) => {
    const { email, otp } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "User not found" });
        }

        if (user.isVerified) {
            return res.status(400).json({ message: "User already verified" });
        }

        if (user.otp !== otp || user.otpExpires < Date.now()) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        user.isVerified = true;
        user.otp = undefined;
        user.otpExpires = undefined;
        await user.save();

        const token = generateToken(user._id);

        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production',
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });

        res.status(200).json({
            message: "Email verified successfully. Login successful.",
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                profilePicture: user.profilePicture,
                isVerified: user.isVerified,
                gmailIntegration: {
                    enabled: user.gmailIntegration?.enabled || false,
                    authorizedEmail: user.gmailIntegration?.authorizedEmail || null
                }
            }
        });
    } catch (error) {
        console.error("OTP Verification error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const resendOtp = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(400).json({ message: "User not found" });
        }

        if (user.isVerified) {
            return res.status(400).json({ message: "User already verified" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000;
        await user.save();

        const emailHtml = getOtpEmailTemplate(otp);
        await sendEmail(email, "New Verification Code", `Your new OTP is: ${otp}`, emailHtml);

        res.status(200).json({ message: "OTP resent successfully" });
    } catch (error) {
        console.error("Resend OTP error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Forgot Password - Send OTP
export const forgotPassword = async (req, res) => {
    const { email } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        user.otp = otp;
        user.otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes
        await user.save();

        const emailHtml = getOtpEmailTemplate(otp);
        await sendEmail(email, "Reset Your Password", `Your OTP for password reset is: ${otp}`, emailHtml);

        res.status(200).json({ message: "Password reset OTP sent to email" });
    } catch (error) {
        console.error("Forgot Password error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

// Reset Password - Verify OTP and Set New Password
export const resetPassword = async (req, res) => {
    const { email, otp, newPassword } = req.body;
    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        if (user.otp !== otp || user.otpExpires < Date.now()) {
            return res.status(400).json({ message: "Invalid or expired OTP" });
        }

        user.password = newPassword; // Will be hashed by pre-save hook
        user.otp = undefined;
        user.otpExpires = undefined;
        // If they verify their identity via OTP here, we can mark them as verified too
        if (!user.isVerified) user.isVerified = true;

        await user.save();

        res.status(200).json({ message: "Password reset successfully. You can now login." });
    } catch (error) {
        console.error("Reset Password error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
};

export const login = async (req, res) => {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
    }
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
        return res.status(401).json({ message: "Invalid email or password" });
    }

    if (!user.isVerified) {
        return res.status(401).json({
            message: "Please verify your email first",
            isVerified: false,
            userId: user._id
        });
    }
    const token = generateToken(user._id)
    const options = {
        httpOnly: true,
        secure: false,
        sameSite: "None",
        maxAge: 7 * 24 * 60 * 60 * 1000,// 7 days
    }
    res.status(200)
        .cookie('token', token, options)
        .cookie('user', JSON.stringify({ id: user._id, email: user.email }), options)
        .json({
            message: "Login successful",
            token: token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                profilePicture: user.profilePicture,
                isVerified: user.isVerified,
                gmailIntegration: {
                    enabled: user.gmailIntegration?.enabled || false,
                    authorizedEmail: user.gmailIntegration?.authorizedEmail || null
                }
            }
        });
}
export const getCurrentUser = async (req, res) => {
    return res
        .status(200)
        .json({ message: "current user fetched successfully" })


}
export const logout = (req, res) => {
    res.clearCookie('token');
    res.status(200).json({ message: "Logged out successfully" });
}