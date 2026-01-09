import { User } from "../models/User.model.js";
import jwt from "jsonwebtoken";
import sendEmail from "../utils/sendEmail.js";
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
        const existingUser = await User.find({ email });
        if (existingUser.length > 0) {
            return res.status(400).json({ message: "User already exists" });
        }

        // Generate 6-digit OTP
        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const otpExpires = Date.now() + 10 * 60 * 1000; // 10 minutes

        const user = await User.create({
            email,
            password,
            otp,
            otpExpires,
            isVerified: false
        });

        // Send OTP via email
        try {
            await sendEmail(email, "Your OTP Code", `Your OTP for account verification is: ${otp}`);
        } catch (emailError) {
            // If email fails, we might want to delete the user or handle it. 
            // For now, let's just log it, but user exists. They might need resend.
            console.error("Failed to send OTP email:", emailError);
        }

        res.status(201).json({
            message: "User registered successfully. Please verify your email with the OTP sent.",
            userId: user._id
        });
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
            user: { id: user._id, email: user.email }
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

        await sendEmail(email, "Your New OTP Code", `Your new OTP for account verification is: ${otp}`);

        res.status(200).json({ message: "OTP resent successfully" });
    } catch (error) {
        console.error("Resend OTP error:", error);
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
        return res.status(401).json({ message: "Please verify your email first" });
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
            user: { "id": user._id, "email": user.email }
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