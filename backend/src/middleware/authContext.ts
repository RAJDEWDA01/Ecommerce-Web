import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';

export type AuthActor =
  | {
      role: 'admin';
      id: string;
      email: string;
    }
  | {
      role: 'customer';
      id: string;
      email: string;
    };

export interface AuthContextRequest extends Request {
  auth?: AuthActor;
}

interface AuthJwtPayload extends jwt.JwtPayload {
  role?: 'admin' | 'customer';
  email?: string;
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

const parseActorToken = (token: string, secret: string): AuthActor | null => {
  try {
    const decoded = jwt.verify(token, secret) as AuthJwtPayload;

    if (
      decoded.role === 'admin' &&
      typeof decoded.sub === 'string' &&
      typeof decoded.email === 'string'
    ) {
      return {
        role: 'admin',
        id: decoded.sub,
        email: decoded.email,
      };
    }

    if (
      decoded.role === 'customer' &&
      typeof decoded.sub === 'string' &&
      typeof decoded.email === 'string'
    ) {
      return {
        role: 'customer',
        id: decoded.sub,
        email: decoded.email,
      };
    }

    return null;
  } catch {
    return null;
  }
};

export const attachAuthIfPresent = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    next();
    return;
  }

  const actor = parseActorToken(token, env.jwtSecret);

  if (!actor) {
    res.status(401).json({ success: false, message: 'Unauthorized: invalid or expired token' });
    return;
  }

  const user = await User.findById(actor.id).select('email role');

  if (!user || user.role !== actor.role || user.email !== actor.email) {
    res.status(401).json({ success: false, message: 'Unauthorized: invalid account for token' });
    return;
  }

  (req as AuthContextRequest).auth = actor;
  next();
};
