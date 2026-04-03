import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';

describe('Product Reviews API', () => {
  it('allows guest and verified-customer product reviews with rating updates', async () => {
    const product = await Product.create({
      name: 'Review Test Ghee',
      description: 'Review test product',
      price: 650,
      size: '500ml',
      imageUrl: '/images/gaumaya-ghee.jpg',
      imageGallery: ['/images/gaumaya-ghee.jpg'],
      variants: [
        {
          label: '500ml',
          size: '500ml',
          price: 650,
          stockQuantity: 8,
          sku: 'REV-GHEE-500',
          isDefault: true,
        },
      ],
      stockQuantity: 8,
      sku: 'REV-GHEE-500',
      isFeatured: false,
    });

    const guestReviewResponse = await request(app)
      .post(`/api/products/${product._id.toString()}/reviews`)
      .send({
        name: 'Guest Buyer',
        rating: 5,
        title: 'Amazing quality',
        comment: 'Loved the aroma and texture.',
      });

    expect(guestReviewResponse.status).toBe(201);
    expect(guestReviewResponse.body.success).toBe(true);
    expect(guestReviewResponse.body.review.customerName).toBe('Guest Buyer');
    expect(guestReviewResponse.body.review.isVerifiedPurchase).toBe(false);
    expect(guestReviewResponse.body.ratingCount).toBe(1);
    expect(guestReviewResponse.body.ratingAverage).toBe(5);

    const hashedPassword = await bcrypt.hash('CustomerPass123', 10);
    const customer = await User.create({
      name: 'Verified Buyer',
      email: 'verified-buyer@example.com',
      password: hashedPassword,
      role: 'customer',
      isEmailVerified: true,
    });

    const loginResponse = await request(app).post('/api/auth/login').send({
      email: customer.email,
      password: 'CustomerPass123',
    });

    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.token as string;

    await Order.create({
      customer: customer._id,
      shippingInfo: {
        fullName: 'Verified Buyer',
        email: customer.email,
        address: '21 Lake Road',
        city: 'Ahmedabad',
        postalCode: '380001',
        phone: '9999999996',
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
      orderStatus: 'delivered',
      razorpayOrderId: 'review_test_paid_order_001',
    });

    const verifiedReviewResponse = await request(app)
      .post(`/api/products/${product._id.toString()}/reviews`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        rating: 4,
        comment: 'Good quality and packaging.',
      });

    expect(verifiedReviewResponse.status).toBe(201);
    expect(verifiedReviewResponse.body.success).toBe(true);
    expect(verifiedReviewResponse.body.review.isVerifiedPurchase).toBe(true);
    expect(verifiedReviewResponse.body.ratingCount).toBe(2);
    expect(verifiedReviewResponse.body.ratingAverage).toBe(4.5);

    const duplicateReviewResponse = await request(app)
      .post(`/api/products/${product._id.toString()}/reviews`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        rating: 4,
        comment: 'Trying duplicate review.',
      });

    expect(duplicateReviewResponse.status).toBe(409);
    expect(duplicateReviewResponse.body.success).toBe(false);
  });
});
