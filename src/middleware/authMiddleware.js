import jwt from "jsonwebtoken";
import {User} from "../models/User.model.js";

export const auth = async (req, res, next) => {
    const token = req.cookies.token || req.headers.authorization?.replace("Bearer", "");
    if (!token) {
        return res.status(401).json({ message: "Unauthorized" });
    }
    try{
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user= await User.findById(decoded.id).removePassword();
        next();
    }
    catch (error) {
        console.error("Authentication error:", error);
        return res.status(401).json({ message: "Unauthorized" });
    }
}