import type { Request } from 'express';
import AuditLog, { type AuditActorRole, type AuditOutcome } from '../models/AuditLog.js';
import { resolvePolicyActor } from '../middleware/authorization.js';
import { getRequestId } from '../middleware/requestContext.js';
import { logger } from './logger.js';
type AnyRequest = Request<any, any, any, any>;

interface AuditActorOverride {
  id?: string | null;
  role: AuditActorRole;
  email?: string | null;
}

interface AuditEventInput {
  action: string;
  outcome: AuditOutcome;
  statusCode?: number;
  resourceType?: string;
  resourceId?: string;
  actor?: AuditActorOverride;
  metadata?: Record<string, unknown>;
}

const resolveActorForAudit = (req: AnyRequest, override?: AuditActorOverride) => {
  if (override) {
    return {
      actorId: override.id ?? null,
      actorRole: override.role,
      actorEmail: override.email ?? null,
    };
  }

  const actor = resolvePolicyActor(req);

  if (!actor) {
    return {
      actorId: null,
      actorRole: 'anonymous' as const,
      actorEmail: null,
    };
  }

  return {
    actorId: actor.id,
    actorRole: actor.role,
    actorEmail: actor.email,
  };
};

export const logAuditEvent = async (req: AnyRequest, input: AuditEventInput): Promise<void> => {
  try {
    const actor = resolveActorForAudit(req, input.actor);

    await AuditLog.create({
      action: input.action,
      outcome: input.outcome,
      statusCode: input.statusCode ?? null,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      requestId: getRequestId(req),
      method: req.method,
      path: req.originalUrl || req.url,
      ipAddress: req.ip || req.socket.remoteAddress || null,
      userAgent: req.get('user-agent') || null,
      metadata: input.metadata ?? null,
      ...actor,
    });
  } catch (error) {
    logger.error('audit.log.failed', {
      requestId: getRequestId(req),
      action: input.action,
      error: logger.serializeError(error),
    });
  }
};
