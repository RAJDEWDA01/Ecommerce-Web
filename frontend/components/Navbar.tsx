"use client";

import { useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useCartStore } from '../store/cartStore';

const emptySubscribe = () => () => {};
const navLinks = [
  { href: '/wishlist', label: 'Wishlist' },
  { href: '/account', label: 'Account' },
  { href: '/admin', label: 'Admin' },
  { href: '/customer-care', label: 'Care' },
];

export default function Navbar() {
  const totalItems = useCartStore((state) => state.getTotalItems());
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const isHydrated = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  return (
    <nav className="sticky top-0 z-50 bg-white border-b border-amber-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 sm:py-4 flex justify-between items-center gap-3">
        <Link href="/" className="flex items-center gap-2 sm:gap-3 min-w-0">
          <Image
            src="/images/gaumaya-logo.png"
            alt="Gaumaya Farm logo"
            width={42}
            height={42}
            className="h-8 w-8 sm:h-10 sm:w-10 object-contain shrink-0"
            priority
          />
          <span className="font-display text-base sm:text-2xl font-black text-amber-900 tracking-tight leading-none truncate">
            GAUMAYA<span className="text-amber-600 font-medium">FARM</span>
          </span>
        </Link>

        <div className="flex items-center gap-2 sm:gap-5 shrink-0">
          <div className="hidden md:flex items-center gap-5">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-sm font-semibold uppercase tracking-wide text-stone-600 hover:text-amber-700"
              >
                {link.label}
              </Link>
            ))}
          </div>

          <Link href="/cart" className="relative flex items-center cursor-pointer">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-6 w-6 sm:h-7 sm:w-7 text-stone-700 hover:text-amber-700"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z"
              />
            </svg>
            {isHydrated && totalItems > 0 && (
              <span className="absolute -top-1.5 -right-1.5 sm:-top-2 sm:-right-2 bg-red-500 text-white text-[10px] sm:text-xs font-bold w-4 h-4 sm:w-5 sm:h-5 flex items-center justify-center rounded-full">
                {totalItems}
              </span>
            )}
          </Link>

          <button
            type="button"
            aria-label="Toggle navigation menu"
            aria-expanded={isMobileMenuOpen}
            aria-controls="mobile-nav-menu"
            onClick={() => setIsMobileMenuOpen((previous) => !previous)}
            className="md:hidden rounded-lg border border-stone-300 px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wide text-stone-700 hover:bg-stone-100"
          >
            Menu
          </button>
        </div>
      </div>

      {isMobileMenuOpen && (
        <div id="mobile-nav-menu" className="md:hidden border-t border-amber-100 bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3 flex flex-col gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setIsMobileMenuOpen(false)}
                className="rounded-lg px-2 py-2 text-sm font-semibold uppercase tracking-wide text-stone-700 hover:bg-stone-100"
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
