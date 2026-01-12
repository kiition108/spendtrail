import express from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { auth } from '../middleware/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();

// Protect these routes - only authenticated users (could add admin check)
router.use(auth);

/**
 * GET /api/v1/logs/recent
 * Get recent logs from combined.log
 */
router.get('/recent', async (req, res) => {
    try {
        const { lines = 100, level, search } = req.query;
        const logPath = path.join(__dirname, '../../logs/combined.log');
        
        if (!fs.existsSync(logPath)) {
            return res.status(404).json({ error: 'Log file not found' });
        }
        
        // Read log file
        const logContent = fs.readFileSync(logPath, 'utf-8');
        let logLines = logContent.split('\n').filter(line => line.trim());
        
        // Parse JSON logs
        const parsedLogs = logLines
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return { message: line, level: 'unknown' };
                }
            })
            .filter(log => {
                // Filter by level if specified
                if (level && log.level !== level) return false;
                
                // Filter by search term if specified
                if (search) {
                    const logString = JSON.stringify(log).toLowerCase();
                    return logString.includes(search.toLowerCase());
                }
                
                return true;
            });
        
        // Get last N lines
        const recentLogs = parsedLogs.slice(-parseInt(lines));
        
        res.json({
            success: true,
            count: recentLogs.length,
            logs: recentLogs.reverse(), // Most recent first
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/v1/logs/errors
 * Get recent error logs
 */
router.get('/errors', async (req, res) => {
    try {
        const { lines = 50 } = req.query;
        const logPath = path.join(__dirname, '../../logs/error.log');
        
        if (!fs.existsSync(logPath)) {
            return res.status(404).json({ error: 'Error log file not found' });
        }
        
        const logContent = fs.readFileSync(logPath, 'utf-8');
        const logLines = logContent.split('\n').filter(line => line.trim());
        
        const parsedLogs = logLines
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return { message: line, level: 'error' };
                }
            })
            .slice(-parseInt(lines));
        
        res.json({
            success: true,
            count: parsedLogs.length,
            errors: parsedLogs.reverse(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/v1/logs/gmail
 * Get Gmail-specific logs for debugging
 */
router.get('/gmail', async (req, res) => {
    try {
        const { lines = 100, userId } = req.query;
        const logPath = path.join(__dirname, '../../logs/gmail.log');
        
        if (!fs.existsSync(logPath)) {
            return res.status(404).json({ error: 'Gmail log file not found' });
        }
        
        const logContent = fs.readFileSync(logPath, 'utf-8');
        let logLines = logContent.split('\n').filter(line => line.trim());
        
        const parsedLogs = logLines
            .map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return { message: line };
                }
            })
            .filter(log => {
                // Filter by userId if specified
                if (userId && log.userId !== userId) return false;
                return true;
            })
            .slice(-parseInt(lines));
        
        res.json({
            success: true,
            count: parsedLogs.length,
            logs: parsedLogs.reverse(),
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /api/v1/logs/stats
 * Get log statistics
 */
router.get('/stats', async (req, res) => {
    try {
        const logPath = path.join(__dirname, '../../logs/combined.log');
        
        if (!fs.existsSync(logPath)) {
            return res.status(404).json({ error: 'Log file not found' });
        }
        
        const logContent = fs.readFileSync(logPath, 'utf-8');
        const logLines = logContent.split('\n').filter(line => line.trim());
        
        const stats = {
            total: logLines.length,
            byLevel: {},
            recentErrors: 0,
            last24Hours: 0,
        };
        
        const last24h = Date.now() - (24 * 60 * 60 * 1000);
        
        logLines.forEach(line => {
            try {
                const log = JSON.parse(line);
                
                // Count by level
                stats.byLevel[log.level] = (stats.byLevel[log.level] || 0) + 1;
                
                // Count recent errors
                if (log.level === 'error') {
                    const logTime = new Date(log.timestamp).getTime();
                    if (logTime > last24h) {
                        stats.recentErrors++;
                    }
                }
                
                // Count last 24 hours
                if (log.timestamp) {
                    const logTime = new Date(log.timestamp).getTime();
                    if (logTime > last24h) {
                        stats.last24Hours++;
                    }
                }
            } catch (e) {
                // Skip malformed logs
            }
        });
        
        res.json({
            success: true,
            stats,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /api/v1/logs/clear
 * Clear old logs (keep last 1000 lines)
 */
router.delete('/clear', async (req, res) => {
    try {
        const logFiles = ['combined.log', 'error.log', 'gmail.log'];
        const logDir = path.join(__dirname, '../../logs');
        
        const results = {};
        
        for (const file of logFiles) {
            const logPath = path.join(logDir, file);
            
            if (fs.existsSync(logPath)) {
                const content = fs.readFileSync(logPath, 'utf-8');
                const lines = content.split('\n').filter(line => line.trim());
                
                // Keep last 1000 lines
                const keptLines = lines.slice(-1000);
                fs.writeFileSync(logPath, keptLines.join('\n') + '\n');
                
                results[file] = {
                    before: lines.length,
                    after: keptLines.length,
                    removed: lines.length - keptLines.length,
                };
            }
        }
        
        res.json({
            success: true,
            message: 'Old logs cleared',
            results,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

export default router;
