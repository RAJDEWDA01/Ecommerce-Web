import type { Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';
import { logAuditEvent } from '../utils/audit.js';

interface AdminLoginBody {
  email?: string;
  password?: string;
}

export const adminLogin = async (
  req: Request<unknown, unknown, AdminLoginBody>,
  res: Response
): Promise<void> => {
  try {
    const inputEmail = req.body.email?.trim().toLowerCase();
    const inputPassword = req.body.password;

    if (!inputEmail || !inputPassword) {
      await logAuditEvent(req, {
        action: 'admin.auth.login',
        outcome: 'failure',
        statusCode: 400,
        actor: {
          role: 'anonymous',
          email: inputEmail || null,
        },
        metadata: { reason: 'missing_credentials' },
      });
      res.status(400).json({ success: false, message: 'Email and password are required' });
      return;
    }

    const adminUser = await User.findOne({ email: inputEmail, role: 'admin' }).select('+password');

    if (!adminUser) {
      await logAuditEvent(req, {
        action: 'admin.auth.login',
        outcome: 'failure',
        statusCode: 401,
        actor: {
          role: 'anonymous',
          email: inputEmail,
        },
        metadata: { reason: 'admin_not_found' },
      });
      res.status(401).json({ success: false, message: 'Invalid admin credentials' });
      return;
    }

    const passwordMatches = await bcrypt.compare(inputPassword, adminUser.password);

    if (!passwordMatches) {
      await logAuditEvent(req, {
        action: 'admin.auth.login',
        outcome: 'failure',
        statusCode: 401,
        actor: {
          id: adminUser._id.toString(),
          role: 'admin',
          email: adminUser.email,
        },
        metadata: { reason: 'password_mismatch' },
      });
      res.status(401).json({ success: false, message: 'Invalid admin credentials' });
      return;
    }

    const token = jwt.sign(
      {
        role: 'admin',
        email: adminUser.email,
      },
      env.jwtSecret,
      {
        subject: adminUser._id.toString(),
        expiresIn: '12h',
      }
    );

    await logAuditEvent(req, {
      action: 'admin.auth.login',
      outcome: 'success',
      statusCode: 200,
      actor: {
        id: adminUser._id.toString(),
        role: 'admin',
        email: adminUser.email,
      },
      metadata: {
        adminId: adminUser._id.toString(),
      },
    });

    res.status(200).json({
      success: true,
      message: 'Admin login successful',
      token,
      admin: {
        id: adminUser._id,
        name: adminUser.name,
        email: adminUser.email,
      },
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'admin.auth.login',
      outcome: 'failure',
      statusCode: 500,
      actor: {
        role: 'anonymous',
      },
      metadata: { reason: 'unexpected_error' },
    });
    console.error('Admin login error:', error);
    res.status(500).json({ success: false, message: 'Failed to login as admin' });
  }
};
