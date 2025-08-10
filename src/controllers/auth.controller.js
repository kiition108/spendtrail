import {User} from "../models/User.model.js";
import jwt from "jsonwebtoken";


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
        const user= await User.create({ email, password });
        const token = generateToken(user._id);
        
        res.cookie('token', token, {
            httpOnly: true,
            secure: process.env.NODE_ENV === 'production', // Use secure cookies in production
            maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
        });
        res.status(201).json({
            message: "User registered successfully",    
        });
    } catch (error) {
        console.error("Registration error:", error);
        res.status(500).json({ message: "Internal server error" });
    }
}

export const login = async (req, res) => {
    const { email, password } = req.body;
    const user= await User.findOne({ email });
    const isPasswordValid = await user.comparePassword(password);
    if(!user|| !isPasswordValid) {
        return res.status(401).json({ message: "Invalid email or password" });
    }
    const token=generateToken(user._id)
    const options={ 
         httpOnly: true,
         secure: false,
         sameSite: "None",
         maxAge: 7 * 24 * 60 * 60 * 1000,// 7 days
       }
    res.status(200)
    .cookie('token',token,options)
    .cookie('user', JSON.stringify({ id: user._id, email: user.email }), options)
    .json({
        message: "Login successful",
        token: token,
        user:{"id":user._id,"email":user.email}
    });
}
export const getCurrentUser =  async(req,res)=>{
    return res
    .status(200)
    .json({ message:"current user fetched successfully"})

    
}
export const logout = (req, res) => {
    res.clearCookie('token');
    res.status(200).json({ message: "Logged out successfully" });
}