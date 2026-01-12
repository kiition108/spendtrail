import winston from 'winston';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Handle __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logDir = path.join(__dirname, '../../logs');
fs.mkdirSync(logDir, { recursive: true });

// Custom format for better readability
const customFormat = winston.format.printf(({ level, message, timestamp, ...metadata }) => {
  let msg = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  
  // Add metadata if present
  if (Object.keys(metadata).length > 0) {
    msg += ` ${JSON.stringify(metadata)}`;
  }
  
  return msg;
});

// Create base transports
const transports = [
  // Error logs - separate file
  new winston.transports.File({ 
    filename: path.join(logDir, 'error.log'), 
    level: 'error',
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
  // All logs combined
  new winston.transports.File({ 
    filename: path.join(logDir, 'combined.log'),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
  // Gmail-specific logs (filtered to only Gmail-related messages)
  new winston.transports.File({ 
    filename: path.join(logDir, 'gmail.log'),
    level: 'info',
    maxsize: 5242880,
    maxFiles: 3,
    format: winston.format((info) => {
      // Only log messages related to Gmail/Email polling
      const gmailKeywords = ['gmail', 'email', '📧', 'poll', 'oauth', 'token refresh'];
      const message = info.message?.toLowerCase() || '';
      
      // Check if message contains any Gmail-related keywords
      const isGmailLog = gmailKeywords.some(keyword => message.includes(keyword.toLowerCase()));
      
      // Return the log only if it's Gmail-related
      return isGmailLog ? info : false;
    })(),
  }),
];

// Add BetterStack/Logtail transport for production (if configured)
if (process.env.LOGTAIL_TOKEN) {
  try {
    const { Logtail } = await import('@logtail/node');
    const { LogtailTransport } = await import('@logtail/winston');
    
    const logtail = new Logtail(process.env.LOGTAIL_TOKEN);
    transports.push(new LogtailTransport(logtail));
    
    console.log('✅ Logtail logging enabled');
  } catch (err) {
    console.warn('⚠️ Logtail not configured:', err.message);
  }
}

// Console transport for development
if (process.env.NODE_ENV !== 'production') {
  transports.push(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.timestamp({ format: 'HH:mm:ss' }),
      customFormat
    ),
  }));
} else {
  // In production, use JSON format for console (for container logs)
  transports.push(new winston.transports.Console({
    format: winston.format.json(),
  }));
}

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.metadata({ fillExcept: ['message', 'level', 'timestamp'] }),
    winston.format.json()
  ),
  transports,
  // Don't exit on handled exceptions
  exitOnError: false,
});

// Add context to logs
logger.addContext = (context) => {
  return {
    info: (message, meta = {}) => logger.info(message, { ...context, ...meta }),
    warn: (message, meta = {}) => logger.warn(message, { ...context, ...meta }),
    error: (message, meta = {}) => logger.error(message, { ...context, ...meta }),
    debug: (message, meta = {}) => logger.debug(message, { ...context, ...meta }),
  };
};

// Log unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection', {
    reason: reason instanceof Error ? reason.message : reason,
    stack: reason instanceof Error ? reason.stack : undefined,
    promise,
  });
});

// Log uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception', {
    error: error.message,
    stack: error.stack,
  });
  // Give logger time to write
  setTimeout(() => process.exit(1), 1000);
});

export default logger;
