import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import Order from '../src/models/Order.js';
import Product from '../src/models/Product.js';

describe('Checkout API', () => {
  it('creates an order and replays the same response for idempotent retries', async () => {
    const product = await Product.create({
      name: 'Gaumaya A2 Ghee',
      description: 'Pure ghee',
      price: 1200,
      size: '500ml',
      imageUrl: '/images/gaumaya-ghee.jpg',
      stockQuantity: 10,
      sku: 'TEST-GHEE-500',
      isFeatured: true,
    });

    const payload = {
      shippingInfo: {
        fullName: 'Checkout User',
        email: 'checkout@example.com',
        address: '123 Main Street',
        city: 'Ahmedabad',
        postalCode: '380001',
        phone: '9999999999',
      },
      cartItems: [
        {
          productId: product._id.toString(),
          quantity: 2,
        },
      ],
    };

    const idempotencyKey = 'checkout-test-key-001';

    const firstResponse = await request(app)
      .post('/api/orders')
      .set('X-Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(firstResponse.status).toBe(201);
    expect(firstResponse.body.success).toBe(true);
    expect(firstResponse.body.orderId).toBeTruthy();
    expect(firstResponse.body.totalAmount).toBe(2400);

    const retryResponse = await request(app)
      .post('/api/orders')
      .set('X-Idempotency-Key', idempotencyKey)
      .send(payload);

    expect(retryResponse.status).toBe(201);
    expect(retryResponse.body.orderId).toBe(firstResponse.body.orderId);
    expect(retryResponse.body.totalAmount).toBe(2400);

    const savedOrder = await Order.findById(firstResponse.body.orderId);
    expect(savedOrder).not.toBeNull();
    expect(savedOrder?.items).toHaveLength(1);

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct?.stockQuantity).toBe(8);
  });

  it('rolls back stock changes when checkout cannot fulfill the full cart', async () => {
    const product = await Product.create({
      name: 'Gaumaya Cow Milk',
      description: 'Farm fresh milk',
      price: 150,
      size: '1L',
      imageUrl: '/images/gaumaya-milk.jpg',
      stockQuantity: 1,
      sku: 'TEST-MILK-1L',
      isFeatured: false,
    });

    const response = await request(app)
      .post('/api/orders')
      .send({
        shippingInfo: {
          fullName: 'Rollback User',
          email: 'rollback@example.com',
          address: '202 Industrial Street',
          city: 'Rajkot',
          postalCode: '360001',
          phone: '9999999998',
        },
        cartItems: [
          { productId: product._id.toString(), quantity: 1 },
          { productId: product._id.toString(), quantity: 1 },
        ],
      });

    expect(response.status).toBe(409);
    expect(response.body.success).toBe(false);

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct?.stockQuantity).toBe(1);

    const orderCount = await Order.countDocuments();
    expect(orderCount).toBe(0);
  });

  it('creates an order using selected product variant and decrements variant stock', async () => {
    const product = await Product.create({
      name: 'Gaumaya A2 Ghee Variant Pack',
      description: 'Variant test product',
      price: 650,
      size: '500ml',
      imageUrl: '/images/gaumaya-ghee.jpg',
      imageGallery: ['/images/gaumaya-ghee.jpg'],
      variants: [
        {
          label: '500ml',
          size: '500ml',
          price: 650,
          stockQuantity: 10,
          sku: 'TEST-VAR-500',
          isDefault: true,
        },
        {
          label: '1kg',
          size: '1kg',
          price: 1200,
          stockQuantity: 6,
          sku: 'TEST-VAR-1KG',
          isDefault: false,
        },
      ],
      stockQuantity: 16,
      sku: 'TEST-VAR-500',
      isFeatured: true,
    });

    const response = await request(app).post('/api/orders').send({
      shippingInfo: {
        fullName: 'Variant Checkout User',
        email: 'variant-checkout@example.com',
        address: '123 Main Street',
        city: 'Ahmedabad',
        postalCode: '380001',
        phone: '9999999997',
      },
      cartItems: [
        {
          productId: product._id.toString(),
          quantity: 2,
          variantSku: 'TEST-VAR-1KG',
        },
      ],
    });

    expect(response.status).toBe(201);
    expect(response.body.success).toBe(true);
    expect(response.body.totalAmount).toBe(2400);

    const savedOrder = await Order.findById(response.body.orderId);
    expect(savedOrder).not.toBeNull();
    expect(savedOrder?.items).toHaveLength(1);
    expect(savedOrder?.items[0]?.sku).toBe('TEST-VAR-1KG');

    const updatedProduct = await Product.findById(product._id);
    expect(updatedProduct?.stockQuantity).toBe(14);
    const selectedVariant = updatedProduct?.variants.find((variant) => variant.sku === 'TEST-VAR-1KG');
    expect(selectedVariant?.stockQuantity).toBe(4);
  });
});
