import { describe, expect, it } from 'vitest';
import AdminNotificationDelivery from '../src/models/AdminNotificationDelivery.js';
import { pruneAdminNotificationDeliveries } from '../src/services/adminNotificationRetention.js';

describe('Admin Notification Retention Service', () => {
  it('prunes notification deliveries older than configured retention window', async () => {
    const oldDelivery = await AdminNotificationDelivery.create({
      eventType: 'order',
      subject: 'Old notification',
      text: 'Old notification body',
      html: '<p>Old notification body</p>',
      recipients: ['ops@example.com'],
      status: 'sent',
      attempts: 1,
      maxAttempts: 5,
      sentAt: new Date('2025-01-01T00:00:00.000Z'),
      lastAttemptAt: new Date('2025-01-01T00:00:00.000Z'),
    });

    await AdminNotificationDelivery.create({
      eventType: 'support',
      subject: 'Recent notification',
      text: 'Recent notification body',
      html: '<p>Recent notification body</p>',
      recipients: ['ops@example.com'],
      status: 'failed',
      attempts: 2,
      maxAttempts: 5,
      failureReason: 'SMTP timeout',
      nextRetryAt: new Date('2026-04-04T00:00:00.000Z'),
      lastAttemptAt: new Date('2026-04-03T00:00:00.000Z'),
    });

    await AdminNotificationDelivery.collection.updateOne(
      { _id: oldDelivery._id },
      {
        $set: {
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        },
      }
    );

    const deletedCount = await pruneAdminNotificationDeliveries(90, new Date('2026-04-03T00:00:00.000Z'));

    expect(deletedCount).toBe(1);

    const remainingDeliveries = await AdminNotificationDelivery.find({}).lean();
    expect(remainingDeliveries).toHaveLength(1);
    expect(remainingDeliveries[0]?.subject).toBe('Recent notification');
  });
});
