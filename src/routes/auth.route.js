import express from 'express';      
import { register, login, logout } from '../controllers/auth.controller.js';
import {auth} from '../middleware/authMiddleware.js';

const router = express.Router();
// Register route
router.post('/register', register);
// Login route  
router.post('/login', login);
// Logout route
router.post('/logout',auth, logout);

export default router;
// Export the router to be used in the main app file