import request from 'supertest';
import { describe, expect, it } from 'vitest';
import app from '../src/app.js';
import User from '../src/models/User.js';

describe('Auth API', () => {
  it('registers and logs in a customer', async () => {
    const registerResponse = await request(app).post('/api/auth/register').send({
      name: 'Test Customer',
      email: 'customer@example.com',
      password: 'StrongPass123',
    });

    expect(registerResponse.status).toBe(201);
    expect(registerResponse.body.success).toBe(true);
    expect(registerResponse.body.token).toBeTypeOf('string');
    expect(registerResponse.body.user.email).toBe('customer@example.com');

    const savedUser = await User.findOne({ email: 'customer@example.com' }).select('+password');
    expect(savedUser).not.toBeNull();
    expect(savedUser?.role).toBe('customer');

    const loginResponse = await request(app).post('/api/auth/login').send({
      email: 'customer@example.com',
      password: 'StrongPass123',
    });

    expect(loginResponse.status).toBe(200);
    expect(loginResponse.body.success).toBe(true);
    expect(loginResponse.body.token).toBeTypeOf('string');
    expect(loginResponse.body.user.email).toBe('customer@example.com');
  });
});
