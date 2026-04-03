import type { Request, Response } from 'express';
import mongoose from 'mongoose';
import Product from '../models/Product.js';
import Wishlist from '../models/Wishlist.js';
import type { CustomerAuthRequest } from '../middleware/customerAuth.js';

interface WishlistBody {
  productId?: string;
}

const buildWishlistResponse = async (customerId: mongoose.Types.ObjectId) => {
  const wishlist = await Wishlist.findOne({ customer: customerId }).populate({
    path: 'items.product',
    select:
      'name description price size imageUrl imageGallery variants stockQuantity sku isFeatured ratingAverage ratingCount',
  });

  if (!wishlist) {
    return {
      items: [],
      count: 0,
    };
  }

  const items = wishlist.items
    .map((item) => {
      const product = item.product as unknown as {
        _id?: mongoose.Types.ObjectId;
        name?: string;
        description?: string;
        price?: number;
        size?: string;
        imageUrl?: string;
        imageGallery?: string[];
        variants?: Array<{
          label?: string;
          size?: string;
          price?: number;
          stockQuantity?: number;
          sku?: string;
          imageUrl?: string | null;
          isDefault?: boolean;
        }>;
        stockQuantity?: number;
        sku?: string;
        isFeatured?: boolean;
        ratingAverage?: number;
        ratingCount?: number;
      };

      if (!product?._id) {
        return null;
      }

      return {
        productId: product._id,
        addedAt: item.addedAt,
        product: {
          _id: product._id,
          name: product.name,
          description: product.description,
          price: product.price,
          size: product.size,
          imageUrl: product.imageUrl,
          imageGallery: product.imageGallery ?? [],
          variants: product.variants ?? [],
          stockQuantity: product.stockQuantity,
          sku: product.sku,
          isFeatured: product.isFeatured,
          ratingAverage: product.ratingAverage ?? 0,
          ratingCount: product.ratingCount ?? 0,
        },
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  return {
    items,
    count: items.length,
  };
};

const getCustomerObjectId = (req: Request<any, any, any, any>): mongoose.Types.ObjectId | null => {
  const customerId = (req as CustomerAuthRequest).customer?.id;

  if (!customerId || !mongoose.Types.ObjectId.isValid(customerId)) {
    return null;
  }

  return new mongoose.Types.ObjectId(customerId);
};

export const getWishlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerObjectId = getCustomerObjectId(req);

    if (!customerObjectId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const payload = await buildWishlistResponse(customerObjectId);

    res.status(200).json({
      success: true,
      ...payload,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to fetch wishlist' });
  }
};

export const addWishlistItem = async (
  req: Request<unknown, unknown, WishlistBody>,
  res: Response
): Promise<void> => {
  try {
    const customerObjectId = getCustomerObjectId(req);

    if (!customerObjectId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const productId = typeof req.body.productId === 'string' ? req.body.productId.trim() : '';

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      res.status(400).json({ success: false, message: 'Invalid product id' });
      return;
    }

    const product = await Product.findById(productId).select('_id');

    if (!product) {
      res.status(404).json({ success: false, message: 'Product not found' });
      return;
    }

    let wishlist = await Wishlist.findOne({ customer: customerObjectId });

    if (!wishlist) {
      wishlist = await Wishlist.create({
        customer: customerObjectId,
        items: [{ product: product._id, addedAt: new Date() }],
      });
    } else {
      const alreadyExists = wishlist.items.some(
        (item) => item.product.toString() === product._id.toString()
      );

      if (!alreadyExists) {
        wishlist.items.push({
          product: product._id,
          addedAt: new Date(),
        });
        await wishlist.save();
      }
    }

    const payload = await buildWishlistResponse(customerObjectId);

    res.status(200).json({
      success: true,
      message: 'Product added to wishlist',
      ...payload,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to add item to wishlist' });
  }
};

export const removeWishlistItem = async (
  req: Request<{ productId: string }>,
  res: Response
): Promise<void> => {
  try {
    const customerObjectId = getCustomerObjectId(req);

    if (!customerObjectId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    const { productId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(productId)) {
      res.status(400).json({ success: false, message: 'Invalid product id' });
      return;
    }

    await Wishlist.findOneAndUpdate(
      { customer: customerObjectId },
      {
        $pull: {
          items: {
            product: new mongoose.Types.ObjectId(productId),
          },
        },
      },
      {}
    );

    const payload = await buildWishlistResponse(customerObjectId);

    res.status(200).json({
      success: true,
      message: 'Product removed from wishlist',
      ...payload,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to remove item from wishlist' });
  }
};

export const clearWishlist = async (req: Request, res: Response): Promise<void> => {
  try {
    const customerObjectId = getCustomerObjectId(req);

    if (!customerObjectId) {
      res.status(401).json({ success: false, message: 'Unauthorized' });
      return;
    }

    await Wishlist.findOneAndUpdate(
      { customer: customerObjectId },
      {
        $set: {
          items: [],
        },
      },
      {}
    );

    res.status(200).json({
      success: true,
      message: 'Wishlist cleared successfully',
      items: [],
      count: 0,
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Failed to clear wishlist' });
  }
};
