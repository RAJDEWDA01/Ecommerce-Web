import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import Feedback from '../models/Feedback.js';
import type { CustomerAuthRequest } from '../middleware/customerAuth.js';
import { logAuditEvent } from '../utils/audit.js';
import {
  getAdminConsoleFeedbackUrl,
  safeSendAdminNotificationEmail,
} from '../services/adminNotificationService.js';

interface CreateFeedbackBody {
  name?: string;
  email?: string;
  phone?: string;
  rating?: number;
  message?: string;
}

interface FeedbackQuery {
  page?: string;
  limit?: string;
  status?: 'new' | 'reviewed' | 'archived';
  search?: string;
  rating?: string;
}

interface UpdateFeedbackStatusBody {
  status?: 'new' | 'reviewed' | 'archived';
  adminNote?: string | null;
}

const FEEDBACK_STATUSES = ['new', 'reviewed', 'archived'] as const;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_MESSAGE_LENGTH = 3000;
const MAX_NOTE_LENGTH = 2000;

const parsePositiveInteger = (raw: unknown, fallback: number): number => {
  if (raw === undefined || raw === null) {
    return fallback;
  }

  const normalized = String(raw).trim();

  if (!normalized) {
    return fallback;
  }

  const parsed = Number(normalized);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const normalizeString = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

export const createFeedback = async (
  req: Request<unknown, unknown, CreateFeedbackBody>,
  res: Response
): Promise<void> => {
  try {
    const name = normalizeString(req.body.name);
    const email = normalizeString(req.body.email).toLowerCase();
    const phone = normalizeString(req.body.phone);
    const message = normalizeString(req.body.message);
    const rating = Number(req.body.rating);

    if (!name || !email || !message) {
      await logAuditEvent(req, {
        action: 'feedback.create',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'feedback',
        metadata: { reason: 'missing_required_fields' },
      });
      res.status(400).json({
        success: false,
        message: 'name, email, and message are required',
      });
      return;
    }

    if (!isValidEmail(email)) {
      await logAuditEvent(req, {
        action: 'feedback.create',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'feedback',
        metadata: { reason: 'invalid_email' },
      });
      res.status(400).json({ success: false, message: 'Please provide a valid email address' });
      return;
    }

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      await logAuditEvent(req, {
        action: 'feedback.create',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'feedback',
        metadata: { reason: 'invalid_rating' },
      });
      res.status(400).json({ success: false, message: 'rating must be an integer between 1 and 5' });
      return;
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      await logAuditEvent(req, {
        action: 'feedback.create',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'feedback',
        metadata: { reason: 'message_too_long' },
      });
      res.status(400).json({
        success: false,
        message: `message must be ${MAX_MESSAGE_LENGTH} characters or less`,
      });
      return;
    }

    const authReq = req as CustomerAuthRequest;
    const customerObjectId =
      authReq.customer?.id && mongoose.Types.ObjectId.isValid(authReq.customer.id)
        ? new mongoose.Types.ObjectId(authReq.customer.id)
        : null;

    const feedback = await Feedback.create({
      customer: customerObjectId,
      name,
      email,
      phone: phone || null,
      rating,
      message,
      status: 'new',
    });

    const feedbackId = feedback._id.toString();
    const adminFeedbackUrl = getAdminConsoleFeedbackUrl();
    void safeSendAdminNotificationEmail({
      eventType: 'feedback',
      subject: `New customer feedback: ${feedbackId}`,
      text: `A new feedback entry was submitted.\nFeedback ID: ${feedbackId}\nCustomer: ${feedback.name} (${feedback.email})\nPhone: ${feedback.phone ?? 'n/a'}\nRating: ${feedback.rating}/5\nMessage: ${feedback.message}\nOpen in admin: ${adminFeedbackUrl}`,
      html: `
        <p>A new feedback entry was submitted.</p>
        <p><strong>Feedback ID:</strong> ${feedbackId}</p>
        <p><strong>Customer:</strong> ${feedback.name} (${feedback.email})</p>
        <p><strong>Phone:</strong> ${feedback.phone ?? 'n/a'}</p>
        <p><strong>Rating:</strong> ${feedback.rating}/5</p>
        <p><strong>Message:</strong> ${feedback.message}</p>
        <p><a href="${adminFeedbackUrl}">Open Admin Feedback</a></p>
      `,
    });

    await logAuditEvent(req, {
      action: 'feedback.create',
      outcome: 'success',
      statusCode: 201,
      resourceType: 'feedback',
      resourceId: feedback._id.toString(),
      metadata: { rating: feedback.rating },
    });

    res.status(201).json({
      success: true,
      message: 'Feedback submitted successfully',
      feedback: {
        id: feedback._id,
        status: feedback.status,
        createdAt: feedback.createdAt,
      },
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'feedback.create',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'feedback',
      metadata: { reason: 'unexpected_error' },
    });
    res.status(500).json({ success: false, message: 'Failed to submit feedback' });
  }
};

export const getFeedback = async (
  req: Request<unknown, unknown, unknown, FeedbackQuery>,
  res: Response
): Promise<void> => {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInteger(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const filters: Record<string, unknown> = {};

    if (req.query.status) {
      if (!FEEDBACK_STATUSES.includes(req.query.status)) {
        res.status(400).json({
          success: false,
          message: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`,
        });
        return;
      }

      filters.status = req.query.status;
    }

    if (req.query.rating !== undefined) {
      const rating = Number(req.query.rating);

      if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
        res.status(400).json({
          success: false,
          message: 'rating filter must be an integer between 1 and 5',
        });
        return;
      }

      filters.rating = rating;
    }

    const search = normalizeString(req.query.search);

    if (search) {
      filters.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { message: { $regex: search, $options: 'i' } },
      ];
    }

    const [feedback, totalCount] = await Promise.all([
      Feedback.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      Feedback.countDocuments(filters),
    ]);

    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      feedback,
      count: feedback.length,
      totalCount,
      pagination: {
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPreviousPage: page > 1 && totalPages > 0,
      },
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch feedback' });
  }
};

export const updateFeedbackStatus = async (
  req: Request<{ id: string }, unknown, UpdateFeedbackStatusBody>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const status = req.body.status;
    const adminNoteRaw = req.body.adminNote;
    const adminNote = adminNoteRaw === null ? null : normalizeString(adminNoteRaw);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid feedback id' });
      return;
    }

    if (!status || !FEEDBACK_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `status must be one of: ${FEEDBACK_STATUSES.join(', ')}`,
      });
      return;
    }

    if (adminNote && adminNote.length > MAX_NOTE_LENGTH) {
      res.status(400).json({
        success: false,
        message: `adminNote must be ${MAX_NOTE_LENGTH} characters or less`,
      });
      return;
    }

    const admin = (req as Request & { admin?: { id: string; email: string } }).admin;
    const reviewedBy =
      admin?.id && mongoose.Types.ObjectId.isValid(admin.id)
        ? new mongoose.Types.ObjectId(admin.id)
        : null;

    const feedback = await Feedback.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          adminNote: adminNote || null,
          reviewedAt: status === 'new' ? null : new Date(),
          reviewedBy: status === 'new' ? null : reviewedBy,
        },
      },
      {
        returnDocument: 'after',
      }
    );

    if (!feedback) {
      await logAuditEvent(req, {
        action: 'feedback.status.update',
        outcome: 'failure',
        statusCode: 404,
        resourceType: 'feedback',
        resourceId: id,
        metadata: { reason: 'feedback_not_found' },
      });
      res.status(404).json({ success: false, message: 'Feedback not found' });
      return;
    }

    await logAuditEvent(req, {
      action: 'feedback.status.update',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'feedback',
      resourceId: feedback._id.toString(),
      metadata: { status },
    });

    res.status(200).json({
      success: true,
      message: 'Feedback status updated',
      feedback,
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'feedback.status.update',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'feedback',
      resourceId: req.params.id,
      metadata: { reason: 'unexpected_error' },
    });
    res.status(500).json({ success: false, message: 'Failed to update feedback status' });
  }
};
