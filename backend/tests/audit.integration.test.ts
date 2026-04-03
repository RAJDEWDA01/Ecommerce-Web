import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';

describe('Audit and Request Context APIs', () => {
  it('includes a request id header on responses', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBeTypeOf('string');
    expect(response.headers['x-request-id'].length).toBeGreaterThan(0);
  });

  it('records admin actions and allows querying audit logs', async () => {
    const hashedPassword = await bcrypt.hash('AuditAdminPass123', 10);
    const admin = await User.create({
      name: 'Audit Admin',
      email: 'audit-admin@example.com',
      password: hashedPassword,
      role: 'admin',
      isEmailVerified: true,
    });

    const product = await Product.create({
      name: 'Audit Test Product',
      description: 'Audit product',
      price: 100,
      size: '250ml',
      imageUrl: '/images/audit-product.jpg',
      stockQuantity: 10,
      sku: 'AUDIT-PROD-250',
      isFeatured: false,
    });

    const order = await Order.create({
      customer: null,
      shippingInfo: {
        fullName: 'Audit Buyer',
        email: 'audit-buyer@example.com',
        address: '90 Audit Street',
        city: 'Ahmedabad',
        postalCode: '380001',
        phone: '9012345678',
      },
      items: [
        {
          product: product._id,
          name: product.name,
          sku: product.sku,
          quantity: 1,
          unitPrice: product.price,
          lineTotal: product.price,
        },
      ],
      subtotal: product.price,
      shippingFee: 0,
      totalAmount: product.price,
      currency: 'INR',
      paymentStatus: 'pending',
      orderStatus: 'placed',
      razorpayOrderId: 'audit_order_001',
    });

    const loginResponse = await request(app).post('/api/admin/login').send({
      email: admin.email,
      password: 'AuditAdminPass123',
    });

    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.token as string;
    expect(token).toBeTruthy();

    const updateResponse = await request(app)
      .patch(`/api/orders/${order._id.toString()}/status`)
      .set('Authorization', `Bearer ${token}`)
      .send({ orderStatus: 'processing' });

    expect(updateResponse.status).toBe(200);

    const auditLogsResponse = await request(app)
      .get('/api/admin/audit-logs')
      .set('Authorization', `Bearer ${token}`)
      .query({ action: 'orders.status.update', limit: '10' });

    expect(auditLogsResponse.status).toBe(200);
    expect(auditLogsResponse.body.success).toBe(true);
    expect(Array.isArray(auditLogsResponse.body.auditLogs)).toBe(true);
    expect(auditLogsResponse.body.auditLogs.length).toBeGreaterThan(0);

    const matchingEntry = auditLogsResponse.body.auditLogs.find(
      (entry: { resourceId?: string; actorRole?: string; outcome?: string }) =>
        entry.resourceId === order._id.toString()
    );

    expect(matchingEntry).toBeDefined();
    expect(matchingEntry.actorRole).toBe('admin');
    expect(matchingEntry.outcome).toBe('success');

    const analyticsResponse = await request(app)
      .get('/api/admin/audit-logs/analytics')
      .set('Authorization', `Bearer ${token}`)
      .query({ action: 'orders.status.update', days: '30', top: '3' });

    expect(analyticsResponse.status).toBe(200);
    expect(analyticsResponse.body.success).toBe(true);
    expect(analyticsResponse.body.analytics).toBeTruthy();
    expect(analyticsResponse.body.analytics.totals.totalCount).toBeGreaterThan(0);
    expect(analyticsResponse.body.analytics.totals.successCount).toBeGreaterThan(0);
    expect(Array.isArray(analyticsResponse.body.analytics.byDay)).toBe(true);
    expect(analyticsResponse.body.analytics.byDay.length).toBeGreaterThan(0);
    expect(Array.isArray(analyticsResponse.body.analytics.topActions)).toBe(true);
    expect(analyticsResponse.body.analytics.topActions[0].action).toBe('orders.status.update');

    const exportResponse = await request(app)
      .get('/api/admin/audit-logs/export')
      .set('Authorization', `Bearer ${token}`)
      .query({ action: 'orders.status.update', limit: '100' });

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers['content-type']).toContain('text/csv');
    expect(exportResponse.headers['content-disposition']).toContain('attachment; filename=');
    expect(exportResponse.text).toContain('action,outcome,actorRole');
    expect(exportResponse.text).toContain('orders.status.update');

    const retentionResponse = await request(app)
      .get('/api/admin/audit-retention/status')
      .set('Authorization', `Bearer ${token}`);

    expect(retentionResponse.status).toBe(200);
    expect(retentionResponse.body.success).toBe(true);
    expect(retentionResponse.body.retention).toBeTruthy();
    expect(retentionResponse.body.retention.enabled).toBe(false);
    expect(retentionResponse.body.retention.retentionDays).toBeNull();

    const manualRunResponse = await request(app)
      .post('/api/admin/audit-retention/run')
      .set('Authorization', `Bearer ${token}`);

    expect(manualRunResponse.status).toBe(409);
    expect(manualRunResponse.body.success).toBe(false);

    const alertStatusResponse = await request(app)
      .get('/api/admin/audit-alerts/status')
      .set('Authorization', `Bearer ${token}`)
      .query({
        action: 'audit.retention.run_manual',
        windowMinutes: '120',
        minEvents: '1',
        warningFailureRate: '10',
        criticalFailureRate: '20',
      });

    expect(alertStatusResponse.status).toBe(200);
    expect(alertStatusResponse.body.success).toBe(true);
    expect(alertStatusResponse.body.alert).toBeTruthy();
    expect(alertStatusResponse.body.alert.metrics.totalCount).toBeGreaterThan(0);
    expect(alertStatusResponse.body.alert.metrics.failureCount).toBeGreaterThan(0);
    expect(alertStatusResponse.body.alert.severity).toBe('critical');
    expect(alertStatusResponse.body.alert.triggered).toBe(true);

    const notifierStatusResponse = await request(app)
      .get('/api/admin/audit-alerts/notifier/status')
      .set('Authorization', `Bearer ${token}`);

    expect(notifierStatusResponse.status).toBe(200);
    expect(notifierStatusResponse.body.success).toBe(true);
    expect(notifierStatusResponse.body.notifier).toBeTruthy();
    expect(notifierStatusResponse.body.notifier.enabled).toBe(false);
    expect(notifierStatusResponse.body.notifier.webhookConfigured).toBe(false);

    const notifierRunResponse = await request(app)
      .post('/api/admin/audit-alerts/notifier/run')
      .set('Authorization', `Bearer ${token}`);

    expect(notifierRunResponse.status).toBe(409);
    expect(notifierRunResponse.body.success).toBe(false);
  });
});
