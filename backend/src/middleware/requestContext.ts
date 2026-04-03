import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { logger } from '../utils/logger.js';
import { resolvePolicyActor } from './authorization.js';

const REQUEST_ID_HEADER = 'x-request-id';
type AnyRequest = Request<any, any, any, any>;

interface RequestWithContext extends AnyRequest {
  requestId?: string;
}

const isValidExternalRequestId = (value: string): boolean => {
  return value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9_.:-]+$/.test(value);
};

export const getRequestId = (req: AnyRequest): string => {
  return (req as RequestWithContext).requestId || 'unknown';
};

export const attachRequestContext = (req: Request, res: Response, next: NextFunction): void => {
  const incomingRequestId = req.header(REQUEST_ID_HEADER)?.trim();
  const requestId =
    incomingRequestId && isValidExternalRequestId(incomingRequestId)
      ? incomingRequestId
      : randomUUID();

  (req as RequestWithContext).requestId = requestId;
  res.setHeader(REQUEST_ID_HEADER, requestId);
  next();
};

export const logHttpRequests = (req: Request, res: Response, next: NextFunction): void => {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const endedAt = process.hrtime.bigint();
    const durationMs = Number(endedAt - startedAt) / 1_000_000;
    const actor = resolvePolicyActor(req);

    logger.info('http.request.completed', {
      requestId: getRequestId(req),
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      durationMs: Number(durationMs.toFixed(2)),
      ip: req.ip || req.socket.remoteAddress || 'unknown',
      userAgent: req.get('user-agent') || null,
      actorRole: actor?.role || null,
      actorId: actor?.id || null,
    });
  });

  next();
};
