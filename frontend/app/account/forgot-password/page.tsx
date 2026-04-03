"use client";

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { buildApiUrl } from '@/lib/api';

interface ForgotPasswordResponse {
  success: boolean;
  message?: string;
  debugPasswordResetToken?: string;
}

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [debugToken, setDebugToken] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setDebugToken(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(buildApiUrl('/api/auth/forgot-password'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email }),
      });

      const data = (await response.json()) as ForgotPasswordResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Unable to process forgot-password request');
      }

      setMessage(data.message || 'If an account exists, reset instructions have been sent.');
      setDebugToken(data.debugPasswordResetToken ?? null);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : 'Unable to process forgot-password request'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-black text-stone-900">Forgot Password</h1>
        <p className="text-stone-600 mt-2">Enter your account email to receive reset instructions.</p>

        <form onSubmit={handleSubmit} className="mt-8 space-y-4">
          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {message && (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {message}
            </div>
          )}

          {debugToken && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900 break-all">
              Dev token (mail not configured): {debugToken}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-bold py-3 rounded-lg"
          >
            {isSubmitting ? 'Submitting...' : 'Send Reset Instructions'}
          </button>
        </form>

        <p className="text-sm text-stone-600 mt-6">
          Remembered your password?{' '}
          <Link href="/account/login" className="text-amber-700 font-semibold hover:underline">
            Back to sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
