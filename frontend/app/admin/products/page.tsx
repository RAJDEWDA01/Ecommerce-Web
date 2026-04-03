"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { buildApiUrl, resolveImageUrl } from '@/lib/api';
import { clearAdminToken, getAdminToken } from '@/lib/adminAuth';

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
  createdAt: string;
  updatedAt: string;
}

interface ProductVariant {
  label: string;
  size: string;
  price: number;
  stockQuantity: number;
  sku: string;
  imageUrl?: string | null;
  isDefault?: boolean;
}

interface ProductFormState {
  name: string;
  description: string;
  price: string;
  size: string;
  imageUrl: string;
  imageGalleryText: string;
  variantsJson: string;
  stockQuantity: string;
  sku: string;
  isFeatured: boolean;
}

interface ApiError {
  message?: string;
}

interface UploadImageResponse {
  success: boolean;
  message?: string;
  imageUrl?: string;
}

interface ImportImageFromUrlResponse extends UploadImageResponse {
  sourceUrl?: string;
}

interface BulkUpdateProductsResponse {
  success: boolean;
  message?: string;
  updatedCount?: number;
}

interface CsvParsedRow {
  sku: string;
  price?: number;
  stockQuantity?: number;
  isFeatured?: boolean;
}

const emptyForm: ProductFormState = {
  name: '',
  description: '',
  price: '',
  size: '',
  imageUrl: '',
  imageGalleryText: '',
  variantsJson: '',
  stockQuantity: '',
  sku: '',
  isFeatured: false,
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount);

const isAbsoluteHttpUrl = (value: string): boolean => /^https?:\/\//i.test(value.trim());

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (char === '"') {
      if (inQuotes && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const normalizeCsvHeader = (header: string): string =>
  header.trim().toLowerCase().replace(/[\s_-]+/g, '');

const parseBooleanCsvValue = (raw: string): boolean | null => {
  const normalized = raw.trim().toLowerCase();

  if (['true', '1', 'yes', 'y'].includes(normalized)) {
    return true;
  }

  if (['false', '0', 'no', 'n'].includes(normalized)) {
    return false;
  }

  return null;
};

const parseBulkUpdateCsv = (csvText: string): { rows: CsvParsedRow[]; errors: string[] } => {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) {
    return { rows: [], errors: ['CSV must include a header row and at least one data row'] };
  }

  const headers = parseCsvLine(lines[0]).map(normalizeCsvHeader);
  const skuIndex = headers.indexOf('sku');
  const priceIndex = headers.indexOf('price');
  const stockIndex = headers.findIndex((header) => ['stock', 'stockquantity'].includes(header));
  const featuredIndex = headers.findIndex((header) => ['isfeatured', 'featured'].includes(header));

  if (skuIndex === -1) {
    return { rows: [], errors: ['CSV header must include "sku" column'] };
  }

  const rows: CsvParsedRow[] = [];
  const errors: string[] = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const cells = parseCsvLine(lines[lineIndex]);
    const sku = cells[skuIndex]?.trim();

    if (!sku) {
      errors.push(`Row ${lineIndex + 1}: sku is required`);
      continue;
    }

    const row: CsvParsedRow = { sku };

    if (priceIndex >= 0 && cells[priceIndex]?.trim()) {
      const price = Number(cells[priceIndex]);
      if (!Number.isFinite(price) || price < 0) {
        errors.push(`Row ${lineIndex + 1}: price must be a non-negative number`);
        continue;
      }
      row.price = price;
    }

    if (stockIndex >= 0 && cells[stockIndex]?.trim()) {
      const stockQuantity = Number(cells[stockIndex]);
      if (!Number.isInteger(stockQuantity) || stockQuantity < 0) {
        errors.push(`Row ${lineIndex + 1}: stock quantity must be a non-negative integer`);
        continue;
      }
      row.stockQuantity = stockQuantity;
    }

    if (featuredIndex >= 0 && cells[featuredIndex]?.trim()) {
      const isFeatured = parseBooleanCsvValue(cells[featuredIndex]);
      if (isFeatured === null) {
        errors.push(`Row ${lineIndex + 1}: featured value must be true/false`);
        continue;
      }
      row.isFeatured = isFeatured;
    }

    if (
      row.price === undefined &&
      row.stockQuantity === undefined &&
      row.isFeatured === undefined
    ) {
      errors.push(`Row ${lineIndex + 1}: include at least one of price, stockQuantity, or isFeatured`);
      continue;
    }

    rows.push(row);
  }

  return { rows, errors };
};

export default function AdminProductsPage() {
  const router = useRouter();

  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [importingImageUrl, setImportingImageUrl] = useState(false);
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [csvImporting, setCsvImporting] = useState(false);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [bulkPriceAdjustmentPercent, setBulkPriceAdjustmentPercent] = useState('');
  const [bulkStockAdjustment, setBulkStockAdjustment] = useState('');
  const [bulkStockSetTo, setBulkStockSetTo] = useState('');
  const [bulkFeatureAction, setBulkFeatureAction] = useState<'no_change' | 'feature' | 'unfeature'>(
    'no_change'
  );
  const [form, setForm] = useState<ProductFormState>(emptyForm);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const totals = useMemo(() => {
    const totalProducts = products.length;
    const featuredProducts = products.filter((product) => product.isFeatured).length;
    const totalStock = products.reduce((sum, product) => sum + product.stockQuantity, 0);

    return { totalProducts, featuredProducts, totalStock };
  }, [products]);

  useEffect(() => {
    const token = getAdminToken();

    if (!token) {
      router.replace('/admin/login');
      return;
    }

    setAuthToken(token);
    setIsAuthChecking(false);
  }, [router]);

  const fetchProducts = useCallback(async () => {
    if (!authToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(buildApiUrl('/api/products'), {
        cache: 'no-store',
      });

      const data = (await response.json()) as Product[] | ApiError;

      if (!response.ok || !Array.isArray(data)) {
        throw new Error((data as ApiError).message || 'Failed to fetch products');
      }

      setProducts(data);
      setSelectedProductIds((previous) =>
        previous.filter((id) => data.some((product) => product._id === id))
      );
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : 'Unable to load products');
    } finally {
      setLoading(false);
    }
  }, [authToken]);

  useEffect(() => {
    void fetchProducts();
  }, [fetchProducts]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingProductId(null);
  };

  const handleEdit = (product: Product) => {
    setEditingProductId(product._id);
    setForm({
      name: product.name,
      description: product.description,
      price: String(product.price),
      size: product.size,
      imageUrl: product.imageUrl,
      imageGalleryText: (product.imageGallery ?? []).join('\n'),
      variantsJson:
        product.variants && product.variants.length > 0
          ? JSON.stringify(product.variants, null, 2)
          : '',
      stockQuantity: String(product.stockQuantity),
      sku: product.sku,
      isFeatured: product.isFeatured,
    });
    setSuccess(null);
    setError(null);
  };

  const handleDelete = async (productId: string) => {
    if (!authToken) {
      return;
    }

    const confirmed = window.confirm('Delete this product? This action cannot be undone.');

    if (!confirmed) {
      return;
    }

    try {
      setDeletingProductId(productId);
      setError(null);
      setSuccess(null);

      const response = await fetch(buildApiUrl(`/api/products/${productId}`), {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as ApiError;

      if (!response.ok) {
        throw new Error(data.message || 'Failed to delete product');
      }

      setProducts((prev) => prev.filter((product) => product._id !== productId));
      setSelectedProductIds((prev) => prev.filter((id) => id !== productId));
      if (editingProductId === productId) {
        resetForm();
      }
      setSuccess('Product deleted successfully');
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete product');
    } finally {
      setDeletingProductId(null);
    }
  };

  const handleImageUpload = async (file: File) => {
    if (!authToken) {
      return;
    }

    try {
      setUploadingImage(true);
      setError(null);
      setSuccess(null);

      const formData = new FormData();
      formData.append('image', file);

      const response = await fetch(buildApiUrl('/api/uploads/product-image'), {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
        body: formData,
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as UploadImageResponse;

      if (!response.ok || !data.success || !data.imageUrl) {
        throw new Error(data.message || 'Failed to upload image');
      }

      setForm((prev) => ({ ...prev, imageUrl: data.imageUrl as string }));
      setSuccess('Image uploaded successfully');
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Failed to upload image');
    } finally {
      setUploadingImage(false);
    }
  };

  const importImageFromRemoteUrl = async (sourceImageUrl: string): Promise<string> => {
    if (!authToken) {
      throw new Error('You must be logged in as admin to import image URLs');
    }

    const response = await fetch(buildApiUrl('/api/uploads/product-image-url'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ imageUrl: sourceImageUrl }),
    });

    if (response.status === 401 || response.status === 403) {
      clearAdminToken();
      router.replace('/admin/login');
      throw new Error('Admin session expired. Please login again.');
    }

    const data = (await response.json()) as ImportImageFromUrlResponse;

    if (!response.ok || !data.success || !data.imageUrl) {
      throw new Error(data.message || 'Failed to import image URL');
    }

    return data.imageUrl;
  };

  const handleImportImageUrl = async () => {
    const trimmedUrl = form.imageUrl.trim();

    if (!trimmedUrl) {
      setError('Enter an image URL to import');
      return;
    }

    if (!isAbsoluteHttpUrl(trimmedUrl)) {
      setError('Only absolute http(s) image URLs can be imported');
      return;
    }

    try {
      setImportingImageUrl(true);
      setError(null);
      setSuccess(null);

      const localImageUrl = await importImageFromRemoteUrl(trimmedUrl);
      setForm((prev) => ({ ...prev, imageUrl: localImageUrl }));
      setSuccess('External image imported to local uploads successfully');
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : 'Failed to import image URL');
    } finally {
      setImportingImageUrl(false);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!authToken) {
      return;
    }

    try {
      setSaving(true);
      setError(null);
      setSuccess(null);

      let parsedVariants: ProductVariant[] = [];

      if (form.variantsJson.trim()) {
        try {
          const parsed = JSON.parse(form.variantsJson);

          if (!Array.isArray(parsed)) {
            throw new Error('Variants JSON must be an array');
          }

          parsedVariants = parsed as ProductVariant[];
        } catch (parseError) {
          throw new Error(
            parseError instanceof Error
              ? `Invalid variants JSON: ${parseError.message}`
              : 'Invalid variants JSON'
          );
        }
      }

      const imageGallery = form.imageGalleryText
        .split(/\r?\n|,/)
        .map((entry) => entry.trim())
        .filter(Boolean);

      const importCache = new Map<string, string>();

      const importIfRemote = async (source: string): Promise<string> => {
        const normalizedSource = source.trim();

        if (!isAbsoluteHttpUrl(normalizedSource)) {
          return normalizedSource;
        }

        const cached = importCache.get(normalizedSource);
        if (cached) {
          return cached;
        }

        const localImageUrl = await importImageFromRemoteUrl(normalizedSource);
        importCache.set(normalizedSource, localImageUrl);
        return localImageUrl;
      };

      const normalizedMainImageUrl = await importIfRemote(form.imageUrl);
      const normalizedImageGallery = await Promise.all(imageGallery.map((entry) => importIfRemote(entry)));
      const normalizedVariants = await Promise.all(
        parsedVariants.map(async (variant) => {
          if (typeof variant.imageUrl !== 'string') {
            return variant;
          }

          return {
            ...variant,
            imageUrl: await importIfRemote(variant.imageUrl),
          };
        })
      );

      const payload = {
        name: form.name,
        description: form.description,
        price: Number(form.price),
        size: form.size,
        imageUrl: normalizedMainImageUrl,
        imageGallery: normalizedImageGallery,
        variants: normalizedVariants,
        stockQuantity: Number(form.stockQuantity),
        sku: form.sku,
        isFeatured: form.isFeatured,
      };

      const endpoint = editingProductId
        ? buildApiUrl(`/api/products/${editingProductId}`)
        : buildApiUrl('/api/products');

      const method = editingProductId ? 'PUT' : 'POST';

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(payload),
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as Product | ApiError;

      if (!response.ok || !('_id' in data)) {
        throw new Error((data as ApiError).message || 'Failed to save product');
      }

      const savedProduct = data as Product;

      setProducts((prev) => {
        if (editingProductId) {
          return prev.map((product) =>
            product._id === editingProductId ? savedProduct : product
          );
        }

        return [savedProduct, ...prev];
      });

      setSuccess(editingProductId ? 'Product updated successfully' : 'Product created successfully');
      resetForm();
      setSelectedProductIds([]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : 'Failed to save product');
    } finally {
      setSaving(false);
    }
  };

  const handleBulkUpdate = async () => {
    if (!authToken) {
      return;
    }

    if (selectedProductIds.length === 0) {
      setError('Select at least one product for bulk update');
      return;
    }

    const updates: Record<string, number | boolean> = {};

    if (bulkPriceAdjustmentPercent.trim()) {
      const parsedPriceAdjustment = Number(bulkPriceAdjustmentPercent);
      if (!Number.isFinite(parsedPriceAdjustment)) {
        setError('Price adjustment must be a valid number');
        return;
      }
      updates.priceAdjustmentPercent = parsedPriceAdjustment;
    }

    if (bulkStockAdjustment.trim()) {
      const parsedStockAdjustment = Number(bulkStockAdjustment);
      if (!Number.isInteger(parsedStockAdjustment)) {
        setError('Stock adjustment must be an integer');
        return;
      }
      updates.stockAdjustment = parsedStockAdjustment;
    }

    if (bulkStockSetTo.trim()) {
      const parsedStockSetTo = Number(bulkStockSetTo);
      if (!Number.isInteger(parsedStockSetTo) || parsedStockSetTo < 0) {
        setError('Set exact stock must be a non-negative integer');
        return;
      }
      updates.stockSetTo = parsedStockSetTo;
    }

    if (updates.stockAdjustment !== undefined && updates.stockSetTo !== undefined) {
      setError('Use either stock adjustment or set exact stock, not both');
      return;
    }

    if (bulkFeatureAction === 'feature') {
      updates.isFeatured = true;
    } else if (bulkFeatureAction === 'unfeature') {
      updates.isFeatured = false;
    }

    if (Object.keys(updates).length === 0) {
      setError('Choose at least one bulk action to apply');
      return;
    }

    try {
      setBulkUpdating(true);
      setError(null);
      setSuccess(null);

      const response = await fetch(buildApiUrl('/api/products/bulk'), {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          productIds: selectedProductIds,
          updates,
        }),
      });

      if (response.status === 401 || response.status === 403) {
        clearAdminToken();
        router.replace('/admin/login');
        return;
      }

      const data = (await response.json()) as BulkUpdateProductsResponse;

      if (!response.ok || !data.success) {
        throw new Error(data.message || 'Failed to apply bulk updates');
      }

      setSuccess(data.message || `Updated ${data.updatedCount ?? selectedProductIds.length} products`);
      setSelectedProductIds([]);
      setBulkPriceAdjustmentPercent('');
      setBulkStockAdjustment('');
      setBulkStockSetTo('');
      setBulkFeatureAction('no_change');
      await fetchProducts();
    } catch (bulkUpdateError) {
      setError(
        bulkUpdateError instanceof Error ? bulkUpdateError.message : 'Failed to apply bulk updates'
      );
    } finally {
      setBulkUpdating(false);
    }
  };

  const handleCsvImport = async (file: File) => {
    if (!authToken) {
      return;
    }

    try {
      setCsvImporting(true);
      setError(null);
      setSuccess(null);

      const csvText = await file.text();
      const parsed = parseBulkUpdateCsv(csvText);

      const validRowsBySku = new Map<string, CsvParsedRow>();
      for (const row of parsed.rows) {
        validRowsBySku.set(row.sku.trim().toUpperCase(), row);
      }

      const productBySku = new Map(
        products.map((product) => [product.sku.trim().toUpperCase(), product])
      );

      const unknownSkuRows: string[] = [];
      const requests: Array<Promise<{ sku: string; ok: boolean; message?: string }>> = [];

      for (const [sku, row] of validRowsBySku.entries()) {
        const target = productBySku.get(sku);

        if (!target) {
          unknownSkuRows.push(row.sku);
          continue;
        }

        const payload: Record<string, unknown> = {};
        if (row.price !== undefined) {
          payload.price = row.price;
        }
        if (row.stockQuantity !== undefined) {
          payload.stockQuantity = row.stockQuantity;
        }
        if (row.isFeatured !== undefined) {
          payload.isFeatured = row.isFeatured;
        }

        requests.push(
          (async () => {
            const response = await fetch(buildApiUrl(`/api/products/${target._id}`), {
              method: 'PUT',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${authToken}`,
              },
              body: JSON.stringify(payload),
            });

            if (response.status === 401 || response.status === 403) {
              clearAdminToken();
              router.replace('/admin/login');
              return { sku: row.sku, ok: false, message: 'Admin session expired' };
            }

            const data = (await response.json()) as Product | ApiError;

            if (!response.ok) {
              return {
                sku: row.sku,
                ok: false,
                message: (data as ApiError).message || 'Update failed',
              };
            }

            return { sku: row.sku, ok: true };
          })()
        );
      }

      const results = await Promise.all(requests);
      const successCount = results.filter((result) => result.ok).length;
      const failedRows = results.filter((result) => !result.ok);

      const summary: string[] = [];
      if (successCount > 0) {
        summary.push(`updated ${successCount}`);
      }
      if (unknownSkuRows.length > 0) {
        summary.push(`unknown SKU ${unknownSkuRows.length}`);
      }
      if (failedRows.length > 0) {
        summary.push(`failed ${failedRows.length}`);
      }
      if (parsed.errors.length > 0) {
        summary.push(`parse issues ${parsed.errors.length}`);
      }

      if (successCount === 0) {
        throw new Error(
          [
            'No products were updated from CSV.',
            parsed.errors[0] ? `First parse issue: ${parsed.errors[0]}` : '',
            unknownSkuRows[0] ? `Unknown SKU example: ${unknownSkuRows[0]}` : '',
            failedRows[0]?.message ? `First API failure: ${failedRows[0].sku} - ${failedRows[0].message}` : '',
          ]
            .filter(Boolean)
            .join(' ')
        );
      }

      setSuccess(
        `CSV import completed: ${summary.join(', ')}.${
          parsed.errors[0] ? ` First parse issue: ${parsed.errors[0]}` : ''
        }`
      );
      await fetchProducts();
    } catch (csvImportError) {
      setError(csvImportError instanceof Error ? csvImportError.message : 'CSV import failed');
    } finally {
      setCsvImporting(false);
    }
  };

  const allProductsSelected =
    products.length > 0 && selectedProductIds.length === products.length;

  const handleLogout = () => {
    clearAdminToken();
    router.replace('/admin/login');
  };

  if (isAuthChecking || loading) {
    return (
      <main className="min-h-screen bg-stone-50 px-4 py-8 sm:px-6 sm:py-10 lg:p-10 flex items-center justify-center">
        <p className="text-lg text-stone-700">Loading products...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-stone-50 px-4 py-6 sm:px-6 sm:py-8 lg:p-10">
      <div className="max-w-7xl mx-auto space-y-8">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl sm:text-4xl font-black text-stone-900">Product Management</h1>
            <p className="text-stone-600 mt-2">Create, update, and control your catalog inventory.</p>
          </div>
          <button
            type="button"
            onClick={handleLogout}
            className="self-start md:self-auto bg-stone-800 hover:bg-black text-white px-4 py-2 rounded-lg text-sm font-semibold"
          >
            Logout
          </button>
        </div>

        <div className="flex flex-wrap gap-2 border-b border-stone-200 pb-3">
          <Link href="/admin/orders" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Orders
          </Link>
          <Link href="/admin/products" className="px-3 py-2 rounded-lg text-sm font-semibold bg-amber-100 text-amber-800">
            Products
          </Link>
          <Link href="/admin/payments" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Payments
          </Link>
          <Link href="/admin/coupons" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Coupons
          </Link>
          <Link href="/admin/support" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Support
          </Link>
          <Link href="/admin/feedback" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Feedback
          </Link>
          <Link href="/admin/audit" className="px-3 py-2 rounded-lg text-sm font-semibold text-stone-600 hover:bg-stone-100">
            Audit
          </Link>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Total Products</p>
            <p className="text-3xl font-black text-stone-900 mt-1">{totals.totalProducts}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Featured</p>
            <p className="text-3xl font-black text-amber-700 mt-1">{totals.featuredProducts}</p>
          </div>
          <div className="rounded-2xl border border-stone-200 bg-white p-5">
            <p className="text-sm text-stone-500">Total Stock</p>
            <p className="text-3xl font-black text-emerald-700 mt-1">{totals.totalStock}</p>
          </div>
        </div>

        <section className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-5">
            <h2 className="text-xl sm:text-2xl font-bold text-stone-900">
              {editingProductId ? 'Edit Product' : 'Add New Product'}
            </h2>
            {editingProductId && (
              <button
                type="button"
                onClick={resetForm}
                className="text-sm font-semibold text-stone-600 hover:text-stone-900"
              >
                Cancel Edit
              </button>
            )}
          </div>

          <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <input
              required
              placeholder="Product Name"
              value={form.name}
              onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
              className="border border-stone-300 rounded-lg px-4 py-2.5"
            />
            <input
              required
              placeholder="SKU"
              value={form.sku}
              onChange={(e) => setForm((prev) => ({ ...prev, sku: e.target.value }))}
              className="border border-stone-300 rounded-lg px-4 py-2.5"
            />
            <input
              required
              type="number"
              min="0"
              step="0.01"
              placeholder="Price"
              value={form.price}
              onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
              className="border border-stone-300 rounded-lg px-4 py-2.5"
            />
            <input
              required
              type="number"
              min="0"
              step="1"
              placeholder="Stock Quantity"
              value={form.stockQuantity}
              onChange={(e) => setForm((prev) => ({ ...prev, stockQuantity: e.target.value }))}
              className="border border-stone-300 rounded-lg px-4 py-2.5"
            />
            <input
              required
              placeholder="Size (e.g. 500ml)"
              value={form.size}
              onChange={(e) => setForm((prev) => ({ ...prev, size: e.target.value }))}
              className="border border-stone-300 rounded-lg px-4 py-2.5"
            />
            <div className="flex flex-col gap-2">
              <input
                required
                placeholder="Image URL"
                value={form.imageUrl}
                onChange={(e) => setForm((prev) => ({ ...prev, imageUrl: e.target.value }))}
                className="border border-stone-300 rounded-lg px-4 py-2.5"
              />
              <button
                type="button"
                onClick={() => {
                  void handleImportImageUrl();
                }}
                disabled={importingImageUrl || uploadingImage}
                className="self-start rounded-lg bg-stone-200 hover:bg-stone-300 disabled:bg-stone-100 disabled:text-stone-400 px-3 py-1.5 text-xs font-semibold text-stone-700"
              >
                {importingImageUrl ? 'Importing URL...' : 'Import URL to Local Uploads'}
              </button>
            </div>
            <textarea
              placeholder="Additional image URLs (one per line)"
              value={form.imageGalleryText}
              onChange={(e) => setForm((prev) => ({ ...prev, imageGalleryText: e.target.value }))}
              className="border border-stone-300 rounded-lg px-4 py-2.5 md:col-span-2 min-h-20"
            />
            <textarea
              placeholder='Variants JSON (optional), e.g. [{"label":"200ml","size":"200ml","price":320,"stockQuantity":30,"sku":"GF-GHEE-200","isDefault":false},{"label":"500ml","size":"500ml","price":650,"stockQuantity":40,"sku":"GF-GHEE-500","isDefault":true},{"label":"1kg","size":"1kg","price":1250,"stockQuantity":20,"sku":"GF-GHEE-1KG","isDefault":false}]'
              value={form.variantsJson}
              onChange={(e) => setForm((prev) => ({ ...prev, variantsJson: e.target.value }))}
              className="border border-stone-300 rounded-lg px-4 py-2.5 md:col-span-2 min-h-28 font-mono text-xs"
            />
            <div className="md:col-span-2 rounded-lg border border-stone-200 bg-stone-50 p-3">
              <label className="block text-sm font-semibold text-stone-700 mb-2">
                Upload Product Image
              </label>
              <div className="flex flex-col md:flex-row md:items-center gap-3">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/avif"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      void handleImageUpload(file);
                      e.currentTarget.value = '';
                    }
                  }}
                  className="text-sm text-stone-600"
                />
                {uploadingImage && <span className="text-sm text-amber-700 font-medium">Uploading image...</span>}
              </div>
              {form.imageUrl && (
                <Image
                  src={resolveImageUrl(form.imageUrl)}
                  alt="Product preview"
                  width={96}
                  height={96}
                  className="mt-3 h-24 w-24 rounded-lg border border-stone-200 object-cover bg-white"
                />
              )}
            </div>
            <textarea
              required
              placeholder="Description"
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              className="border border-stone-300 rounded-lg px-4 py-2.5 md:col-span-2 min-h-24"
            />
            <label className="flex items-center gap-2 text-sm font-medium text-stone-700 md:col-span-2">
              <input
                type="checkbox"
                checked={form.isFeatured}
                onChange={(e) => setForm((prev) => ({ ...prev, isFeatured: e.target.checked }))}
              />
              Mark as featured product
            </label>

            <div className="md:col-span-2 flex flex-col sm:flex-row gap-3">
              <button
                type="submit"
                disabled={saving}
                className="bg-amber-600 hover:bg-amber-700 disabled:bg-amber-400 text-white font-semibold px-5 py-2.5 rounded-lg"
              >
                {saving ? 'Saving...' : editingProductId ? 'Update Product' : 'Create Product'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-stone-200 hover:bg-stone-300 text-stone-800 font-semibold px-5 py-2.5 rounded-lg"
              >
                Reset
              </button>
            </div>
          </form>
        </section>

        <section className="rounded-2xl border border-blue-200 bg-blue-50 p-4 sm:p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <h2 className="text-xl sm:text-2xl font-bold text-blue-900">Bulk Product Actions</h2>
            <p className="text-sm text-blue-700">
              Selected: <span className="font-semibold">{selectedProductIds.length}</span>
            </p>
          </div>
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            <input
              type="number"
              step="0.1"
              value={bulkPriceAdjustmentPercent}
              onChange={(event) => setBulkPriceAdjustmentPercent(event.target.value)}
              placeholder="Price change (%) e.g. 10 or -5"
              className="border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white"
            />
            <input
              type="number"
              step="1"
              value={bulkStockAdjustment}
              onChange={(event) => setBulkStockAdjustment(event.target.value)}
              placeholder="Stock adjustment (units)"
              className="border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white"
            />
            <input
              type="number"
              step="1"
              min="0"
              value={bulkStockSetTo}
              onChange={(event) => setBulkStockSetTo(event.target.value)}
              placeholder="Set exact stock (units)"
              className="border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white"
            />
            <select
              value={bulkFeatureAction}
              onChange={(event) =>
                setBulkFeatureAction(event.target.value as 'no_change' | 'feature' | 'unfeature')
              }
              className="border border-blue-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="no_change">Featured: no change</option>
              <option value="feature">Mark as featured</option>
              <option value="unfeature">Remove featured</option>
            </select>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelectedProductIds(allProductsSelected ? [] : products.map((p) => p._id))}
              className="bg-white hover:bg-blue-100 text-blue-800 border border-blue-300 px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {allProductsSelected ? 'Clear Selection' : 'Select All on Page'}
            </button>
            <button
              type="button"
              disabled={bulkUpdating || selectedProductIds.length === 0}
              onClick={() => {
                void handleBulkUpdate();
              }}
              className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-300 text-white px-4 py-2 rounded-lg text-sm font-semibold"
            >
              {bulkUpdating ? 'Applying...' : 'Apply Bulk Updates'}
            </button>
            <label className="bg-white hover:bg-blue-100 text-blue-800 border border-blue-300 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer">
              {csvImporting ? 'Importing CSV...' : 'Upload CSV'}
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                disabled={csvImporting}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleCsvImport(file);
                    event.currentTarget.value = '';
                  }
                }}
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-blue-700">
            Note: Use either stock adjustment or set exact stock. CSV columns supported: sku (required), price, stockQuantity, isFeatured.
          </p>
        </section>

        {error && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {success && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-emerald-700 text-sm">
            {success}
          </div>
        )}

        <section className="space-y-4">
          {products.map((product) => (
            <article key={product._id} className="rounded-2xl border border-stone-200 bg-white p-4 sm:p-5 shadow-sm">
              <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                <div>
                  <h3 className="text-xl font-bold text-stone-900">{product.name}</h3>
                  <label className="mt-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-stone-600">
                    <input
                      type="checkbox"
                      checked={selectedProductIds.includes(product._id)}
                      onChange={(event) => {
                        setSelectedProductIds((previous) => {
                          if (event.target.checked) {
                            return previous.includes(product._id)
                              ? previous
                              : [...previous, product._id];
                          }
                          return previous.filter((id) => id !== product._id);
                        });
                      }}
                    />
                    Select
                  </label>
                  <p className="text-sm text-stone-600 mt-1">SKU: {product.sku}</p>
                  <p className="text-sm text-stone-600">Size: {product.size}</p>
                  <p className="text-sm text-stone-600">Stock: {product.stockQuantity}</p>
                  <p className="text-sm text-stone-600">Price: {formatCurrency(product.price)}</p>
                  <p className="text-sm text-stone-600">Variants: {product.variants?.length ?? 0}</p>
                  <p className="text-sm text-stone-600">
                    Rating: {product.ratingAverage ?? 0}/5 ({product.ratingCount ?? 0})
                  </p>
                </div>
                <Image
                  src={resolveImageUrl(product.imageUrl)}
                  alt={product.name}
                  width={80}
                  height={80}
                  className="h-20 w-20 rounded-lg border border-stone-200 object-cover bg-white"
                />
                <div className="flex flex-wrap gap-2">
                  {product.isFeatured && (
                    <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-semibold h-fit">
                      Featured
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => handleEdit(product)}
                    className="bg-blue-600 hover:bg-blue-700 text-white px-3 py-2 rounded-lg text-sm font-semibold"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    disabled={deletingProductId === product._id}
                    onClick={() => handleDelete(product._id)}
                    className="bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white px-3 py-2 rounded-lg text-sm font-semibold"
                  >
                    {deletingProductId === product._id ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
              <p className="text-sm text-stone-700 mt-3">{product.description}</p>
            </article>
          ))}
        </section>
      </div>
    </main>
  );
}
