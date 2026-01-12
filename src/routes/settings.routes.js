import express from 'express';
import { User } from '../models/User.model.js';
import { google } from 'googleapis';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import { auth } from '../middleware/authMiddleware.js';

const router = express.Router();

// Gmail OAuth configuration
const getOAuth2Client = () => {
    const redirectUri = `${process.env.BACKEND_URL || 'https://spendtrail.onrender.com'}/api/v1/settings/gmail/callback`;
    
    return new google.auth.OAuth2(
        process.env.GMAIL_CLIENT_ID,
        process.env.GMAIL_CLIENT_SECRET,
        redirectUri
    );
};

/**
 * GET /settings/gmail/enable
 * Get Gmail authorization URL for current user
 * Requires: Authentication middleware (req.user)
 * Query params:
 *   - mobile_redirect: Optional app redirect URL for mobile (e.g., exp://...)
 */
router.get('/gmail/enable', auth, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
        }

        const { mobile_redirect } = req.query;
        const oauth2Client = getOAuth2Client();
        const state = crypto.randomBytes(32).toString('hex');
        
        // Encode userId and mobile redirect in state
        const stateData = Buffer.from(JSON.stringify({
            userId: req.user.id,
            timestamp: Date.now(),
            mobile_redirect: mobile_redirect || null
        })).toString('base64');

        // Get user's login email to pass as hint
        const user = await User.findById(req.user.id).select('email');

        const SCOPES = ['https://www.googleapis.com/auth/gmail.modify'];
        const authUrl = oauth2Client.generateAuthUrl({
            access_type: 'offline',
            scope: SCOPES,
            prompt: 'consent',
            state: stateData,
            login_hint: user.email  // Suggest the correct Gmail account
        });

        res.json({ 
            success: true, 
            authUrl,
            userEmail: user.email,  // Send to frontend for display
            message: 'Visit this URL to authorize Gmail access for transaction emails'
        });
    } catch (error) {
        logger.error('Error generating Gmail auth URL', { error: error.message });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to generate authorization URL' 
        });
    }
});

/**
 * GET /settings/gmail/callback
 * OAuth callback - exchanges code for tokens and saves to user
 * Handles both web and mobile flows:
 * - Web: Exchanges code for tokens and shows HTML page
 * - Mobile: Redirects to app with code parameter for client-side exchange
 */
router.get('/gmail/callback', async (req, res) => {
    const { code, state } = req.query;
    
    if (!code) {
        return res.status(400).send('Authorization code missing');
    }

    try {
        // Decode state to get userId and mobile redirect
        const stateData = JSON.parse(Buffer.from(state, 'base64').toString());
        const userId = stateData.userId;
        const mobileRedirect = stateData.mobile_redirect;

        // If mobile redirect URL provided, redirect back to app with code
        if (mobileRedirect) {
            const redirectUrl = new URL(mobileRedirect);
            redirectUrl.searchParams.set('code', code);
            redirectUrl.searchParams.set('userId', userId);
            return res.redirect(redirectUrl.toString());
        }

        // Otherwise, handle as web flow (exchange code for token and show HTML)
        const oauth2Client = getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        
        // Get user's Gmail email
        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const authorizedEmail = profile.data.emailAddress;

        // Get user to validate email match
        const user = await User.findById(userId).select('email');
        if (!user) {
            return res.status(404).send(`
                <html>
                    <body style="font-family: Arial; text-align: center; padding: 50px;">
                        <h2>❌ User Not Found</h2>
                        <p>Please try again from the app settings.</p>
                    </body>
                </html>
            `);
        }

        // Validate: Gmail email must match login email
        if (authorizedEmail.toLowerCase() !== user.email.toLowerCase()) {
            logger.warn(`Gmail email mismatch for user ${userId}: login=${user.email}, gmail=${authorizedEmail}`);
            return res.status(400).send(`
                <html>
                    <body style="font-family: Arial; text-align: center; padding: 50px;">
                        <h2>❌ Gmail Account Mismatch</h2>
                        <p>You logged into SpendTrail with: <strong>${user.email}</strong></p>
                        <p>But tried to connect Gmail account: <strong>${authorizedEmail}</strong></p>
                        <p>Please connect the Gmail account that matches your login email.</p>
                        <p>You can close this window and try again.</p>
                    </body>
                </html>
            `);
        }

        // Save tokens to user
        await User.findByIdAndUpdate(userId, {
            'gmailIntegration.enabled': true,
            'gmailIntegration.authorizedEmail': authorizedEmail,
            'gmailIntegration.tokens': {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expiry_date: tokens.expiry_date
            },
            'gmailIntegration.lastSync': new Date()
        });

        logger.info(`Gmail integration enabled for user ${userId}, email: ${authorizedEmail}`);

        res.send(`
            <html>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h2>✅ Gmail Integration Enabled!</h2>
                    <p>Your Gmail account <strong>${authorizedEmail}</strong> has been connected.</p>
                    <p>Transaction emails will now be automatically parsed.</p>
                    <p>You can close this window and return to the app.</p>
                </body>
            </html>
        `);
    } catch (error) {
        logger.error('Gmail OAuth callback error', { error: error.message });
        res.status(500).send(`
            <html>
                <body style="font-family: Arial; text-align: center; padding: 50px;">
                    <h2>❌ Authorization Failed</h2>
                    <p>Error: ${error.message}</p>
                    <p>Please try again from the app settings.</p>
                </body>
            </html>
        `);
    }
});

/**
 * POST /settings/gmail/mobile
 * Mobile-friendly endpoint that accepts code and userId to complete Gmail OAuth
 */
router.post('/gmail/mobile', async (req, res) => {
    const { code, userId } = req.body;
    
    logger.info(`📧 Gmail mobile OAuth request received for userId: ${userId}`);
    
    if (!code || !userId) {
        return res.status(400).json({
            success: false,
            message: 'Authorization code and userId required'
        });
    }

    try {
        // Get user to check their login email
        const user = await User.findById(userId).select('email');
        logger.info(`👤 User found: ${user?.email}`);
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        const oauth2Client = getOAuth2Client();
        const { tokens } = await oauth2Client.getToken(code);
        
        // Get user's Gmail email
        oauth2Client.setCredentials(tokens);
        const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
        const profile = await gmail.users.getProfile({ userId: 'me' });
        const authorizedEmail = profile.data.emailAddress;

        logger.info(`Gmail OAuth: Checking email match - Login: ${user.email}, Gmail: ${authorizedEmail}`);

        // Validate: Gmail email must match login email
        if (authorizedEmail.toLowerCase() !== user.email.toLowerCase()) {
            logger.warn(`Gmail email MISMATCH detected! User ${userId}: login=${user.email}, gmail=${authorizedEmail}`);
            return res.status(400).json({
                success: false,
                message: `Gmail account mismatch. Please connect the Gmail account (${user.email}) you used to log in.`,
                loginEmail: user.email,
                attemptedEmail: authorizedEmail
            });
        }

        logger.info(`Gmail email MATCH confirmed for user ${userId}`);

        // Save tokens to user
        await User.findByIdAndUpdate(userId, {
            'gmailIntegration.enabled': true,
            'gmailIntegration.authorizedEmail': authorizedEmail,
            'gmailIntegration.tokens': {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expiry_date: tokens.expiry_date
            },
            'gmailIntegration.lastSync': new Date()
        });

        logger.info(`Gmail integration enabled for user ${userId}, email: ${authorizedEmail}`);

        res.json({
            success: true,
            enabled: true,
            authorizedEmail,
            message: 'Gmail integration enabled successfully'
        });
    } catch (error) {
        logger.error('Gmail OAuth mobile error', { error: error.message });
        res.status(500).json({
            success: false,
            message: 'Gmail authorization failed',
            error: error.message
        });
    }
});

/**
 * POST /settings/gmail/disable
 * Disable Gmail integration for current user
 */
router.post('/gmail/disable', auth, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
        }

        await User.findByIdAndUpdate(req.user.id, {
            'gmailIntegration.enabled': false,
            'gmailIntegration.tokens': null
        });

        logger.info(`Gmail integration disabled for user ${req.user.id}`);

        res.json({ 
            success: true, 
            message: 'Gmail integration disabled successfully' 
        });
    } catch (error) {
        logger.error('Error disabling Gmail integration', { error: error.message });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to disable Gmail integration' 
        });
    }
});

/**
 * GET /settings/gmail/status
 * Get Gmail integration status for current user
 */
router.get('/gmail/status', auth, async (req, res) => {
    try {
        if (!req.user) {
            return res.status(401).json({ 
                success: false, 
                message: 'Authentication required' 
            });
        }

        const user = await User.findById(req.user.id).select('gmailIntegration');

        res.json({ 
            success: true,
            enabled: user.gmailIntegration?.enabled || false,
            authorizedEmail: user.gmailIntegration?.authorizedEmail || null,
            lastSync: user.gmailIntegration?.lastSync || null
        });
    } catch (error) {
        logger.error('Error fetching Gmail status', { error: error.message });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to fetch Gmail integration status' 
        });
    }
});

export default router;
