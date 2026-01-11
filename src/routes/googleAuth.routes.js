import express from 'express';
import { User } from '../models/User.model.js';
import { google } from 'googleapis';
import logger from '../utils/logger.js';
import jwt from 'jsonwebtoken';

const router = express.Router();

// Google OAuth configuration
const getGoogleOAuth2Client = () => {
    const redirectUri = `${process.env.BACKEND_URL || 'https://spendtrail.onrender.com'}/api/v1/auth/google/callback`;
    
    return new google.auth.OAuth2(
        process.env.GOOGLE_CLIENT_ID,
        process.env.GOOGLE_CLIENT_SECRET,
        redirectUri
    );
};

/**
 * GET /auth/google
 * Get Google OAuth authorization URL
 * Query params:
 *   - mobile_redirect: Optional app redirect URL for mobile (e.g., exp://...)
 */
router.get('/google', (req, res) => {
    try {
        const { mobile_redirect } = req.query;
        const oauth2Client = getGoogleOAuth2Client();
        
        const SCOPES = [
            'https://www.googleapis.com/auth/userinfo.profile',
            'https://www.googleapis.com/auth/userinfo.email'
        ];

        const authParams = {
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'select_account'
        };

        // If mobile redirect URL provided, encode it in state parameter
        if (mobile_redirect) {
            authParams.state = Buffer.from(JSON.stringify({ 
                mobile_redirect 
            })).toString('base64');
        }

        const authUrl = oauth2Client.generateAuthUrl(authParams);

        res.json({ 
            success: true, 
            authUrl,
            message: 'Visit this URL to sign in with Google'
        });
    } catch (error) {
        logger.error('Error generating Google auth URL', { error: error.message });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to generate Google authorization URL' 
        });
    }
});

/**
 * GET /auth/google/callback
 * Google OAuth callback - creates/logs in user
 * Handles both web and mobile flows:
 * - Web: Returns HTML page with token
 * - Mobile: Redirects to exp:// URL with code parameter
 */
router.get('/google/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) {
        return res.status(400).send('Authorization code missing');
    }

    try {
        // Check if this is a mobile request (state contains mobile_redirect)
        let mobileRedirect = null;
        if (state) {
            try {
                const decoded = JSON.parse(Buffer.from(state, 'base64').toString());
                mobileRedirect = decoded.mobile_redirect;
            } catch (e) {
                // Invalid state, treat as web
            }
        }

        // If mobile redirect URL provided, redirect back to app with code
        if (mobileRedirect) {
            const redirectUrl = new URL(mobileRedirect);
            redirectUrl.searchParams.set('code', code);
            return res.redirect(redirectUrl.toString());
        }

        // Otherwise, handle as web flow (exchange code for token and show HTML)
        const oauth2Client = getGoogleOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        
        oauth2Client.setCredentials(tokens);

        // Get user info from Google
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data } = await oauth2.userinfo.get();

        const { id: googleId, email, name, picture } = data;

        // Find or create user
        let user = await User.findOne({ 
            $or: [{ googleId }, { email }] 
        });

        if (user) {
            // Update existing user
            if (!user.googleId) {
                user.googleId = googleId;
            }
            if (name && !user.name) {
                user.name = name;
            }
            if (picture && !user.profilePicture) {
                user.profilePicture = picture;
            }
            user.isVerified = true; // Google accounts are verified
            await user.save();
            
            logger.info(`User logged in via Google: ${email}`);
        } else {
            // Create new user
            user = await User.create({
                email,
                googleId,
                name,
                profilePicture: picture,
                isVerified: true,
                password: undefined // No password for OAuth users
            });
            
            logger.info(`New user created via Google OAuth: ${email}`);
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user._id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        // Send success page with token
        res.send(`
            <html>
                <head>
                    <title>Login Successful</title>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            text-align: center;
                            padding: 50px;
                            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                            color: white;
                        }
                        .container {
                            background: white;
                            color: #333;
                            padding: 40px;
                            border-radius: 10px;
                            max-width: 500px;
                            margin: 0 auto;
                            box-shadow: 0 10px 40px rgba(0,0,0,0.2);
                        }
                        .success-icon {
                            font-size: 64px;
                            margin-bottom: 20px;
                        }
                        .token-container {
                            background: #f5f5f5;
                            padding: 15px;
                            border-radius: 5px;
                            margin: 20px 0;
                            word-break: break-all;
                            font-family: monospace;
                            font-size: 12px;
                        }
                        button {
                            background: #667eea;
                            color: white;
                            border: none;
                            padding: 12px 30px;
                            border-radius: 5px;
                            cursor: pointer;
                            font-size: 16px;
                            margin: 10px;
                        }
                        button:hover {
                            background: #5568d3;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="success-icon">✅</div>
                        <h2>Login Successful!</h2>
                        <p>Welcome, <strong>${user.name || user.email}</strong></p>
                        <p>You have successfully signed in with Google.</p>
                        
                        <div class="token-container">
                            <strong>Your Token:</strong><br>
                            <span id="token">${token}</span>
                        </div>
                        
                        <button onclick="copyToken()">Copy Token</button>
                        <button onclick="window.close()">Close Window</button>
                        
                        <p style="margin-top: 20px; font-size: 14px; color: #666;">
                            Use this token in your app's Authorization header:<br>
                            <code>Bearer ${token.substring(0, 20)}...</code>
                        </p>
                    </div>
                    
                    <script>
                        function copyToken() {
                            const token = document.getElementById('token').textContent;
                            navigator.clipboard.writeText(token).then(() => {
                                alert('Token copied to clipboard!');
                            });
                        }
                        
                        // Post message to parent window (for mobile apps)
                        if (window.opener) {
                            window.opener.postMessage({ token: '${token}' }, '*');
                        }
                    </script>
                </body>
            </html>
        `);
    } catch (error) {
        logger.error('Google OAuth callback error', { error: error.message });
        res.status(500).send(`
            <html>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h2>❌ Login Failed</h2>
                    <p>Error: ${error.message}</p>
                    <p>Please try again.</p>
                    <button onclick="window.close()">Close Window</button>
                </body>
            </html>
        `);
    }
});

/**
 * POST /auth/google/mobile
 * Mobile-friendly endpoint that returns JSON instead of HTML
 */
router.post('/google/mobile', async (req, res) => {
    const { code } = req.body;
    
    if (!code) {
        return res.status(400).json({
            success: false,
            message: 'Authorization code missing'
        });
    }

    try {
        const oauth2Client = getGoogleOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        
        oauth2Client.setCredentials(tokens);

        // Get user info from Google
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data } = await oauth2.userinfo.get();

        const { id: googleId, email, name, picture } = data;

        // Find or create user
        let user = await User.findOne({ 
            $or: [{ googleId }, { email }] 
        });

        if (user) {
            // Update existing user
            if (!user.googleId) {
                user.googleId = googleId;
            }
            if (name && !user.name) {
                user.name = name;
            }
            if (picture && !user.profilePicture) {
                user.profilePicture = picture;
            }
            user.isVerified = true;
            await user.save();
        } else {
            // Create new user
            user = await User.create({
                email,
                googleId,
                name,
                profilePicture: picture,
                isVerified: true
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user._id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                profilePicture: user.profilePicture,
                isVerified: user.isVerified
            }
        });
    } catch (error) {
        logger.error('Google OAuth mobile error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Google authentication failed',
            error: error.message
        });
    }
});

export default router;
