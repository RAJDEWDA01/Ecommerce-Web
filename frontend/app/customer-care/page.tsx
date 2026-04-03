"use client";

import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { customerApiFetch, getCustomerToken } from '@/lib/customerAuth';

interface SupportFormState {
  name: string;
  email: string;
  phone: string;
  subject: string;
  message: string;
}

interface FeedbackFormState {
  name: string;
  email: string;
  phone: string;
  rating: string;
  message: string;
}

interface CurrentUserResponse {
  success: boolean;
  user?: {
    name: string;
    email: string;
    phone?: string | null;
  };
}

interface CreateTicketResponse {
  success: boolean;
  message?: string;
}

interface CreateFeedbackResponse {
  success: boolean;
  message?: string;
}

const DEFAULT_FORM: SupportFormState = {
  name: '',
  email: '',
  phone: '',
  subject: '',
  message: '',
};

const DEFAULT_FEEDBACK_FORM: FeedbackFormState = {
  name: '',
  email: '',
  phone: '',
  rating: '5',
  message: '',
};

export default function CustomerCarePage() {
  const [form, setForm] = useState<SupportFormState>(DEFAULT_FORM);
  const [feedbackForm, setFeedbackForm] = useState<FeedbackFormState>(DEFAULT_FEEDBACK_FORM);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFeedbackSubmitting, setIsFeedbackSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedbackSuccessMessage, setFeedbackSuccessMessage] = useState<string | null>(null);
  const [feedbackErrorMessage, setFeedbackErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const hydrateFromProfile = async () => {
      if (!getCustomerToken()) {
        return;
      }

      try {
        const response = await customerApiFetch('/api/auth/me', {
          cache: 'no-store',
        });

        if (!response.ok) {
          return;
        }

        const data = (await response.json()) as CurrentUserResponse;

        if (!data.success || !data.user) {
          return;
        }

        setForm((prev) => ({
          ...prev,
          name: prev.name || data.user?.name || '',
          email: prev.email || data.user?.email || '',
          phone: prev.phone || data.user?.phone || '',
        }));
        setFeedbackForm((prev) => ({
          ...prev,
          name: prev.name || data.user?.name || '',
          email: prev.email || data.user?.email || '',
          phone: prev.phone || data.user?.phone || '',
        }));
      } catch {
        // Optional prefill should not block support form.
      }
    };

    void hydrateFromProfile();
  }, []);

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleFeedbackChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = event.target;
    setFeedbackForm((prev) => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSubmitting(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const response = await customerApiFetch('/api/support/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(form),
      });

      const data = (await response.json()) as CreateTicketResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Unable to submit support request');
      }

      setSuccessMessage(data.message || 'Support ticket submitted successfully');
      setForm((prev) => ({
        ...DEFAULT_FORM,
        name: prev.name,
        email: prev.email,
        phone: prev.phone,
      }));
    } catch (submitError) {
      setErrorMessage(
        submitError instanceof Error ? submitError.message : 'Unable to submit support request'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFeedbackSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsFeedbackSubmitting(true);
    setFeedbackSuccessMessage(null);
    setFeedbackErrorMessage(null);

    try {
      const response = await customerApiFetch('/api/feedback', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...feedbackForm,
          rating: Number(feedbackForm.rating),
        }),
      });

      const data = (await response.json()) as CreateFeedbackResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Unable to submit feedback');
      }

      setFeedbackSuccessMessage(data.message || 'Feedback submitted successfully');
      setFeedbackForm((prev) => ({
        ...DEFAULT_FEEDBACK_FORM,
        name: prev.name,
        email: prev.email,
        phone: prev.phone,
      }));
    } catch (submitError) {
      setFeedbackErrorMessage(
        submitError instanceof Error ? submitError.message : 'Unable to submit feedback'
      );
    } finally {
      setIsFeedbackSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-3xl mx-auto space-y-6">
        <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-8 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-amber-700 font-semibold">Customer Care</p>
          <h1 className="text-3xl sm:text-4xl font-black text-stone-900 mt-2">Need Help? We&apos;re Here.</h1>
          <p className="text-stone-600 mt-3">
            Share your issue and our support team will get back to you quickly.
          </p>
          <div className="mt-4 text-sm text-stone-600">
            <p>Email: gaumayafarm@gmail.com</p>
            <p>Phone: +91xxxxxxxx</p>
          </div>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-8 shadow-sm">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-stone-600 mb-1">Name</label>
                <input
                  required
                  name="name"
                  value={form.name}
                  onChange={handleChange}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">Email</label>
                <input
                  required
                  type="email"
                  name="email"
                  value={form.email}
                  onChange={handleChange}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm text-stone-600 mb-1">Phone (optional)</label>
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm text-stone-600 mb-1">Subject</label>
              <input
                required
                name="subject"
                value={form.subject}
                onChange={handleChange}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="block text-sm text-stone-600 mb-1">Message</label>
              <textarea
                required
                name="message"
                value={form.message}
                onChange={handleChange}
                rows={6}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            {successMessage && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {successMessage}
              </div>
            )}

            {errorMessage && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {errorMessage}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="submit"
                disabled={isSubmitting}
                className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-300 text-white px-5 py-2.5 rounded-lg text-sm font-semibold"
              >
                {isSubmitting ? 'Submitting...' : 'Submit Ticket'}
              </button>
              <Link
                href="/"
                className="bg-stone-200 hover:bg-stone-300 text-stone-800 px-5 py-2.5 rounded-lg text-sm font-semibold"
              >
                Back to Shop
              </Link>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-8 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-emerald-700 font-semibold">Feedback</p>
          <h2 className="text-2xl sm:text-3xl font-black text-stone-900 mt-2">Share Your Experience</h2>
          <p className="text-stone-600 mt-2">
            Your feedback helps us improve products, delivery, and support quality.
          </p>

          <form onSubmit={handleFeedbackSubmit} className="space-y-4 mt-5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-stone-600 mb-1">Name</label>
                <input
                  required
                  name="name"
                  value={feedbackForm.name}
                  onChange={handleFeedbackChange}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">Email</label>
                <input
                  required
                  type="email"
                  name="email"
                  value={feedbackForm.email}
                  onChange={handleFeedbackChange}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-stone-600 mb-1">Phone (optional)</label>
                <input
                  type="tel"
                  name="phone"
                  value={feedbackForm.phone}
                  onChange={handleFeedbackChange}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm text-stone-600 mb-1">Rating</label>
                <select
                  name="rating"
                  value={feedbackForm.rating}
                  onChange={handleFeedbackChange}
                  className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
                >
                  <option value="5">5 - Excellent</option>
                  <option value="4">4 - Good</option>
                  <option value="3">3 - Average</option>
                  <option value="2">2 - Poor</option>
                  <option value="1">1 - Very Poor</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm text-stone-600 mb-1">Feedback</label>
              <textarea
                required
                name="message"
                value={feedbackForm.message}
                onChange={handleFeedbackChange}
                rows={5}
                className="w-full border border-stone-300 rounded-lg px-3 py-2 text-sm"
              />
            </div>

            {feedbackSuccessMessage && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
                {feedbackSuccessMessage}
              </div>
            )}

            {feedbackErrorMessage && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {feedbackErrorMessage}
              </div>
            )}

            <button
              type="submit"
              disabled={isFeedbackSubmitting}
              className="bg-emerald-600 hover:bg-emerald-700 disabled:bg-emerald-300 text-white px-5 py-2.5 rounded-lg text-sm font-semibold"
            >
              {isFeedbackSubmitting ? 'Submitting...' : 'Submit Feedback'}
            </button>
          </form>
        </section>
      </div>
    </main>
  );
}
