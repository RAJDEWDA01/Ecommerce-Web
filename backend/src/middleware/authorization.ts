import type { NextFunction, Request, Response } from 'express';
import type { AdminAuthRequest } from './adminAuth.js';
import type { AuthActor, AuthContextRequest } from './authContext.js';
import type { CustomerAuthRequest } from './customerAuth.js';

type AppRole = 'admin' | 'customer';
type AnyRequest = Request<any, any, any, any>;

export type Permission =
  | 'catalog:write'
  | 'orders:read:any'
  | 'orders:write:status'
  | 'uploads:write'
  | 'payments:webhooks:read'
  | 'audit:read';

interface PolicyActor {
  id: string;
  role: AppRole;
  email: string;
}

const ROLE_PERMISSIONS: Record<AppRole, ReadonlySet<Permission>> = {
  admin: new Set<Permission>([
    'catalog:write',
    'orders:read:any',
    'orders:write:status',
    'uploads:write',
    'payments:webhooks:read',
    'audit:read',
  ]),
  customer: new Set<Permission>([]),
};

const asAuthActor = (req: AnyRequest): AuthActor | undefined => {
  return (req as AuthContextRequest).auth;
};

const asAdminActor = (req: AnyRequest): AdminAuthRequest['admin'] | undefined => {
  return (req as AdminAuthRequest).admin;
};

const asCustomerActor = (req: AnyRequest): CustomerAuthRequest['customer'] | undefined => {
  return (req as CustomerAuthRequest).customer;
};

export const resolvePolicyActor = (req: AnyRequest): PolicyActor | null => {
  const authActor = asAuthActor(req);

  if (authActor) {
    return authActor;
  }

  const adminActor = asAdminActor(req);

  if (adminActor) {
    return adminActor;
  }

  const customerActor = asCustomerActor(req);

  if (customerActor) {
    return customerActor;
  }

  return null;
};

const hasPermission = (actor: PolicyActor, permission: Permission): boolean => {
  return ROLE_PERMISSIONS[actor.role].has(permission);
};

export const requirePermission = (permission: Permission) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    const actor = resolvePolicyActor(req);

    if (!actor) {
      res.status(401).json({
        success: false,
        message: 'Unauthorized: authentication context is missing',
      });
      return;
    }

    if (!hasPermission(actor, permission)) {
      res.status(403).json({
        success: false,
        message: `Forbidden: missing permission ${permission}`,
      });
      return;
    }

    next();
  };
};
