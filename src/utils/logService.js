import logger from './logger.js';

export const logInfo = (message, req, extra = {}) => {
  logger.info(message, {
    userId: req.user?.id,
    route: req.originalUrl,
    method: req.method,
    ...extra,
  });
};

export const logError = (message, err, req, extra = {}) => {
  logger.error(message, {
    error: err.message,
    stack: err.stack,
    userId: req.user?.id,
    route: req.originalUrl,
    method: req.method,
    ...extra,
  });
};

export const logWarn = (message, req, extra = {}) => {
  logger.warn(message, {
    userId: req.user?.id,
    route: req.originalUrl,
    method: req.method,
    ...extra,
  });
};
