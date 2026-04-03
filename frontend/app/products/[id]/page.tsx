import { notFound } from 'next/navigation';
import { buildApiUrl } from '@/lib/api';
import ProductDetailsClient from '@/components/ProductDetailsClient';

interface ProductVariant {
  label: string;
  size: string;
  price: number;
  stockQuantity: number;
  sku: string;
  imageUrl?: string | null;
  isDefault: boolean;
}

interface ProductReview {
  _id?: string;
  customerName: string;
  rating: number;
  title?: string | null;
  comment: string;
  isVerifiedPurchase: boolean;
  createdAt: string;
}

interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  size: string;
  imageUrl: string;
  imageGallery?: string[];
  variants?: ProductVariant[];
  stockQuantity: number;
  sku: string;
  isFeatured: boolean;
  ratingAverage?: number;
  ratingCount?: number;
  reviews?: ProductReview[];
}

interface ProductListResponse {
  success: boolean;
  message?: string;
  products?: Product[];
}

const getProductById = async (id: string): Promise<Product | null> => {
  const response = await fetch(buildApiUrl(`/api/products/${id}`), {
    next: { revalidate: 120 },
  });

  if (response.status === 404 || response.status === 400) {
    return null;
  }

  if (!response.ok) {
    throw new Error('Failed to fetch product details');
  }

  const product = (await response.json()) as Product;

  if (!product || !product._id) {
    throw new Error('Invalid product details response');
  }

  return product;
};

const getRelatedProducts = async (currentProduct: Product): Promise<Product[]> => {
  const keyword =
    currentProduct.name
      .split(/\s+/)
      .find((part) => part.length >= 4 && /^[a-z0-9]+$/i.test(part)) ?? '';

  const query = new URLSearchParams({
    includeMeta: 'true',
    limit: '8',
    sortBy: 'createdAt',
    sortOrder: 'desc',
    inStock: 'true',
  });

  if (keyword) {
    query.set('search', keyword);
  }

  const response = await fetch(buildApiUrl(`/api/products?${query.toString()}`), {
    next: { revalidate: 120 },
  });

  if (!response.ok) {
    return [];
  }

  const data = (await response.json()) as ProductListResponse;

  if (!data.success || !Array.isArray(data.products)) {
    return [];
  }

  return data.products.filter((product) => product._id !== currentProduct._id).slice(0, 4);
};

export default async function ProductDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = await getProductById(id);

  if (!product) {
    notFound();
  }

  const relatedProducts = await getRelatedProducts(product);

  return <ProductDetailsClient product={product} relatedProducts={relatedProducts} />;
}
