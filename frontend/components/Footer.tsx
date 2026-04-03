import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="mt-16 border-t border-amber-100 bg-white/90">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid grid-cols-1 md:grid-cols-3 gap-8">
        <section>
          <h2 className="font-display text-xl font-bold text-amber-900">Gaumaya Farm</h2>
          <p className="text-sm text-stone-600 mt-3 leading-relaxed">
            Trusted A2 dairy essentials crafted with traditional methods and transparent sourcing.
          </p>
        </section>

        <section>
          <h3 className="text-sm font-bold uppercase tracking-wide text-stone-700">Company</h3>
          <ul className="mt-3 space-y-2 text-sm text-stone-600">
            <li>
              <Link href="/" className="hover:text-amber-700">
                Home
              </Link>
            </li>
            <li>
              <Link href="/account" className="hover:text-amber-700">
                My Account
              </Link>
            </li>
            <li>
              <Link href="/wishlist" className="hover:text-amber-700">
                Wishlist
              </Link>
            </li>
          </ul>
        </section>

        <section>
          <h3 className="text-sm font-bold uppercase tracking-wide text-stone-700">Customer Care</h3>
          <p className="text-sm text-stone-600 mt-3">gaumayafarm@.com</p>
          <p className="text-sm text-stone-600">+91 xxxxxxxx</p>
          <Link
            href="/customer-care"
            className="inline-block mt-3 text-sm font-semibold text-amber-700 hover:text-amber-800"
          >
            Contact Customer Care
          </Link>
        </section>
      </div>
      <div className="border-t border-amber-100 py-4 text-center text-xs text-stone-500">
        © {new Date().getFullYear()} Gaumaya Farm. All rights reserved.
      </div>
    </footer>
  );
}
