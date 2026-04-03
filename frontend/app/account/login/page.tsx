"use client";

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { buildApiUrl } from '@/lib/api';
import { getCustomerToken, refreshCustomerSession, setCustomerToken } from '@/lib/customerAuth';

interface AuthResponse {
  success: boolean;
  message: string;
  token?: string;
}

export default function CustomerLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const bootstrap = async () => {
      const token = getCustomerToken();

      if (token) {
        router.replace('/account');
        return;
      }

      const refreshed = await refreshCustomerSession();

      if (refreshed) {
        router.replace('/account');
      }
    };

    void bootstrap();
  }, [router]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);

    try {
      const response = await fetch(buildApiUrl('/api/auth/login'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });

      const data = (await response.json()) as AuthResponse;

      if (!response.ok || !data.success || !data.token) {
        throw new Error(data.message || 'Login failed');
      }

      setCustomerToken(data.token);
      router.replace('/account');
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Unable to login');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-black text-stone-900">Sign In</h1>
        <p className="text-stone-600 mt-2">Access your account and order history.</p>

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

          <div>
            <label className="block text-sm font-medium text-stone-700 mb-1">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full border border-stone-300 rounded-lg px-4 py-2.5"
            />
          </div>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-bold py-3 rounded-lg"
          >
            {isSubmitting ? 'Signing in...' : 'Sign In'}
          </button>

          <div className="text-right">
            <Link href="/account/forgot-password" className="text-sm text-amber-700 font-semibold hover:underline">
              Forgot password?
            </Link>
          </div>
        </form>

        <p className="text-sm text-stone-600 mt-6">
          New customer?{' '}
          <Link href="/account/register" className="text-amber-700 font-semibold hover:underline">
            Create an account
          </Link>
        </p>
      </div>
    </main>
  );
}
