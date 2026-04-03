import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import AdminNotificationDelivery from '../src/models/AdminNotificationDelivery.js';
import User from '../src/models/User.js';

describe('Admin Notification Deliveries API', () => {
  it('lists failed deliveries and supports retryable filtering', async () => {
    const hashedPassword = await bcrypt.hash('AdminPass123', 10);
    await User.create({
      name: 'Store Admin',
      email: 'admin.notifications@example.com',
      password: hashedPassword,
      role: 'admin',
      isEmailVerified: true,
    });

    await AdminNotificationDelivery.create([
      {
        eventType: 'order',
        subject: 'Order placed',
        text: 'Order notification',
        html: '<p>Order notification</p>',
        recipients: ['ops@example.com'],
        status: 'failed',
        failureReason: 'SMTP unavailable',
        attempts: 1,
        maxAttempts: 5,
        nextRetryAt: new Date('2026-04-02T12:00:00.000Z'),
        lastAttemptAt: new Date('2026-04-02T11:00:00.000Z'),
      },
      {
        eventType: 'payment',
        subject: 'Payment captured',
        text: 'Payment notification',
        html: '<p>Payment notification</p>',
        recipients: ['ops@example.com'],
        status: 'failed',
        failureReason: 'Max retries exhausted',
        attempts: 5,
        maxAttempts: 5,
        nextRetryAt: null,
        lastAttemptAt: new Date('2026-04-02T10:00:00.000Z'),
      },
      {
        eventType: 'support',
        subject: 'Support ticket',
        text: 'Support notification',
        html: '<p>Support notification</p>',
        recipients: ['ops@example.com'],
        status: 'sent',
        attempts: 1,
        maxAttempts: 5,
        sentAt: new Date('2026-04-02T09:30:00.000Z'),
        lastAttemptAt: new Date('2026-04-02T09:30:00.000Z'),
      },
    ]);

    const loginResponse = await request(app).post('/api/admin/login').send({
      email: 'admin.notifications@example.com',
      password: 'AdminPass123',
    });

    expect(loginResponse.status).toBe(200);
    const adminToken = loginResponse.body.token as string;
    expect(adminToken).toBeTruthy();

    const failedResponse = await request(app)
      .get('/api/admin/notification-deliveries')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(failedResponse.status).toBe(200);
    expect(failedResponse.body.success).toBe(true);
    expect(failedResponse.body.pagination.totalCount).toBe(2);
    expect(failedResponse.body.summary.failedCount).toBe(2);
    expect(failedResponse.body.summary.retryableFailedCount).toBe(1);
    expect(
      (failedResponse.body.deliveries as Array<{ status: string }>).every(
        (delivery) => delivery.status === 'failed'
      )
    ).toBe(true);

    const retryableResponse = await request(app)
      .get('/api/admin/notification-deliveries?retryableOnly=true')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(retryableResponse.status).toBe(200);
    expect(retryableResponse.body.success).toBe(true);
    expect(retryableResponse.body.pagination.totalCount).toBe(1);
    expect(retryableResponse.body.deliveries[0]?.eventType).toBe('order');
    expect(retryableResponse.body.deliveries[0]?.failureReason).toBe('SMTP unavailable');
  });

  it('exposes retry worker health and blocks manual run when worker is inactive', async () => {
    const hashedPassword = await bcrypt.hash('AdminPass123', 10);
    await User.create({
      name: 'Store Admin',
      email: 'admin.notifications.health@example.com',
      password: hashedPassword,
      role: 'admin',
      isEmailVerified: true,
    });

    const loginResponse = await request(app).post('/api/admin/login').send({
      email: 'admin.notifications.health@example.com',
      password: 'AdminPass123',
    });

    expect(loginResponse.status).toBe(200);
    const adminToken = loginResponse.body.token as string;
    expect(adminToken).toBeTruthy();

    const statusResponse = await request(app)
      .get('/api/admin/notification-deliveries/retry/status')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.success).toBe(true);
    expect(statusResponse.body.retry.enabled).toBe(false);

    const runResponse = await request(app)
      .post('/api/admin/notification-deliveries/retry/run')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(runResponse.status).toBe(409);
    expect(runResponse.body.success).toBe(false);
    expect(runResponse.body.message).toContain('not active');
  });

  it('exposes retention worker health and blocks manual run when worker is inactive', async () => {
    const hashedPassword = await bcrypt.hash('AdminPass123', 10);
    await User.create({
      name: 'Store Admin',
      email: 'admin.notifications.retention@example.com',
      password: hashedPassword,
      role: 'admin',
      isEmailVerified: true,
    });

    const loginResponse = await request(app).post('/api/admin/login').send({
      email: 'admin.notifications.retention@example.com',
      password: 'AdminPass123',
    });

    expect(loginResponse.status).toBe(200);
    const adminToken = loginResponse.body.token as string;
    expect(adminToken).toBeTruthy();

    const statusResponse = await request(app)
      .get('/api/admin/notification-deliveries/retention/status')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(statusResponse.status).toBe(200);
    expect(statusResponse.body.success).toBe(true);
    expect(statusResponse.body.retention.enabled).toBe(false);

    const runResponse = await request(app)
      .post('/api/admin/notification-deliveries/retention/run')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(runResponse.status).toBe(409);
    expect(runResponse.body.success).toBe(false);
    expect(runResponse.body.message).toContain('not active');
  });
});
