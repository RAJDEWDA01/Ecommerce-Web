import bcrypt from 'bcryptjs';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';
import User from '../src/models/User.js';

describe('Query APIs', () => {
  it('supports backward-compatible and paginated product listing', async () => {
    await Product.create([
      {
        name: 'A2 Ghee Classic',
        description: 'Traditional bilona ghee',
        price: 1200,
        size: '500ml',
        imageUrl: '/images/ghee-classic.jpg',
        stockQuantity: 5,
        sku: 'QRY-GHEE-CLASSIC',
        isFeatured: true,
      },
      {
        name: 'Wood Pressed Oil',
        description: 'Cold pressed oil',
        price: 950,
        size: '1L',
        imageUrl: '/images/oil.jpg',
        stockQuantity: 0,
        sku: 'QRY-OIL-1L',
        isFeatured: false,
      },
      {
        name: 'A2 Ghee Reserve',
        description: 'Premium ghee reserve',
        price: 1600,
        size: '500ml',
        imageUrl: '/images/ghee-reserve.jpg',
        stockQuantity: 0,
        sku: 'QRY-GHEE-RESERVE',
        isFeatured: true,
      },
    ]);

    const legacyResponse = await request(app).get('/api/products');

    expect(legacyResponse.status).toBe(200);
    expect(Array.isArray(legacyResponse.body)).toBe(true);
    expect(legacyResponse.body).toHaveLength(3);

    const paginatedResponse = await request(app)
      .get('/api/products')
      .query({
        search: 'ghee',
        featured: 'true',
        inStock: 'true',
        page: '1',
        limit: '1',
        sortBy: 'price',
        sortOrder: 'asc',
      });

    expect(paginatedResponse.status).toBe(200);
    expect(paginatedResponse.body.success).toBe(true);
    expect(paginatedResponse.body.count).toBe(1);
    expect(paginatedResponse.body.products).toHaveLength(1);
    expect(paginatedResponse.body.products[0].name).toBe('A2 Ghee Classic');
    expect(paginatedResponse.body.pagination.totalCount).toBe(1);
    expect(paginatedResponse.body.pagination.totalPages).toBe(1);
    expect(paginatedResponse.body.pagination.hasNextPage).toBe(false);
  });

  it('supports filtered admin order listing with pagination metadata', async () => {
    const hashedPassword = await bcrypt.hash('AdminPass123', 10);
    await User.create({
      name: 'Query Admin',
      email: 'query-admin@example.com',
      password: hashedPassword,
      role: 'admin',
      isEmailVerified: true,
    });

    const product = await Product.create({
      name: 'A2 Paneer',
      description: 'Fresh paneer',
      price: 450,
      size: '500g',
      imageUrl: '/images/paneer.jpg',
      stockQuantity: 20,
      sku: 'QRY-PANEER-500',
      isFeatured: false,
    });

    await Order.create([
      {
        customer: null,
        shippingInfo: {
          fullName: 'First Buyer',
          email: 'first@example.com',
          address: '12 Green Lane',
          city: 'Anand',
          postalCode: '388001',
          phone: '9000000001',
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
        razorpayOrderId: 'query_order_placed_001',
      },
      {
        customer: null,
        shippingInfo: {
          fullName: 'Second Buyer',
          email: 'second@example.com',
          address: '77 Market Road',
          city: 'Anand',
          postalCode: '388001',
          phone: '9000000002',
        },
        items: [
          {
            product: product._id,
            name: product.name,
            sku: product.sku,
            quantity: 2,
            unitPrice: product.price,
            lineTotal: product.price * 2,
          },
        ],
        subtotal: product.price * 2,
        shippingFee: 0,
        totalAmount: product.price * 2,
        currency: 'INR',
        paymentStatus: 'paid',
        orderStatus: 'shipped',
        razorpayOrderId: 'query_order_shipped_001',
      },
    ]);

    const loginResponse = await request(app).post('/api/admin/login').send({
      email: 'query-admin@example.com',
      password: 'AdminPass123',
    });

    expect(loginResponse.status).toBe(200);
    const token = loginResponse.body.token as string;

    const ordersResponse = await request(app)
      .get('/api/orders')
      .query({ orderStatus: 'shipped', page: 1, limit: 1 })
      .set('Authorization', `Bearer ${token}`);

    expect(ordersResponse.status).toBe(200);
    expect(ordersResponse.body.success).toBe(true);
    expect(ordersResponse.body.count).toBe(1);
    expect(ordersResponse.body.totalCount).toBe(1);
    expect(ordersResponse.body.orders).toHaveLength(1);
    expect(ordersResponse.body.orders[0].orderStatus).toBe('shipped');
    expect(ordersResponse.body.pagination.page).toBe(1);
    expect(ordersResponse.body.pagination.limit).toBe(1);
    expect(ordersResponse.body.pagination.totalPages).toBe(1);
  });
});
