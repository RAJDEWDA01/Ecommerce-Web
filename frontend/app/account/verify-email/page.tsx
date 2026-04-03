"use client";

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { buildApiUrl } from '@/lib/api';

interface VerifyEmailResponse {
  success: boolean;
  message?: string;
}

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get('token') ?? '', [searchParams]);

  const [loading, setLoading] = useState(true);
  const [success, setSuccess] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const verify = async () => {
      if (!token) {
        setMessage('Verification token is missing.');
        setLoading(false);
        return;
      }

      try {
        const response = await fetch(buildApiUrl('/api/auth/verify-email/confirm'), {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ token }),
        });

        const data = (await response.json()) as VerifyEmailResponse;

        if (!response.ok || !data.success) {
          throw new Error(data.message || 'Unable to verify email');
        }

        setSuccess(true);
        setMessage(data.message || 'Email verified successfully.');
      } catch (verifyError) {
        setMessage(verifyError instanceof Error ? verifyError.message : 'Unable to verify email');
      } finally {
        setLoading(false);
      }
    };

    void verify();
  }, [token]);

  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-black text-stone-900">Email Verification</h1>

        {loading ? (
          <p className="text-stone-600 mt-4">Verifying your email...</p>
        ) : (
          <div className="mt-4">
            <div
              className={`rounded-lg px-4 py-3 text-sm ${
                success
                  ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                  : 'border border-red-200 bg-red-50 text-red-700'
              }`}
            >
              {message || (success ? 'Email verified.' : 'Verification failed.')}
            </div>
            <div className="mt-6">
              <Link href="/account/login" className="text-amber-700 font-semibold hover:underline">
                Go to Sign In
              </Link>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
          <p className="text-stone-700">Loading verification...</p>
        </main>
      }
    >
      <VerifyEmailContent />
    </Suspense>
  );
}
