import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';

export interface CustomerAuthRequest extends Request {
  customer?: {
    id: string;
    email: string;
    role: 'customer';
  };
}

interface CustomerJwtPayload extends jwt.JwtPayload {
  email: string;
  role: 'customer' | 'admin';
}

const extractBearerToken = (authorizationHeader?: string): string | null => {
  if (!authorizationHeader) {
    return null;
  }

  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return null;
  }

  return token;
};

const parseCustomerToken = (token: string, secret: string): CustomerAuthRequest['customer'] | null => {
  try {
    const decoded = jwt.verify(token, secret) as CustomerJwtPayload;

    if (decoded.role !== 'customer' || typeof decoded.sub !== 'string' || typeof decoded.email !== 'string') {
      return null;
    }

    return {
      id: decoded.sub,
      email: decoded.email,
      role: 'customer',
    };
  } catch {
    return null;
  }
};

export const requireCustomerAuth = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    res.status(401).json({ success: false, message: 'Unauthorized: missing token' });
    return;
  }

  const customer = parseCustomerToken(token, env.jwtSecret);

  if (!customer) {
    res.status(401).json({ success: false, message: 'Unauthorized: invalid or expired token' });
    return;
  }

  (req as CustomerAuthRequest).customer = customer;
  next();
};

export const attachCustomerIfPresent = (req: Request, _res: Response, next: NextFunction): void => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    next();
    return;
  }

  const customer = parseCustomerToken(token, env.jwtSecret);

  if (customer) {
    (req as CustomerAuthRequest).customer = customer;
  }

  next();
};
