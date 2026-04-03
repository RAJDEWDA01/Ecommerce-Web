import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import AdminNotificationDelivery from '../src/models/AdminNotificationDelivery.js';
import User from '../src/models/User.js';

describe('Admin Notification Analytics API', () => {
  it('returns delivery summary, event breakdown, and daily trend', async () => {
    const hashedPassword = await bcrypt.hash('AdminPass123', 10);
    await User.create({
      name: 'Store Admin',
      email: 'admin.notifications.analytics@example.com',
      password: hashedPassword,
      role: 'admin',
      isEmailVerified: true,
    });

    const [first, second, third] = await AdminNotificationDelivery.create([
      {
        eventType: 'order',
        subject: 'Order notification',
        text: 'Order notification body',
        html: '<p>Order notification body</p>',
        recipients: ['ops@example.com'],
        status: 'sent',
        attempts: 1,
        maxAttempts: 5,
        sentAt: new Date('2026-04-02T06:00:00.000Z'),
        lastAttemptAt: new Date('2026-04-02T06:00:00.000Z'),
      },
      {
        eventType: 'payment',
        subject: 'Payment notification',
        text: 'Payment notification body',
        html: '<p>Payment notification body</p>',
        recipients: ['ops@example.com'],
        status: 'failed',
        attempts: 2,
        maxAttempts: 5,
        failureReason: 'SMTP timeout',
        nextRetryAt: new Date('2026-04-04T06:00:00.000Z'),
        lastAttemptAt: new Date('2026-04-03T06:00:00.000Z'),
      },
      {
        eventType: 'support',
        subject: 'Support notification',
        text: 'Support notification body',
        html: '<p>Support notification body</p>',
        recipients: ['ops@example.com'],
        status: 'skipped',
        skipReason: 'no_recipients',
        attempts: 0,
        maxAttempts: 5,
      },
    ]);

    await Promise.all([
      AdminNotificationDelivery.collection.updateOne(
        { _id: first._id },
        {
          $set: {
            createdAt: new Date('2026-04-02T06:00:00.000Z'),
            updatedAt: new Date('2026-04-02T06:00:00.000Z'),
          },
        }
      ),
      AdminNotificationDelivery.collection.updateOne(
        { _id: second._id },
        {
          $set: {
            createdAt: new Date('2026-04-03T06:00:00.000Z'),
            updatedAt: new Date('2026-04-03T06:00:00.000Z'),
          },
        }
      ),
      AdminNotificationDelivery.collection.updateOne(
        { _id: third._id },
        {
          $set: {
            createdAt: new Date('2026-04-03T07:00:00.000Z'),
            updatedAt: new Date('2026-04-03T07:00:00.000Z'),
          },
        }
      ),
    ]);

    const loginResponse = await request(app).post('/api/admin/login').send({
      email: 'admin.notifications.analytics@example.com',
      password: 'AdminPass123',
    });

    expect(loginResponse.status).toBe(200);
    const adminToken = loginResponse.body.token as string;
    expect(adminToken).toBeTruthy();

    const analyticsResponse = await request(app)
      .get('/api/admin/notification-deliveries/analytics?fromDate=2026-04-01&toDate=2026-04-04')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(analyticsResponse.status).toBe(200);
    expect(analyticsResponse.body.success).toBe(true);
    expect(analyticsResponse.body.summary.totalCount).toBe(3);
    expect(analyticsResponse.body.summary.sentCount).toBe(1);
    expect(analyticsResponse.body.summary.failedCount).toBe(1);
    expect(analyticsResponse.body.summary.skippedCount).toBe(1);
    expect(analyticsResponse.body.summary.sentRate).toBeCloseTo(33.33, 2);
    expect(analyticsResponse.body.byEventType).toHaveLength(3);
    expect(analyticsResponse.body.dailyTrend).toEqual([
      {
        date: '2026-04-02',
        totalCount: 1,
        sentCount: 1,
        failedCount: 0,
        retryingCount: 0,
        skippedCount: 0,
      },
      {
        date: '2026-04-03',
        totalCount: 2,
        sentCount: 0,
        failedCount: 1,
        retryingCount: 0,
        skippedCount: 1,
      },
    ]);
  });
});
