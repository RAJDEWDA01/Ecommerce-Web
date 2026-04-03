import type { ErrorRequestHandler, Request, Response } from 'express';
import { getRequestId } from './requestContext.js';
import { logger } from '../utils/logger.js';

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    message: `Route not found: ${req.method} ${req.originalUrl || req.url}`,
    requestId: getRequestId(req),
  });
};

export const errorHandler: ErrorRequestHandler = (error, req, res, _next): void => {
  logger.error('http.request.unhandled_error', {
    requestId: getRequestId(req),
    method: req.method,
    path: req.originalUrl || req.url,
    error: logger.serializeError(error),
  });

  if (res.headersSent) {
    return;
  }

  res.status(500).json({
    success: false,
    message: 'Internal server error',
    requestId: getRequestId(req),
  });
};
