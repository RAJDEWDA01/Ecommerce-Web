import express from 'express';
import type { Request, Response } from 'express';
import cors, { type CorsOptions } from 'cors';
import cookieParser from 'cookie-parser';
import path from 'node:path';
import mongoose from 'mongoose';
import env from './config/env.js';
import { getRedisClient } from './config/redis.js';
import productRoutes from './routes/productRoutes.js';
import orderRoutes from './routes/orderRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import uploadRoutes from './routes/uploadRoutes.js';
import authRoutes from './routes/authRoutes.js';
import wishlistRoutes from './routes/wishlistRoutes.js';
import couponRoutes from './routes/couponRoutes.js';
import supportRoutes from './routes/supportRoutes.js';
import addressRoutes from './routes/addressRoutes.js';
import feedbackRoutes from './routes/feedbackRoutes.js';
import { attachRequestContext, logHttpRequests } from './middleware/requestContext.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandlers.js';

const app = express();

if (env.trustProxy !== undefined) {
  app.set('trust proxy', env.trustProxy);
}

const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || env.corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Idempotency-Key', 'X-Request-Id'],
  maxAge: 86400,
};

app.use(attachRequestContext);
app.use(logHttpRequests);
app.use(
  cors(corsOptions)
);
app.use(
  express.json({
    verify: (req, _res, buffer) => {
      (req as Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  })
);
app.use(cookieParser());
if (env.uploadDriver === 'local') {
  app.use('/uploads', express.static(path.resolve('uploads')));
}

const getMongoHealthLabel = (): 'connected' | 'connecting' | 'disconnecting' | 'disconnected' => {
  switch (mongoose.connection.readyState) {
    case 1:
      return 'connected';
    case 2:
      return 'connecting';
    case 3:
      return 'disconnecting';
    default:
      return 'disconnected';
  }
};

app.get('/api/health', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'healthy',
    message: 'API is running',
    environment: env.nodeEnv,
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
  });
});

app.get('/api/health/live', (_req: Request, res: Response) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
  });
});

app.get('/api/health/ready', async (_req: Request, res: Response) => {
  const mongoStatus = getMongoHealthLabel();
  const mongoReady = mongoStatus === 'connected';

  let redisStatus: 'disabled' | 'connected' | 'degraded' = 'disabled';
  if (env.redisUrl) {
    try {
      const redisClient = await getRedisClient();

      if (redisClient) {
        await redisClient.ping();
        redisStatus = 'connected';
      } else {
        redisStatus = 'degraded';
      }
    } catch {
      redisStatus = 'degraded';
    }
  }

  const appStatus = mongoReady ? (redisStatus === 'degraded' ? 'degraded' : 'ready') : 'not_ready';

  res.status(mongoReady ? 200 : 503).json({
    status: appStatus,
    timestamp: new Date().toISOString(),
    services: {
      mongo: mongoStatus,
      redis: redisStatus,
    },
  });
});

app.use('/api/products', productRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/uploads', uploadRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/coupons', couponRoutes);
app.use('/api/support', supportRoutes);
app.use('/api/feedback', feedbackRoutes);
app.use('/api/addresses', addressRoutes);
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
