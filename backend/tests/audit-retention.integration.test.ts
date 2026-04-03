import { describe, expect, it } from 'vitest';
import AuditLog from '../src/models/AuditLog.js';
import { pruneAuditLogs } from '../src/services/auditRetention.js';

describe('Audit Retention Service', () => {
  it('prunes audit logs older than configured retention window', async () => {
    const oldLog = await AuditLog.create({
      action: 'audit.test.old',
      outcome: 'success',
      actorRole: 'system',
    });

    await AuditLog.create({
      action: 'audit.test.recent',
      outcome: 'success',
      actorRole: 'system',
    });

    await AuditLog.collection.updateOne(
      { _id: oldLog._id },
      {
        $set: {
          createdAt: new Date('2025-01-01T00:00:00.000Z'),
          updatedAt: new Date('2025-01-01T00:00:00.000Z'),
        },
      }
    );

    const deletedCount = await pruneAuditLogs(90, new Date('2026-04-02T00:00:00.000Z'));

    expect(deletedCount).toBe(1);

    const remainingLogs = await AuditLog.find({}).lean();
    expect(remainingLogs).toHaveLength(1);
    expect(remainingLogs[0]?.action).toBe('audit.test.recent');
  });
});
