import type { Request, Response } from 'express';
import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import env from '../config/env.js';
import User from '../models/User.js';
import AuthToken, { type AuthTokenType } from '../models/AuthToken.js';
import RefreshToken from '../models/RefreshToken.js';
import type { CustomerAuthRequest } from '../middleware/customerAuth.js';
import { sendEmail } from '../utils/email.js';

interface RegisterBody {
  name?: string;
  email?: string;
  password?: string;
}

interface LoginBody {
  email?: string;
  password?: string;
}

interface VerifyEmailBody {
  token?: string;
}

interface ForgotPasswordBody {
  email?: string;
}

interface ResetPasswordBody {
  token?: string;
  password?: string;
}

interface UpdateProfileBody {
  name?: string;
  phone?: string | null;
}

const REFRESH_COOKIE_NAME = 'gaumaya_refresh_token';
const ACCESS_TOKEN_EXPIRES_IN: NonNullable<jwt.SignOptions['expiresIn']> = (
  process.env.ACCESS_TOKEN_EXPIRES_IN?.trim() || '15m'
) as NonNullable<jwt.SignOptions['expiresIn']>;

const parseRefreshTokenExpiryDays = (): number => {
  const raw = process.env.REFRESH_TOKEN_EXPIRES_DAYS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 180) {
    return 30;
  }

  return parsed;
};

const parseEmailVerificationExpiryHours = (): number => {
  const raw = process.env.EMAIL_VERIFICATION_EXPIRES_HOURS?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 168) {
    return 24;
  }

  return parsed;
};

const parsePasswordResetExpiryMinutes = (): number => {
  const raw = process.env.PASSWORD_RESET_EXPIRES_MINUTES?.trim();
  const parsed = raw ? Number(raw) : Number.NaN;

  if (!Number.isInteger(parsed) || parsed < 5 || parsed > 240) {
    return 30;
  }

  return parsed;
};

const REFRESH_TOKEN_EXPIRES_DAYS = parseRefreshTokenExpiryDays();
const EMAIL_VERIFICATION_EXPIRES_HOURS = parseEmailVerificationExpiryHours();
const PASSWORD_RESET_EXPIRES_MINUTES = parsePasswordResetExpiryMinutes();
const FRONTEND_URL = env.frontendUrl;
const isProduction = env.isProduction;

const normalizeEmail = (value: string): string => value.trim().toLowerCase();

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isValidPhone = (phone: string): boolean => /^[0-9+\-()\s]{7,20}$/.test(phone);

const serializeCustomerUser = (user: {
  _id: unknown;
  name: string;
  email: string;
  phone?: string | null;
  role: string;
  isEmailVerified: boolean;
}) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  phone: user.phone ?? null,
  role: user.role,
  isEmailVerified: user.isEmailVerified,
});

const createCustomerToken = (userId: string, email: string): string => {
  return jwt.sign(
    {
      email,
      role: 'customer',
    },
    env.jwtSecret,
    {
      subject: userId,
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
    }
  );
};

const hashRefreshToken = (refreshToken: string): string =>
  createHash('sha256').update(refreshToken).digest('hex');

const hashActionToken = (token: string): string => createHash('sha256').update(token).digest('hex');

const getRefreshExpiryDate = (): Date => {
  return new Date(Date.now() + REFRESH_TOKEN_EXPIRES_DAYS * 24 * 60 * 60 * 1000);
};

const setRefreshCookie = (res: Response, refreshToken: string, expiresAt: Date): void => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/auth',
    expires: expiresAt,
  });
};

const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    path: '/api/auth',
  });
};

const getRefreshCookieValue = (req: Request): string | null => {
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  const rawCookie = cookies?.[REFRESH_COOKIE_NAME];

  if (!rawCookie || typeof rawCookie !== 'string') {
    return null;
  }

  return rawCookie;
};

const issueRefreshTokenForUser = async (userId: string): Promise<{ refreshToken: string; expiresAt: Date }> => {
  const refreshToken = randomBytes(48).toString('hex');
  const expiresAt = getRefreshExpiryDate();

  await RefreshToken.create({
    user: userId,
    tokenHash: hashRefreshToken(refreshToken),
    expiresAt,
  });

  return { refreshToken, expiresAt };
};

const issueActionTokenForUser = async (
  userId: string,
  type: AuthTokenType,
  expiresAt: Date
): Promise<string> => {
  const rawToken = randomBytes(48).toString('hex');

  await AuthToken.updateMany(
    {
      user: userId,
      type,
      usedAt: null,
      expiresAt: { $gt: new Date() },
    },
    {
      $set: {
        usedAt: new Date(),
      },
    }
  );

  await AuthToken.create({
    user: userId,
    tokenHash: hashActionToken(rawToken),
    type,
    expiresAt,
  });

  return rawToken;
};

const consumeActionToken = async (type: AuthTokenType, rawToken: string) => {
  const record = await AuthToken.findOne({
    tokenHash: hashActionToken(rawToken),
    type,
    usedAt: null,
    expiresAt: { $gt: new Date() },
  });

  if (!record) {
    return null;
  }

  record.usedAt = new Date();
  await record.save();
  return record;
};

const buildCustomerLink = (path: string, token: string): string => {
  const encodedToken = encodeURIComponent(token);
  return `${FRONTEND_URL}${path}?token=${encodedToken}`;
};

const sendVerificationEmail = async (
  name: string,
  email: string,
  verificationToken: string
): Promise<boolean> => {
  const verifyLink = buildCustomerLink('/account/verify-email', verificationToken);

  return sendEmail({
    to: email,
    subject: 'Verify your Gaumaya account email',
    text: `Hi ${name}, verify your email by opening this link: ${verifyLink}`,
    html: `
      <p>Hi ${name},</p>
      <p>Please verify your email address for your Gaumaya account.</p>
      <p><a href="${verifyLink}">Verify Email</a></p>
      <p>If you did not create this account, you can ignore this email.</p>
    `,
  });
};

const sendPasswordResetEmail = async (
  name: string,
  email: string,
  resetToken: string
): Promise<boolean> => {
  const resetLink = buildCustomerLink('/account/reset-password', resetToken);

  return sendEmail({
    to: email,
    subject: 'Reset your Gaumaya account password',
    text: `Hi ${name}, reset your password with this link: ${resetLink}`,
    html: `
      <p>Hi ${name},</p>
      <p>We received a request to reset your account password.</p>
      <p><a href="${resetLink}">Reset Password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
    `,
  });
};

const safeSendVerificationEmail = async (
  name: string,
  email: string,
  verificationToken: string
): Promise<boolean> => {
  try {
    return await sendVerificationEmail(name, email, verificationToken);
  } catch (error) {
    console.error('Failed to send verification email:', error);
    return false;
  }
};

const safeSendPasswordResetEmail = async (
  name: string,
  email: string,
  resetToken: string
): Promise<boolean> => {
  try {
    return await sendPasswordResetEmail(name, email, resetToken);
  } catch (error) {
    console.error('Failed to send password reset email:', error);
    return false;
  }
};

const getDebugTokenField = (key: string, token: string): Record<string, string> => {
  if (isProduction) {
    return {};
  }

  return {
    [key]: token,
  };
};

export const registerCustomer = async (
  req: Request<unknown, unknown, RegisterBody>,
  res: Response
): Promise<void> => {
  try {
    const name = req.body.name?.trim() ?? '';
    const emailInput = req.body.email?.trim() ?? '';
    const password = req.body.password ?? '';

    if (!name || !emailInput || !password) {
      res.status(400).json({ success: false, message: 'Name, email, and password are required' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ success: false, message: 'Password must be at least 6 characters' });
      return;
    }

    const email = normalizeEmail(emailInput);

    if (!isValidEmail(email)) {
      res.status(400).json({ success: false, message: 'Please enter a valid email address' });
      return;
    }

    const existing = await User.findOne({ email });

    if (existing) {
      res.status(409).json({ success: false, message: 'An account already exists with this email' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      role: 'customer',
      isEmailVerified: false,
    });

    const token = createCustomerToken(user._id.toString(), user.email);
    const { refreshToken, expiresAt } = await issueRefreshTokenForUser(user._id.toString());
    setRefreshCookie(res, refreshToken, expiresAt);

    const verificationToken = await issueActionTokenForUser(
      user._id.toString(),
      'email_verification',
      new Date(Date.now() + EMAIL_VERIFICATION_EXPIRES_HOURS * 60 * 60 * 1000)
    );
    const emailSent = await safeSendVerificationEmail(user.name, user.email, verificationToken);

    res.status(201).json({
      success: true,
      message: emailSent
        ? 'Account created. Please verify your email.'
        : 'Account created. Verification email service is unavailable right now.',
      token,
      user: serializeCustomerUser(user),
      ...getDebugTokenField('debugEmailVerificationToken', verificationToken),
    });
  } catch (error) {
    console.error('Register customer error:', error);
    res.status(500).json({ success: false, message: 'Failed to create account' });
  }
};

export const loginCustomer = async (
  req: Request<unknown, unknown, LoginBody>,
  res: Response
): Promise<void> => {
  try {
    const emailInput = req.body.email?.trim() ?? '';
    const password = req.body.password ?? '';

    if (!emailInput || !password) {
      res.status(400).json({ success: false, message: 'Email and password are required' });
      return;
    }

    const email = normalizeEmail(emailInput);

    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      res.status(401).json({ success: false, message: 'Invalid email or password' });
      return;
    }

    const token = createCustomerToken(user._id.toString(), user.email);
    const { refreshToken, expiresAt } = await issueRefreshTokenForUser(user._id.toString());
    setRefreshCookie(res, refreshToken, expiresAt);

    res.status(200).json({
      success: true,
      message: 'Login successful',
      token,
      user: serializeCustomerUser(user),
    });
  } catch (error) {
    console.error('Login customer error:', error);
    res.status(500).json({ success: false, message: 'Failed to login' });
  }
};

export const refreshCustomerSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshTokenValue = getRefreshCookieValue(req);

    if (!refreshTokenValue) {
      res.status(401).json({ success: false, message: 'Refresh token missing' });
      return;
    }

    const existingToken = await RefreshToken.findOne({
      tokenHash: hashRefreshToken(refreshTokenValue),
    });

    if (!existingToken) {
      clearRefreshCookie(res);
      res.status(401).json({ success: false, message: 'Invalid refresh token' });
      return;
    }

    if (existingToken.revokedAt || existingToken.expiresAt.getTime() <= Date.now()) {
      existingToken.revokedAt = existingToken.revokedAt ?? new Date();
      await existingToken.save();
      clearRefreshCookie(res);
      res.status(401).json({ success: false, message: 'Refresh token expired or revoked' });
      return;
    }

    const user = await User.findById(existingToken.user);

    if (!user) {
      existingToken.revokedAt = new Date();
      await existingToken.save();
      clearRefreshCookie(res);
      res.status(401).json({ success: false, message: 'User not found for session' });
      return;
    }

    existingToken.revokedAt = new Date();
    await existingToken.save();

    const { refreshToken, expiresAt } = await issueRefreshTokenForUser(user._id.toString());
    setRefreshCookie(res, refreshToken, expiresAt);

    const token = createCustomerToken(user._id.toString(), user.email);

    res.status(200).json({
      success: true,
      message: 'Session refreshed successfully',
      token,
      user: serializeCustomerUser(user),
    });
  } catch (error) {
    console.error('Refresh customer session error:', error);
    clearRefreshCookie(res);
    res.status(500).json({ success: false, message: 'Failed to refresh session' });
  }
};

export const logoutCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const refreshTokenValue = getRefreshCookieValue(req);

    if (refreshTokenValue) {
      await RefreshToken.findOneAndUpdate(
        {
          tokenHash: hashRefreshToken(refreshTokenValue),
          revokedAt: null,
        },
        {
          $set: {
            revokedAt: new Date(),
          },
        }
      );
    }

    clearRefreshCookie(res);
    res.status(200).json({ success: true, message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout customer error:', error);
    clearRefreshCookie(res);
    res.status(500).json({ success: false, message: 'Failed to logout' });
  }
};

export const resendCustomerVerificationEmail = async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as CustomerAuthRequest;
    const customerId = authReq.customer?.id;

    if (!customerId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const user = await User.findById(customerId);

    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'Customer account not found' });
      return;
    }

    if (user.isEmailVerified) {
      res.status(200).json({ success: true, message: 'Email is already verified' });
      return;
    }

    const verificationToken = await issueActionTokenForUser(
      user._id.toString(),
      'email_verification',
      new Date(Date.now() + EMAIL_VERIFICATION_EXPIRES_HOURS * 60 * 60 * 1000)
    );
    const emailSent = await safeSendVerificationEmail(user.name, user.email, verificationToken);

    res.status(200).json({
      success: true,
      message: emailSent
        ? 'Verification email sent successfully'
        : 'Verification token generated but email service is currently unavailable',
      ...getDebugTokenField('debugEmailVerificationToken', verificationToken),
    });
  } catch (error) {
    console.error('Resend verification email error:', error);
    res.status(500).json({ success: false, message: 'Failed to resend verification email' });
  }
};

export const verifyCustomerEmail = async (
  req: Request<unknown, unknown, VerifyEmailBody>,
  res: Response
): Promise<void> => {
  try {
    const token = req.body.token?.trim() ?? '';

    if (!token) {
      res.status(400).json({ success: false, message: 'Verification token is required' });
      return;
    }

    const verificationRecord = await consumeActionToken('email_verification', token);

    if (!verificationRecord) {
      res.status(400).json({ success: false, message: 'Invalid or expired verification token' });
      return;
    }

    const user = await User.findById(verificationRecord.user);

    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'Customer account not found' });
      return;
    }

    user.isEmailVerified = true;
    await user.save();

    await AuthToken.updateMany(
      { user: user._id, type: 'email_verification', usedAt: null },
      { $set: { usedAt: new Date() } }
    );

    res.status(200).json({
      success: true,
      message: 'Email verified successfully',
      user: serializeCustomerUser(user),
    });
  } catch (error) {
    console.error('Verify customer email error:', error);
    res.status(500).json({ success: false, message: 'Failed to verify email' });
  }
};

export const forgotCustomerPassword = async (
  req: Request<unknown, unknown, ForgotPasswordBody>,
  res: Response
): Promise<void> => {
  try {
    const genericMessage = 'If an account exists with this email, password reset instructions have been sent.';
    const emailInput = req.body.email?.trim() ?? '';
    const email = normalizeEmail(emailInput);

    if (!email || !isValidEmail(email)) {
      res.status(200).json({ success: true, message: genericMessage });
      return;
    }

    const user = await User.findOne({ email, role: 'customer' });

    if (!user) {
      res.status(200).json({ success: true, message: genericMessage });
      return;
    }

    const resetToken = await issueActionTokenForUser(
      user._id.toString(),
      'password_reset',
      new Date(Date.now() + PASSWORD_RESET_EXPIRES_MINUTES * 60 * 1000)
    );
    const emailSent = await safeSendPasswordResetEmail(user.name, user.email, resetToken);

    res.status(200).json({
      success: true,
      message: emailSent
        ? genericMessage
        : 'Reset token generated. Email service is currently unavailable.',
      ...getDebugTokenField('debugPasswordResetToken', resetToken),
    });
  } catch (error) {
    console.error('Forgot customer password error:', error);
    res.status(500).json({ success: false, message: 'Failed to process password reset request' });
  }
};

export const resetCustomerPassword = async (
  req: Request<unknown, unknown, ResetPasswordBody>,
  res: Response
): Promise<void> => {
  try {
    const token = req.body.token?.trim() ?? '';
    const newPassword = req.body.password ?? '';

    if (!token) {
      res.status(400).json({ success: false, message: 'Reset token is required' });
      return;
    }

    if (newPassword.length < 8) {
      res.status(400).json({ success: false, message: 'Password must be at least 8 characters' });
      return;
    }

    const resetRecord = await consumeActionToken('password_reset', token);

    if (!resetRecord) {
      res.status(400).json({ success: false, message: 'Invalid or expired reset token' });
      return;
    }

    const user = await User.findById(resetRecord.user).select('+password');

    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'Customer account not found' });
      return;
    }

    user.password = await bcrypt.hash(newPassword, 10);
    await user.save();

    await RefreshToken.updateMany(
      {
        user: user._id,
        revokedAt: null,
      },
      {
        $set: {
          revokedAt: new Date(),
        },
      }
    );

    await AuthToken.updateMany(
      {
        user: user._id,
        type: 'password_reset',
        usedAt: null,
      },
      {
        $set: {
          usedAt: new Date(),
        },
      }
    );

    clearRefreshCookie(res);

    res.status(200).json({
      success: true,
      message: 'Password reset successful. Please sign in again.',
    });
  } catch (error) {
    console.error('Reset customer password error:', error);
    res.status(500).json({ success: false, message: 'Failed to reset password' });
  }
};

export const getCurrentCustomer = async (req: Request, res: Response): Promise<void> => {
  try {
    const authReq = req as CustomerAuthRequest;

    if (!authReq.customer?.id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const user = await User.findById(authReq.customer.id);

    if (!user) {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    res.status(200).json({
      success: true,
      user: serializeCustomerUser(user),
    });
  } catch (error) {
    console.error('Get current customer error:', error);
    res.status(500).json({ success: false, message: 'Failed to fetch profile' });
  }
};

export const updateCurrentCustomerProfile = async (
  req: Request<unknown, unknown, UpdateProfileBody>,
  res: Response
): Promise<void> => {
  try {
    const authReq = req as CustomerAuthRequest;

    if (!authReq.customer?.id) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const user = await User.findById(authReq.customer.id);

    if (!user || user.role !== 'customer') {
      res.status(404).json({ success: false, message: 'User not found' });
      return;
    }

    const nextName = req.body.name?.trim();

    if (nextName !== undefined) {
      if (!nextName) {
        res.status(400).json({ success: false, message: 'Name cannot be empty' });
        return;
      }

      if (nextName.length > 80) {
        res.status(400).json({ success: false, message: 'Name must be 80 characters or less' });
        return;
      }

      user.name = nextName;
    }

    if (req.body.phone !== undefined) {
      const rawPhone = req.body.phone;

      if (rawPhone === null) {
        user.phone = null;
      } else if (typeof rawPhone === 'string') {
        const trimmedPhone = rawPhone.trim();

        if (trimmedPhone && !isValidPhone(trimmedPhone)) {
          res.status(400).json({ success: false, message: 'Please enter a valid phone number' });
          return;
        }

        user.phone = trimmedPhone || null;
      } else {
        res.status(400).json({ success: false, message: 'phone must be a string or null' });
        return;
      }
    }

    await user.save();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: serializeCustomerUser(user),
    });
  } catch (error) {
    console.error('Update current customer profile error:', error);
    res.status(500).json({ success: false, message: 'Failed to update profile' });
  }
};
