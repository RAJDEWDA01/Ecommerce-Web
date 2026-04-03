import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';

describe('Customer Feature APIs', () => {
  it('supports wishlist, coupons, profile update, support tickets, and feedback', async () => {
    const customerPassword = await bcrypt.hash('CustomerPass123', 10);
    const adminPassword = await bcrypt.hash('AdminPass123', 10);

    const customer = await User.create({
      name: 'Wishlist Customer',
      email: 'wishlist-customer@example.com',
      password: customerPassword,
      role: 'customer',
      isEmailVerified: true,
    });

    const admin = await User.create({
      name: 'Coupon Admin',
      email: 'coupon-admin@example.com',
      password: adminPassword,
      role: 'admin',
      isEmailVerified: true,
    });

    const product = await Product.create({
      name: 'Feature Product',
      description: 'Feature test product',
      price: 250,
      size: '500ml',
      imageUrl: '/images/feature-product.jpg',
      stockQuantity: 10,
      sku: 'FEATURE-500',
      isFeatured: false,
    });

    const customerLoginResponse = await request(app).post('/api/auth/login').send({
      email: customer.email,
      password: 'CustomerPass123',
    });

    expect(customerLoginResponse.status).toBe(200);
    expect(customerLoginResponse.body.success).toBe(true);
    const customerToken = customerLoginResponse.body.token as string;

    const adminLoginResponse = await request(app).post('/api/admin/login').send({
      email: admin.email,
      password: 'AdminPass123',
    });

    expect(adminLoginResponse.status).toBe(200);
    expect(adminLoginResponse.body.success).toBe(true);
    const adminToken = adminLoginResponse.body.token as string;

    const addWishlistResponse = await request(app)
      .post('/api/wishlist/items')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId: product._id.toString() });

    expect(addWishlistResponse.status).toBe(200);
    expect(addWishlistResponse.body.success).toBe(true);
    expect(addWishlistResponse.body.count).toBe(1);

    const getWishlistResponse = await request(app)
      .get('/api/wishlist')
      .set('Authorization', `Bearer ${customerToken}`);

    expect(getWishlistResponse.status).toBe(200);
    expect(getWishlistResponse.body.success).toBe(true);
    expect(Array.isArray(getWishlistResponse.body.items)).toBe(true);
    expect(getWishlistResponse.body.items.length).toBe(1);

    const createCouponResponse = await request(app)
      .post('/api/admin/coupons')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        code: 'WELCOME10',
        description: 'Welcome discount',
        discountType: 'percentage',
        discountValue: 10,
        minOrderAmount: 100,
        isActive: true,
      });

    expect(createCouponResponse.status).toBe(201);
    expect(createCouponResponse.body.success).toBe(true);
    expect(createCouponResponse.body.coupon.code).toBe('WELCOME10');

    const validateCouponResponse = await request(app)
      .post('/api/coupons/validate')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        code: 'WELCOME10',
        subtotal: 500,
      });

    expect(validateCouponResponse.status).toBe(200);
    expect(validateCouponResponse.body.success).toBe(true);
    expect(validateCouponResponse.body.coupon.discountAmount).toBe(50);

    const updateProfileResponse = await request(app)
      .patch('/api/auth/me')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        name: 'Wishlist Customer Updated',
        phone: '+91 9988776655',
      });

    expect(updateProfileResponse.status).toBe(200);
    expect(updateProfileResponse.body.success).toBe(true);
    expect(updateProfileResponse.body.user.name).toBe('Wishlist Customer Updated');
    expect(updateProfileResponse.body.user.phone).toBe('+91 9988776655');

    const createTicketResponse = await request(app)
      .post('/api/support/tickets')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        name: 'Wishlist Customer Updated',
        email: customer.email,
        phone: '+91 9988776655',
        subject: 'Need help with delivery',
        message: 'Please share expected delivery timeline.',
      });

    expect(createTicketResponse.status).toBe(201);
    expect(createTicketResponse.body.success).toBe(true);

    const supportTicketsResponse = await request(app)
      .get('/api/admin/support-tickets')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(supportTicketsResponse.status).toBe(200);
    expect(supportTicketsResponse.body.success).toBe(true);
    expect(Array.isArray(supportTicketsResponse.body.tickets)).toBe(true);
    expect(supportTicketsResponse.body.tickets.length).toBeGreaterThan(0);

    const firstTicket = supportTicketsResponse.body.tickets[0] as { _id: string };

    const updateTicketStatusResponse = await request(app)
      .patch(`/api/admin/support-tickets/${firstTicket._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'in_progress' });

    expect(updateTicketStatusResponse.status).toBe(200);
    expect(updateTicketStatusResponse.body.success).toBe(true);
    expect(updateTicketStatusResponse.body.ticket.status).toBe('in_progress');

    const createFeedbackResponse = await request(app)
      .post('/api/feedback')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        name: 'Wishlist Customer Updated',
        email: customer.email,
        phone: '+91 9988776655',
        rating: 5,
        message: 'Great quality and delivery experience.',
      });

    expect(createFeedbackResponse.status).toBe(201);
    expect(createFeedbackResponse.body.success).toBe(true);

    const feedbackListResponse = await request(app)
      .get('/api/admin/feedback')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(feedbackListResponse.status).toBe(200);
    expect(feedbackListResponse.body.success).toBe(true);
    expect(Array.isArray(feedbackListResponse.body.feedback)).toBe(true);
    expect(feedbackListResponse.body.feedback.length).toBeGreaterThan(0);

    const firstFeedback = feedbackListResponse.body.feedback[0] as { _id: string; status: string };
    expect(firstFeedback.status).toBe('new');

    const updateFeedbackStatusResponse = await request(app)
      .patch(`/api/admin/feedback/${firstFeedback._id}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'reviewed', adminNote: 'Acknowledged and shared with ops team.' });

    expect(updateFeedbackStatusResponse.status).toBe(200);
    expect(updateFeedbackStatusResponse.body.success).toBe(true);
    expect(updateFeedbackStatusResponse.body.feedback.status).toBe('reviewed');

    const removeWishlistResponse = await request(app)
      .delete(`/api/wishlist/items/${product._id.toString()}`)
      .set('Authorization', `Bearer ${customerToken}`);

    expect(removeWishlistResponse.status).toBe(200);
    expect(removeWishlistResponse.body.success).toBe(true);
    expect(removeWishlistResponse.body.count).toBe(0);
  });
});
