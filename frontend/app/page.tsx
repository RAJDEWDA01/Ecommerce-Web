import { buildApiUrl, resolveImageUrl } from '@/lib/api';
import Link from 'next/link';
import Image from 'next/image';
import DeferredProductCardActions from '@/components/DeferredProductCardActions';

interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  size: string;
  imageUrl: string;
  stockQuantity: number;
  sku: string;
  isFeatured: boolean;
}

interface ProductPaginationMeta {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

interface ProductListResponse {
  success: boolean;
  message?: string;
  count: number;
  products: Product[];
  pagination: ProductPaginationMeta;
}

interface CatalogFilters {
  page: number;
  limit: number;
  search: string;
  featured: 'all' | 'true' | 'false';
  inStock: 'all' | 'true' | 'false';
  sortBy: 'createdAt' | 'price' | 'name' | 'stockQuantity';
  sortOrder: 'asc' | 'desc';
}

const LIMIT_OPTIONS = [12, 24, 48] as const;

const parsePositiveInteger = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    return fallback;
  }

  return parsed;
};

const parseCatalogFilters = (searchParams?: Record<string, string | string[] | undefined>): CatalogFilters => {
  const page = parsePositiveInteger(
    typeof searchParams?.page === 'string' ? searchParams.page : undefined,
    1
  );
  const limitRaw = parsePositiveInteger(
    typeof searchParams?.limit === 'string' ? searchParams.limit : undefined,
    12
  );
  const limit = LIMIT_OPTIONS.includes(limitRaw as (typeof LIMIT_OPTIONS)[number]) ? limitRaw : 12;
  const search = typeof searchParams?.search === 'string' ? searchParams.search.trim() : '';
  const featuredRaw = typeof searchParams?.featured === 'string' ? searchParams.featured : 'all';
  const inStockRaw = typeof searchParams?.inStock === 'string' ? searchParams.inStock : 'all';
  const sortByRaw = typeof searchParams?.sortBy === 'string' ? searchParams.sortBy : 'createdAt';
  const sortOrderRaw = typeof searchParams?.sortOrder === 'string' ? searchParams.sortOrder : 'desc';

  const featured: CatalogFilters['featured'] =
    featuredRaw === 'true' || featuredRaw === 'false' ? featuredRaw : 'all';
  const inStock: CatalogFilters['inStock'] =
    inStockRaw === 'true' || inStockRaw === 'false' ? inStockRaw : 'all';
  const sortBy: CatalogFilters['sortBy'] =
    sortByRaw === 'price' || sortByRaw === 'name' || sortByRaw === 'stockQuantity'
      ? sortByRaw
      : 'createdAt';
  const sortOrder: CatalogFilters['sortOrder'] = sortOrderRaw === 'asc' ? 'asc' : 'desc';

  return { page, limit, search, featured, inStock, sortBy, sortOrder };
};

const toCatalogQueryString = (
  filters: CatalogFilters,
  overrides?: Partial<CatalogFilters>
): string => {
  const merged: CatalogFilters = { ...filters, ...overrides };
  const query = new URLSearchParams();

  query.set('includeMeta', 'true');
  query.set('page', String(merged.page));
  query.set('limit', String(merged.limit));
  query.set('sortBy', merged.sortBy);
  query.set('sortOrder', merged.sortOrder);

  if (merged.search) {
    query.set('search', merged.search);
  }

  if (merged.featured !== 'all') {
    query.set('featured', merged.featured);
  }

  if (merged.inStock !== 'all') {
    query.set('inStock', merged.inStock);
  }

  return query.toString();
};

async function getProducts(filters: CatalogFilters): Promise<ProductListResponse> {
  const res = await fetch(buildApiUrl(`/api/products?${toCatalogQueryString(filters)}`), {
    cache: 'no-store',
  });

  if (!res.ok) {
    throw new Error('Failed to fetch products');
  }

  const data = (await res.json()) as ProductListResponse;

  if (!data.success || !Array.isArray(data.products) || !data.pagination) {
    throw new Error(data.message || 'Invalid products response');
  }

  return data;
}

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const filters = parseCatalogFilters(resolvedSearchParams);

  let data: ProductListResponse | null = null;
  let fetchError: string | null = null;

  try {
    data = await getProducts(filters);
  } catch (error) {
    fetchError = error instanceof Error ? error.message : 'Failed to fetch products';
  }

  const products = data?.products ?? [];
  const pagination = data?.pagination;
  const hasFiltersApplied =
    Boolean(filters.search) ||
    filters.featured !== 'all' ||
    filters.inStock !== 'all' ||
    filters.sortBy !== 'createdAt' ||
    filters.sortOrder !== 'desc' ||
    filters.limit !== 12;
  const hasPreviousPage = Boolean(pagination?.hasPreviousPage);
  const hasNextPage = Boolean(pagination?.hasNextPage);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-6xl mx-auto relative">
        <header className="mb-8 sm:mb-12 lg:mb-14 text-center bg-white border border-amber-100 rounded-3xl px-5 py-8 sm:px-10 sm:py-12">
          <p className="inline-flex items-center gap-2 rounded-full border border-amber-200 bg-amber-50 px-4 py-1 text-xs uppercase tracking-[0.24em] text-amber-700 font-semibold">
            Farm Fresh Collection
          </p>
          <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold text-amber-900 tracking-tight mt-4">
            Gaumaya Farm
          </h1>
          <p className="text-base sm:text-lg text-amber-800/90 mt-3 font-medium">
            Traditional bilona-crafted A2 essentials with trusted farm quality.
          </p>
        </header>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 shadow-sm mb-6">
          <form method="GET" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
            <input
              type="text"
              name="search"
              defaultValue={filters.search}
              placeholder="Search name, SKU, description"
              className="lg:col-span-2 border border-stone-300 rounded-lg px-3 py-2 text-sm"
            />
            <select
              name="featured"
              defaultValue={filters.featured}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Products</option>
              <option value="true">Featured Only</option>
              <option value="false">Non-featured</option>
            </select>
            <select
              name="inStock"
              defaultValue={filters.inStock}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="all">All Stock</option>
              <option value="true">In Stock</option>
              <option value="false">Out of Stock</option>
            </select>
            <select
              name="sortBy"
              defaultValue={filters.sortBy}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="createdAt">Newest</option>
              <option value="price">Price</option>
              <option value="name">Name</option>
              <option value="stockQuantity">Stock</option>
            </select>
            <select
              name="sortOrder"
              defaultValue={filters.sortOrder}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              <option value="desc">Descending</option>
              <option value="asc">Ascending</option>
            </select>
            <select
              name="limit"
              defaultValue={String(filters.limit)}
              className="border border-stone-300 rounded-lg px-3 py-2 text-sm"
            >
              {LIMIT_OPTIONS.map((limit) => (
                <option key={limit} value={limit}>
                  {limit} per page
                </option>
              ))}
            </select>
            <div className="lg:col-span-2 flex gap-2">
              <button
                type="submit"
                className="flex-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg px-3 py-2 text-sm font-semibold"
              >
                Apply
              </button>
              <Link
                href="/"
                className="flex-1 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-lg px-3 py-2 text-sm font-semibold text-center"
              >
                Reset
              </Link>
            </div>
          </form>
          <div className="mt-3 text-sm text-stone-600">
            {pagination ? (
              <p>
                Showing {products.length} of {pagination.totalCount} products
                {hasFiltersApplied ? ' (filtered)' : ''}.
              </p>
            ) : (
              <p>Showing {products.length} products.</p>
            )}
          </div>
        </section>

        {fetchError && (
          <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
            {fetchError}
          </div>
        )}

        {products.length === 0 ? (
          <div className="rounded-2xl border border-stone-200 bg-white p-8 text-center text-stone-600">
            No products found for current filters.
          </div>
        ) : (
          <div id="products" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 sm:gap-6 lg:gap-8">
            {products.map((product, index) => (
              <article
                key={product._id}
                className="bg-white rounded-2xl shadow-sm overflow-hidden border border-stone-100"
              >
                <Link href={`/products/${product._id}`} className="group block">
                  <div className="relative h-56 sm:h-64 lg:h-72 w-full bg-white flex items-center justify-center">
                    <Image
                      src={resolveImageUrl(product.imageUrl)}
                      alt={product.name}
                      fill
                      priority={index === 0}
                      sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                      className="object-contain p-4 sm:p-6"
                    />
                    {product.isFeatured && (
                      <span className="absolute left-3 top-3 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800">
                        Featured
                      </span>
                    )}
                  </div>
                </Link>
                <div className="p-4 sm:p-6 bg-stone-50 border-t border-stone-100">
                  <h2 className="text-xl font-bold text-stone-800">
                    <Link href={`/products/${product._id}`} className="hover:text-amber-700">
                      {product.name}
                    </Link>
                  </h2>
                  <p className="text-stone-500 text-sm mt-2 line-clamp-2">{product.description}</p>
                  <div className="mt-2 text-xs text-stone-500">
                    {product.stockQuantity > 0 ? (
                      <span className="text-emerald-700 font-semibold">In stock ({product.stockQuantity})</span>
                    ) : (
                      <span className="text-red-700 font-semibold">Out of stock</span>
                    )}
                  </div>
                  <div className="mt-6 flex justify-between items-center gap-3">
                    <div className="flex flex-col">
                      <span className="text-xs text-stone-400 font-semibold uppercase">{product.size}</span>
                      <span className="text-2xl font-black text-amber-600">₹{product.price}</span>
                    </div>
                    <div className="flex items-center justify-end">
                      <Link
                        href={`/products/${product._id}`}
                        className="rounded-xl border border-stone-300 bg-white hover:bg-stone-100 px-3 py-2 text-xs font-semibold text-stone-700"
                      >
                        View Details
                      </Link>
                      <div className="ml-2">
                        <DeferredProductCardActions product={product} />
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <section className="mt-6 rounded-2xl border border-stone-200 bg-white p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-stone-600">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Link
                  href={`/?${toCatalogQueryString(filters, { page: Math.max(1, filters.page - 1) })}`}
                  aria-disabled={!hasPreviousPage}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                    hasPreviousPage
                      ? 'bg-stone-200 hover:bg-stone-300 text-stone-800'
                      : 'bg-stone-100 text-stone-400 pointer-events-none'
                  }`}
                >
                  Previous
                </Link>
                <Link
                  href={`/?${toCatalogQueryString(filters, { page: filters.page + 1 })}`}
                  aria-disabled={!hasNextPage}
                  className={`rounded-lg px-4 py-2 text-sm font-semibold ${
                    hasNextPage
                      ? 'bg-amber-600 hover:bg-amber-700 text-white'
                      : 'bg-amber-200 text-amber-100 pointer-events-none'
                  }`}
                >
                  Next
                </Link>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
