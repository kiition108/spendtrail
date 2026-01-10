import * as Sentry from '@sentry/node';
import logger from './logger.js';

/**
 * Track failed login attempts
 * @param {string} email - Email used in login attempt
 * @param {string} ip - IP address
 * @param {string} userAgent - User agent string
 */
export const trackFailedLogin = (email, ip, userAgent) => {
    logger.warn('Failed login attempt', {
        email,
        ip,
        userAgent,
        timestamp: new Date().toISOString()
    });

    // Track in Sentry for security monitoring
    Sentry.captureMessage('Failed Login Attempt', {
        level: 'warning',
        tags: {
            event_type: 'security',
            action: 'failed_login'
        },
        extra: {
            email,
            ip,
            userAgent
        }
    });
};

/**
 * Track successful login
 * @param {string} userId - User ID
 * @param {string} email - User email
 * @param {string} ip - IP address
 */
export const trackSuccessfulLogin = (userId, email, ip) => {
    logger.info('Successful login', {
        userId,
        email,
        ip,
        timestamp: new Date().toISOString()
    });

    // Set user context in Sentry
    Sentry.setUser({
        id: userId,
        email: email,
        ip_address: ip
    });
};

/**
 * Track user registration
 * @param {string} userId - New user ID
 * @param {string} email - User email
 */
export const trackUserRegistration = (userId, email) => {
    logger.info('User registration', {
        userId,
        email,
        timestamp: new Date().toISOString()
    });

    Sentry.captureMessage('New User Registration', {
        level: 'info',
        tags: {
            event_type: 'user_action',
            action: 'registration'
        },
        extra: {
            userId,
            email
        }
    });
};

/**
 * Track critical business events
 * @param {string} eventName - Name of the event
 * @param {object} data - Event data
 */
export const trackBusinessEvent = (eventName, data) => {
    logger.info(`Business Event: ${eventName}`, data);

    Sentry.captureMessage(eventName, {
        level: 'info',
        tags: {
            event_type: 'business',
            event_name: eventName
        },
        extra: data
    });
};

/**
 * Track database errors
 * @param {Error} error - Database error
 * @param {string} operation - Database operation that failed
 * @param {object} context - Additional context
 */
export const trackDatabaseError = (error, operation, context = {}) => {
    logger.error(`Database Error: ${operation}`, {
        error: error.message,
        stack: error.stack,
        operation,
        ...context
    });

    Sentry.captureException(error, {
        tags: {
            error_type: 'database',
            operation
        },
        extra: context
    });
};

/**
 * Track external API failures
 * @param {string} apiName - Name of the external API
 * @param {Error} error - Error object
 * @param {object} context - Additional context
 */
export const trackExternalAPIError = (apiName, error, context = {}) => {
    logger.error(`External API Error: ${apiName}`, {
        error: error.message,
        stack: error.stack,
        apiName,
        ...context
    });

    Sentry.captureException(error, {
        tags: {
            error_type: 'external_api',
            api_name: apiName
        },
        extra: context
    });
};

/**
 * Track suspicious activity
 * @param {string} activityType - Type of suspicious activity
 * @param {object} details - Details about the activity
 */
export const trackSuspiciousActivity = (activityType, details) => {
    logger.warn(`Suspicious Activity: ${activityType}`, details);

    Sentry.captureMessage(`Suspicious Activity: ${activityType}`, {
        level: 'warning',
        tags: {
            event_type: 'security',
            activity_type: activityType
        },
        extra: details
    });
};

/**
 * Clear user context (on logout)
 */
export const clearUserContext = () => {
    Sentry.setUser(null);
};

export default {
    trackFailedLogin,
    trackSuccessfulLogin,
    trackUserRegistration,
    trackBusinessEvent,
    trackDatabaseError,
    trackExternalAPIError,
    trackSuspiciousActivity,
    clearUserContext
};
