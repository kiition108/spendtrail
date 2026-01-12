import logger from '../utils/logger.js';
import { v4 as uuidv4 } from 'uuid';

/**
 * Request logging middleware with correlation IDs
 * Tracks every request with unique ID for tracing through logs
 */
export const requestLogger = (req, res, next) => {
    // Generate unique request ID
    const requestId = uuidv4();
    req.requestId = requestId;
    
    // Store start time
    const startTime = Date.now();
    
    // Create contextual logger for this request (but don't log every request)
    req.logger = logger.addContext({
        requestId,
        method: req.method,
        path: req.path,
        ip: req.ip || req.connection.remoteAddress,
        userAgent: req.get('user-agent'),
        userId: req.user?.id || req.user?._id || 'anonymous'
    });
    
    // Don't log routine requests - only errors will be logged via errorLogger
    
    // Capture response for error logging only
    const originalSend = res.send;
    res.send = function(data) {
        res.send = originalSend;
        
        const duration = Date.now() - startTime;
        const statusCode = res.statusCode;
        
        // Only log errors and warnings, not successful requests
        if (statusCode >= 400) {
            const logLevel = statusCode >= 500 ? 'error' : 'warn';
            req.logger[logLevel]('Request failed', {
                statusCode,
                duration: `${duration}ms`,
            });
        }
        
        return res.send(data);
    };
    
    next();
};

/**
 * Sanitize request body to remove sensitive data from logs
 */
function sanitizeBody(body) {
    if (!body || typeof body !== 'object') return body;
    
    const sanitized = { ...body };
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'refreshToken', 'accessToken'];
    
    for (const field of sensitiveFields) {
        if (sanitized[field]) {
            sanitized[field] = '***REDACTED***';
        }
    }
    
    return sanitized;
}

/**
 * Error logging middleware
 */
export const errorLogger = (err, req, res, next) => {
    const logger = req.logger || logger;
    
    logger.error('Request error', {
        error: err.message,
        stack: err.stack,
        statusCode: err.statusCode || 500,
        requestId: req.requestId,
    });
    
    next(err);
};
