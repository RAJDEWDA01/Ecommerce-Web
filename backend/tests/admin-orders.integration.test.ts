import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';

describe('Admin Orders API', () => {
  it('allows admin to update order status', async () => {
    const hashedPassword = await bcrypt.hash('AdminPass123', 10);
    await User.create({
      name: 'Store Admin',
      email: 'admin@example.com',
      password: hashedPassword,
      role: 'admin',
      isEmailVerified: true,
    });

    const product = await Product.create({
      name: 'Gaumaya A2 Ghee',
      description: 'Pure ghee',
      price: 1000,
      size: '500ml',
      imageUrl: '/images/gaumaya-ghee.jpg',
      stockQuantity: 12,
      sku: 'ADMIN-GHEE-500',
      isFeatured: false,
    });

    const order = await Order.create({
      customer: null,
      shippingInfo: {
        fullName: 'Walk-in Buyer',
        email: 'buyer@example.com',
        address: '789 Admin Street',
        city: 'Vadodara',
        postalCode: '390001',
        phone: '7777777777',
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
      razorpayOrderId: 'order_admin_status_001',
    });

    const loginResponse = await request(app).post('/api/admin/login').send({
      email: 'admin@example.com',
      password: 'AdminPass123',
    });

    expect(loginResponse.status).toBe(200);
    const adminToken = loginResponse.body.token as string;
    expect(adminToken).toBeTruthy();

    const updateResponse = await request(app)
      .patch(`/api/orders/${order._id.toString()}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        orderStatus: 'shipped',
        fulfillment: {
          courierName: 'BlueDart',
          trackingNumber: 'BLUEDART-12345',
          trackingUrl: 'https://www.bluedart.com/tracking/BLUEDART-12345',
        },
      });

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.body.success).toBe(true);
    expect(updateResponse.body.orderStatus).toBe('shipped');
    expect(updateResponse.body.fulfillmentInfo?.courierName).toBe('BlueDart');
    expect(updateResponse.body.fulfillmentInfo?.trackingNumber).toBe('BLUEDART-12345');

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder?.orderStatus).toBe('shipped');
    expect(updatedOrder?.fulfillmentInfo?.courierName).toBe('BlueDart');
    expect(updatedOrder?.fulfillmentInfo?.trackingNumber).toBe('BLUEDART-12345');
    expect(updatedOrder?.fulfillmentInfo?.trackingUrl).toBe(
      'https://www.bluedart.com/tracking/BLUEDART-12345'
    );
    expect(updatedOrder?.fulfillmentInfo?.shippedAt).toBeTruthy();
  });

  it('rejects unsupported tracking URL protocols on status update', async () => {
    const hashedPassword = await bcrypt.hash('AdminPass123', 10);
    await User.create({
      name: 'Store Admin',
      email: 'admin.fulfillment@example.com',
      password: hashedPassword,
      role: 'admin',
      isEmailVerified: true,
    });

    const product = await Product.create({
      name: 'Gaumaya A2 Ghee',
      description: 'Pure ghee',
      price: 1000,
      size: '500ml',
      imageUrl: '/images/gaumaya-ghee.jpg',
      stockQuantity: 12,
      sku: 'ADMIN-GHEE-500-FULFILLMENT',
      isFeatured: false,
    });

    const order = await Order.create({
      customer: null,
      shippingInfo: {
        fullName: 'Walk-in Buyer',
        email: 'buyer.fulfillment@example.com',
        address: '789 Admin Street',
        city: 'Vadodara',
        postalCode: '390001',
        phone: '7777777777',
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
      razorpayOrderId: 'order_admin_status_002',
    });

    const loginResponse = await request(app).post('/api/admin/login').send({
      email: 'admin.fulfillment@example.com',
      password: 'AdminPass123',
    });

    expect(loginResponse.status).toBe(200);
    const adminToken = loginResponse.body.token as string;
    expect(adminToken).toBeTruthy();

    const updateResponse = await request(app)
      .patch(`/api/orders/${order._id.toString()}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        orderStatus: 'shipped',
        fulfillment: {
          trackingUrl: 'ftp://tracking.example.com/order/123',
        },
      });

    expect(updateResponse.status).toBe(400);
    expect(updateResponse.body.success).toBe(false);
    expect(updateResponse.body.message).toContain('http or https');
  });

  it('exports refund trend analytics CSV grouped by refund date', async () => {
    const hashedPassword = await bcrypt.hash('AdminPass123', 10);
    await User.create({
      name: 'Store Admin',
      email: 'admin.analytics@example.com',
      password: hashedPassword,
      role: 'admin',
      isEmailVerified: true,
    });

    const product = await Product.create({
      name: 'Gaumaya A2 Ghee',
      description: 'Pure ghee',
      price: 1000,
      size: '500ml',
      imageUrl: '/images/gaumaya-ghee.jpg',
      stockQuantity: 12,
      sku: 'ADMIN-ANALYTICS-GHEE-500',
      isFeatured: false,
    });

    const baseOrder = {
      customer: null,
      shippingInfo: {
        fullName: 'Walk-in Buyer',
        email: 'buyer.analytics@example.com',
        address: '789 Admin Street',
        city: 'Vadodara',
        postalCode: '390001',
        phone: '7777777777',
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
      currency: 'INR' as const,
      paymentStatus: 'paid' as const,
      orderStatus: 'cancelled' as const,
    };

    await Order.create([
      {
        ...baseOrder,
        razorpayOrderId: 'order_admin_refund_001',
        refundInfo: {
          status: 'pending',
          amount: 100,
          currency: 'INR',
          initiatedAt: new Date('2026-03-30T10:00:00.000Z'),
          gatewaySettlementStatus: 'pending',
        },
      },
      {
        ...baseOrder,
        razorpayOrderId: 'order_admin_refund_002',
        refundInfo: {
          status: 'processed',
          amount: 200,
          currency: 'INR',
          initiatedAt: new Date('2026-03-30T12:00:00.000Z'),
          processedAt: new Date('2026-03-31T08:00:00.000Z'),
          gatewaySettlementStatus: 'settled',
          gatewaySettlementAt: new Date('2026-03-31T08:00:00.000Z'),
        },
      },
      {
        ...baseOrder,
        razorpayOrderId: 'order_admin_refund_003',
        refundInfo: {
          status: 'failed',
          amount: 50,
          currency: 'INR',
          initiatedAt: new Date('2026-03-31T07:30:00.000Z'),
          gatewaySettlementStatus: 'failed',
        },
      },
    ]);

    const loginResponse = await request(app).post('/api/admin/login').send({
      email: 'admin.analytics@example.com',
      password: 'AdminPass123',
    });

    expect(loginResponse.status).toBe(200);
    const adminToken = loginResponse.body.token as string;
    expect(adminToken).toBeTruthy();

    const exportResponse = await request(app)
      .get('/api/orders/refunds/analytics/export')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(exportResponse.status).toBe(200);
    expect(exportResponse.headers['content-type']).toContain('text/csv');
    expect(exportResponse.headers['content-disposition']).toContain('attachment; filename=');
    expect(exportResponse.text).toContain(
      'date,total_refund_orders,pending_count,processed_count,failed_count,pending_amount,processed_amount,failed_amount,total_amount'
    );
    expect(exportResponse.text).toContain('2026-03-30,2,1,1,0,100,200,0,300');
    expect(exportResponse.text).toContain('2026-03-31,1,0,0,1,0,0,50,50');
  });
});
