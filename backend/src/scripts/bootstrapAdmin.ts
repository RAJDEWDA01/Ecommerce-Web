import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import connectDB from '../config/db.js';
import User from '../models/User.js';

dotenv.config();

const isValidEmail = (email: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
const isStrongPassword = (password: string): boolean => {
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^A-Za-z0-9]/.test(password);

  return password.length >= 12 && hasUpper && hasLower && hasDigit && hasSpecial;
};

const bootstrapAdmin = async (): Promise<void> => {
  const name = process.env.BOOTSTRAP_ADMIN_NAME?.trim() || 'Store Admin';
  const rawEmail = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase() || '';
  const rawPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? '';

  if (!rawEmail || !rawPassword) {
    console.error(
      'Missing BOOTSTRAP_ADMIN_EMAIL or BOOTSTRAP_ADMIN_PASSWORD. Set these env vars before running bootstrap.'
    );
    process.exit(1);
  }

  if (!isValidEmail(rawEmail)) {
    console.error('BOOTSTRAP_ADMIN_EMAIL must be a valid email address.');
    process.exit(1);
  }

  if (!isStrongPassword(rawPassword)) {
    console.error(
      'BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters and include uppercase, lowercase, number, and special character.'
    );
    process.exit(1);
  }

  await connectDB();

  const hashedPassword = await bcrypt.hash(rawPassword, 12);

  const existingUser = await User.findOne({ email: rawEmail }).select('+password');

  if (existingUser) {
    existingUser.name = name;
    existingUser.password = hashedPassword;
    existingUser.role = 'admin';
    await existingUser.save();

    console.log(`Admin user updated: ${existingUser.email}`);
    process.exit(0);
  }

  const adminUser = await User.create({
    name,
    email: rawEmail,
    password: hashedPassword,
    role: 'admin',
  });

  console.log(`Admin user created: ${adminUser.email}`);
  process.exit(0);
};

bootstrapAdmin().catch((error) => {
  console.error('Failed to bootstrap admin user:', error);
  process.exit(1);
});
