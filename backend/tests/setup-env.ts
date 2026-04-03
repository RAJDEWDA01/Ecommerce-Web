process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.PORT = process.env.PORT || '5001';
process.env.MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/gaumaya-test';
process.env.JWT_SECRET =
  process.env.JWT_SECRET || 'f7c2Pq9vLm4rN8xYt1aB5kD3hJ6mS0wQzR2uV9cX';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN || 'http://localhost:3000';
process.env.FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
process.env.REDIS_URL = '';
process.env.LOG_LEVEL = process.env.LOG_LEVEL || 'warn';
process.env.AUDIT_LOG_RETENTION_DAYS = process.env.AUDIT_LOG_RETENTION_DAYS || '180';
process.env.AUDIT_LOG_PRUNE_INTERVAL_MINUTES =
  process.env.AUDIT_LOG_PRUNE_INTERVAL_MINUTES || '60';

process.env.RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || 'rzp_test_key';
process.env.RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || 'rzp_test_secret';
process.env.RAZORPAY_WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || 'rzp_test_webhook_secret';
process.env.MONGOMS_VERSION = process.env.MONGOMS_VERSION || '7.0.14';

process.env.AUTH_LOGIN_LIMIT_MAX = process.env.AUTH_LOGIN_LIMIT_MAX || '500';
process.env.AUTH_LOGIN_LIMIT_WINDOW_MINUTES = process.env.AUTH_LOGIN_LIMIT_WINDOW_MINUTES || '1';
process.env.PAYMENT_CREATE_ORDER_LIMIT_MAX = process.env.PAYMENT_CREATE_ORDER_LIMIT_MAX || '500';
process.env.PAYMENT_CREATE_ORDER_LIMIT_WINDOW_MINUTES =
  process.env.PAYMENT_CREATE_ORDER_LIMIT_WINDOW_MINUTES || '1';
process.env.PAYMENT_VERIFY_LIMIT_MAX = process.env.PAYMENT_VERIFY_LIMIT_MAX || '500';
process.env.PAYMENT_VERIFY_LIMIT_WINDOW_MINUTES =
  process.env.PAYMENT_VERIFY_LIMIT_WINDOW_MINUTES || '1';
