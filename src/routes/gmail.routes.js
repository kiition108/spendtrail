import express from 'express';
import { gmailPoller } from '../services/gmailPoller.js';
import logger from '../utils/logger.js';

const router = express.Router();

/**
 * GET /gmail/auth-url
 * Get OAuth2 authorization URL
 */
router.get('/auth-url', async (req, res) => {
    try {
        await gmailPoller.initialize();
        const authUrl = gmailPoller.getAuthUrl();
        res.json({ 
            success: true, 
            authUrl,
            message: 'Visit this URL to authorize Gmail access'
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
 * GET /gmail/oauth2callback
 * OAuth2 callback endpoint
 */
router.get('/oauth2callback', async (req, res) => {
    const { code } = req.query;
    
    if (!code) {
        return res.status(400).json({ 
            success: false, 
            message: 'Authorization code missing' 
        });
    }

    try {
        await gmailPoller.initialize();
        await gmailPoller.authorizeWithCode(code);
        res.json({ 
            success: true, 
            message: 'Gmail authorization successful! You can now start the poller.' 
        });
    } catch (error) {
        logger.error('Gmail OAuth callback error', { error: error.message });
        res.status(500).json({ 
            success: false, 
            message: 'Authorization failed',
            error: error.message
        });
    }
});

/**
 * POST /gmail/start
 * Start Gmail polling service
 */
router.post('/start', async (req, res) => {
    try {
        await gmailPoller.start();
        res.json({ 
            success: true, 
            message: 'Gmail poller started successfully' 
        });
    } catch (error) {
        logger.error('Error starting Gmail poller', { error: error.message });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to start Gmail poller',
            error: error.message
        });
    }
});

/**
 * POST /gmail/stop
 * Stop Gmail polling service
 */
router.post('/stop', (req, res) => {
    try {
        gmailPoller.stop();
        res.json({ 
            success: true, 
            message: 'Gmail poller stopped successfully' 
        });
    } catch (error) {
        logger.error('Error stopping Gmail poller', { error: error.message });
        res.status(500).json({ 
            success: false, 
            message: 'Failed to stop Gmail poller' 
        });
    }
});

/**
 * GET /gmail/status
 * Get Gmail poller status
 */
router.get('/status', (req, res) => {
    res.json({
        success: true,
        isPolling: gmailPoller.isPolling,
        processedCount: gmailPoller.processedMessageIds.size,
        authorizedEmail: gmailPoller.authorizedUserEmail
    });
});

/**
 * GET /gmail/test-query
 * Test Gmail query to see what emails are found (Development only)
 */
if (process.env.NODE_ENV !== 'production') {
    router.get('/test-query', async (req, res) => {
        try {
            if (!gmailPoller.gmail) {
                return res.status(400).json({ 
                    success: false, 
                    message: 'Gmail not initialized. Please authorize first.' 
                });
            }

            // Test with simple query
            const simpleQuery = 'is:unread';
            const response = await gmailPoller.gmail.users.messages.list({
                userId: 'me',
                q: simpleQuery,
                maxResults: 5
            });

            const messages = response.data.messages || [];
            const details = [];

            for (const msg of messages) {
                const detail = await gmailPoller.gmail.users.messages.get({
                    userId: 'me',
                    id: msg.id,
                    format: 'metadata',
                    metadataHeaders: ['Subject', 'From', 'To']
                });

                const headers = detail.data.payload.headers;
                details.push({
                    id: msg.id,
                    subject: headers.find(h => h.name === 'Subject')?.value,
                    from: headers.find(h => h.name === 'From')?.value,
                    to: headers.find(h => h.name === 'To')?.value
                });
            }

            res.json({
                success: true,
                totalUnread: messages.length,
                query: simpleQuery,
                authorizedEmail: gmailPoller.authorizedUserEmail,
                messages: details
            });
        } catch (error) {
            logger.error('Test query error', { error: error.message });
            res.status(500).json({ 
                success: false, 
                message: 'Test query failed',
                error: error.message
            });
        }
    });
}

export default router;
