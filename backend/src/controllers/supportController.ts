import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import SupportTicket from '../models/SupportTicket.js';
import type { CustomerAuthRequest } from '../middleware/customerAuth.js';
import { logAuditEvent } from '../utils/audit.js';
import {
  getAdminConsoleSupportUrl,
  safeSendAdminNotificationEmail,
} from '../services/adminNotificationService.js';

interface CreateSupportTicketBody {
  name?: string;
  email?: string;
  phone?: string;
  subject?: string;
  message?: string;
}

interface SupportTicketsQuery {
  page?: string;
  limit?: string;
  status?: 'open' | 'in_progress' | 'resolved' | 'closed';
  search?: string;
}

interface UpdateSupportTicketBody {
  status?: 'open' | 'in_progress' | 'resolved' | 'closed';
}

interface AddSupportTicketNoteBody {
  note?: string;
}

const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed'] as const;
const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
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

export const createSupportTicket = async (
  req: Request<unknown, unknown, CreateSupportTicketBody>,
  res: Response
): Promise<void> => {
  try {
    const name = normalizeString(req.body.name);
    const email = normalizeString(req.body.email).toLowerCase();
    const phone = normalizeString(req.body.phone);
    const subject = normalizeString(req.body.subject);
    const message = normalizeString(req.body.message);

    if (!name || !email || !subject || !message) {
      await logAuditEvent(req, {
        action: 'support.ticket.create',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'support_ticket',
        metadata: { reason: 'missing_required_fields' },
      });
      res.status(400).json({
        success: false,
        message: 'name, email, subject, and message are required',
      });
      return;
    }

    if (!isValidEmail(email)) {
      await logAuditEvent(req, {
        action: 'support.ticket.create',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'support_ticket',
        metadata: { reason: 'invalid_email' },
      });
      res.status(400).json({ success: false, message: 'Please provide a valid email address' });
      return;
    }

    if (subject.length > 140) {
      await logAuditEvent(req, {
        action: 'support.ticket.create',
        outcome: 'failure',
        statusCode: 400,
        resourceType: 'support_ticket',
        metadata: { reason: 'subject_too_long' },
      });
      res.status(400).json({ success: false, message: 'Subject must be 140 characters or less' });
      return;
    }

    const authReq = req as CustomerAuthRequest;
    const customerObjectId =
      authReq.customer?.id && mongoose.Types.ObjectId.isValid(authReq.customer.id)
        ? new mongoose.Types.ObjectId(authReq.customer.id)
        : null;

    const ticket = await SupportTicket.create({
      customer: customerObjectId,
      name,
      email,
      phone: phone || null,
      subject,
      message,
      status: 'open',
    });

    const ticketId = ticket._id.toString();
    const adminSupportUrl = getAdminConsoleSupportUrl();
    void safeSendAdminNotificationEmail({
      eventType: 'support',
      subject: `New customer care ticket: ${ticketId}`,
      text: `A new customer care ticket was submitted.\nTicket ID: ${ticketId}\nSubject: ${ticket.subject}\nCustomer: ${ticket.name} (${ticket.email})\nPhone: ${ticket.phone ?? 'n/a'}\nMessage: ${ticket.message}\nStatus: ${ticket.status}\nOpen in admin: ${adminSupportUrl}`,
      html: `
        <p>A new customer care ticket was submitted.</p>
        <p><strong>Ticket ID:</strong> ${ticketId}</p>
        <p><strong>Subject:</strong> ${ticket.subject}</p>
        <p><strong>Customer:</strong> ${ticket.name} (${ticket.email})</p>
        <p><strong>Phone:</strong> ${ticket.phone ?? 'n/a'}</p>
        <p><strong>Message:</strong> ${ticket.message}</p>
        <p><strong>Status:</strong> ${ticket.status}</p>
        <p><a href="${adminSupportUrl}">Open Admin Support</a></p>
      `,
    });

    await logAuditEvent(req, {
      action: 'support.ticket.create',
      outcome: 'success',
      statusCode: 201,
      resourceType: 'support_ticket',
      resourceId: ticket._id.toString(),
      metadata: { subjectLength: subject.length },
    });

    res.status(201).json({
      success: true,
      message: 'Customer care ticket submitted successfully',
      ticket: {
        id: ticket._id,
        status: ticket.status,
        createdAt: ticket.createdAt,
      },
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'support.ticket.create',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'support_ticket',
      metadata: { reason: 'unexpected_error' },
    });
    res.status(500).json({ success: false, message: 'Failed to submit support ticket' });
  }
};

export const getSupportTickets = async (
  req: Request<unknown, unknown, unknown, SupportTicketsQuery>,
  res: Response
): Promise<void> => {
  try {
    const page = parsePositiveInteger(req.query.page, DEFAULT_PAGE);
    const limit = Math.min(parsePositiveInteger(req.query.limit, DEFAULT_LIMIT), MAX_LIMIT);
    const skip = (page - 1) * limit;

    const filters: Record<string, unknown> = {};

    if (req.query.status) {
      if (!TICKET_STATUSES.includes(req.query.status)) {
        res.status(400).json({
          success: false,
          message: `status must be one of: ${TICKET_STATUSES.join(', ')}`,
        });
        return;
      }

      filters.status = req.query.status;
    }

    const search = normalizeString(req.query.search);

    if (search) {
      filters.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { subject: { $regex: search, $options: 'i' } },
      ];
    }

    const [tickets, totalCount] = await Promise.all([
      SupportTicket.find(filters).sort({ createdAt: -1 }).skip(skip).limit(limit),
      SupportTicket.countDocuments(filters),
    ]);

    const totalPages = totalCount === 0 ? 0 : Math.ceil(totalCount / limit);

    res.status(200).json({
      success: true,
      tickets,
      count: tickets.length,
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
    res.status(500).json({ success: false, message: 'Failed to fetch support tickets' });
  }
};

export const updateSupportTicketStatus = async (
  req: Request<{ id: string }, unknown, UpdateSupportTicketBody>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const status = req.body.status;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid ticket id' });
      return;
    }

    if (!status || !TICKET_STATUSES.includes(status)) {
      res.status(400).json({
        success: false,
        message: `status must be one of: ${TICKET_STATUSES.join(', ')}`,
      });
      return;
    }

    const ticket = await SupportTicket.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
        },
      },
      {
        returnDocument: 'after',
      }
    );

    if (!ticket) {
      await logAuditEvent(req, {
        action: 'support.ticket.status.update',
        outcome: 'failure',
        statusCode: 404,
        resourceType: 'support_ticket',
        resourceId: id,
        metadata: { reason: 'ticket_not_found' },
      });
      res.status(404).json({ success: false, message: 'Support ticket not found' });
      return;
    }

    await logAuditEvent(req, {
      action: 'support.ticket.status.update',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'support_ticket',
      resourceId: ticket._id.toString(),
      metadata: { status },
    });

    res.status(200).json({
      success: true,
      message: 'Support ticket status updated',
      ticket,
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'support.ticket.status.update',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'support_ticket',
      resourceId: req.params.id,
      metadata: { reason: 'unexpected_error' },
    });
    res.status(500).json({ success: false, message: 'Failed to update support ticket status' });
  }
};

export const addSupportTicketNote = async (
  req: Request<{ id: string }, unknown, AddSupportTicketNoteBody>,
  res: Response
): Promise<void> => {
  try {
    const { id } = req.params;
    const note = normalizeString(req.body.note);

    if (!mongoose.Types.ObjectId.isValid(id)) {
      res.status(400).json({ success: false, message: 'Invalid ticket id' });
      return;
    }

    if (!note) {
      res.status(400).json({ success: false, message: 'note is required' });
      return;
    }

    if (note.length > MAX_NOTE_LENGTH) {
      res.status(400).json({
        success: false,
        message: `note must be ${MAX_NOTE_LENGTH} characters or less`,
      });
      return;
    }

    const admin = (req as Request & { admin?: { id: string; email: string } }).admin;
    const adminObjectId =
      admin?.id && mongoose.Types.ObjectId.isValid(admin.id)
        ? new mongoose.Types.ObjectId(admin.id)
        : null;

    const ticket = await SupportTicket.findByIdAndUpdate(
      id,
      {
        $push: {
          notes: {
            note,
            authorId: adminObjectId,
            authorEmail: admin?.email ?? null,
            createdAt: new Date(),
          },
        },
      },
      {
        returnDocument: 'after',
      }
    );

    if (!ticket) {
      await logAuditEvent(req, {
        action: 'support.ticket.note.add',
        outcome: 'failure',
        statusCode: 404,
        resourceType: 'support_ticket',
        resourceId: id,
        metadata: { reason: 'ticket_not_found' },
      });
      res.status(404).json({ success: false, message: 'Support ticket not found' });
      return;
    }

    await logAuditEvent(req, {
      action: 'support.ticket.note.add',
      outcome: 'success',
      statusCode: 200,
      resourceType: 'support_ticket',
      resourceId: ticket._id.toString(),
      metadata: { noteLength: note.length },
    });

    res.status(200).json({
      success: true,
      message: 'Support ticket note added',
      ticket,
    });
  } catch (error) {
    await logAuditEvent(req, {
      action: 'support.ticket.note.add',
      outcome: 'failure',
      statusCode: 500,
      resourceType: 'support_ticket',
      resourceId: req.params.id,
      metadata: { reason: 'unexpected_error' },
    });
    res.status(500).json({ success: false, message: 'Failed to add support ticket note' });
  }
};
