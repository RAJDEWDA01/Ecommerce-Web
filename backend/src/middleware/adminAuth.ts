import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';

export interface AdminAuthRequest extends Request {
  admin?: {
    id: string;
    email: string;
    role: 'admin';
  };
}

interface AdminJwtPayload extends jwt.JwtPayload {
  role: 'admin';
  email: string;
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

export const requireAdminAuth = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  const token = extractBearerToken(req.headers.authorization);

  if (!token) {
    res.status(401).json({ success: false, message: 'Unauthorized: missing token' });
    return;
  }

  try {
    const decoded = jwt.verify(token, env.jwtSecret) as AdminJwtPayload;

    if (decoded.role !== 'admin' || typeof decoded.sub !== 'string' || typeof decoded.email !== 'string') {
      res.status(403).json({ success: false, message: 'Forbidden: admin access required' });
      return;
    }

    const adminUser = await User.findById(decoded.sub).select('email role');

    if (!adminUser || adminUser.role !== 'admin' || adminUser.email !== decoded.email) {
      res.status(403).json({ success: false, message: 'Forbidden: admin access required' });
      return;
    }

    (req as AdminAuthRequest).admin = {
      id: adminUser._id.toString(),
      email: adminUser.email,
      role: 'admin',
    };

    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Unauthorized: invalid or expired token' });
  }
};
