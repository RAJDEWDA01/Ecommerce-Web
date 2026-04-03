import { createHmac } from 'node:crypto';
import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';

describe('Payments API', () => {
  it('verifies payment and updates order status', async () => {
    const hashedPassword = await bcrypt.hash('CustomerPass123', 10);
    const customer = await User.create({
      name: 'Verified Customer',
      email: 'verified.customer@example.com',
      password: hashedPassword,
      role: 'customer',
      isEmailVerified: true,
    });

    const product = await Product.create({
      name: 'Gaumaya A2 Ghee',
      description: 'Pure ghee',
      price: 1500,
      size: '500ml',
      imageUrl: '/images/gaumaya-ghee.jpg',
      stockQuantity: 5,
      sku: 'PAY-GHEE-500',
      isFeatured: false,
    });

    const order = await Order.create({
      customer: customer._id,
      shippingInfo: {
        fullName: 'Verified Customer',
        email: customer.email,
        address: '456 Payment Lane',
        city: 'Surat',
        postalCode: '395007',
        phone: '8888888888',
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
      razorpayOrderId: 'order_test_123',
    });

    const loginResponse = await request(app).post('/api/auth/login').send({
      email: customer.email,
      password: 'CustomerPass123',
    });

    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.token as string;
    expect(token).toBeTruthy();

    const razorpayPaymentId = 'pay_test_123';
    const razorpaySignature = createHmac('sha256', process.env.RAZORPAY_KEY_SECRET as string)
      .update(`order_test_123|${razorpayPaymentId}`)
      .digest('hex');

    const verifyResponse = await request(app)
      .post('/api/payments/verify')
      .set('Authorization', `Bearer ${token}`)
      .set('X-Idempotency-Key', 'payment-verify-test-key-001')
      .send({
        orderId: order._id.toString(),
        razorpayOrderId: 'order_test_123',
        razorpayPaymentId,
        razorpaySignature,
      });

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.body.success).toBe(true);
    expect(verifyResponse.body.paymentStatus).toBe('paid');
    expect(verifyResponse.body.orderStatus).toBe('processing');

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder?.paymentStatus).toBe('paid');
    expect(updatedOrder?.orderStatus).toBe('processing');
    expect(updatedOrder?.razorpayPaymentId).toBe(razorpayPaymentId);
  });

  it('updates refund settlement status from webhook refund events', async () => {
    const product = await Product.create({
      name: 'Gaumaya A2 Ghee',
      description: 'Pure ghee',
      price: 1500,
      size: '500ml',
      imageUrl: '/images/gaumaya-ghee.jpg',
      stockQuantity: 5,
      sku: 'PAY-REFUND-GHEE-500',
      isFeatured: false,
    });

    const order = await Order.create({
      customer: null,
      shippingInfo: {
        fullName: 'Webhook Refund Customer',
        email: 'webhook.refund@example.com',
        address: '456 Webhook Lane',
        city: 'Surat',
        postalCode: '395007',
        phone: '8888888888',
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
      paymentStatus: 'paid',
      orderStatus: 'cancelled',
      razorpayOrderId: 'order_refund_webhook_123',
      razorpayPaymentId: 'pay_refund_webhook_123',
      refundInfo: {
        status: 'pending',
        amount: product.price,
        currency: 'INR',
        initiatedAt: new Date('2026-03-31T10:00:00.000Z'),
        gatewaySettlementStatus: 'unknown',
      },
    });

    const payload = {
      event: 'refund.processed',
      payload: {
        refund: {
          entity: {
            id: 'rfnd_webhook_123',
            payment_id: 'pay_refund_webhook_123',
            status: 'processed',
          },
        },
      },
    };

    const rawPayload = JSON.stringify(payload);
    const signature = createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET as string)
      .update(rawPayload)
      .digest('hex');

    const webhookResponse = await request(app)
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('x-razorpay-signature', signature)
      .set('x-razorpay-event-id', 'evt_refund_webhook_123')
      .send(rawPayload);

    expect(webhookResponse.status).toBe(200);
    expect(webhookResponse.body.success).toBe(true);

    const updatedOrder = await Order.findById(order._id);
    expect(updatedOrder?.refundInfo.gatewaySettlementStatus).toBe('settled');
    expect(updatedOrder?.refundInfo.gatewayRefundId).toBe('rfnd_webhook_123');
    expect(updatedOrder?.refundInfo.gatewaySettlementAt).toBeTruthy();
  });
});
