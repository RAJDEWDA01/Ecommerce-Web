import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface CartItem {
  _id: string;
  productId: string;
  name: string;
  price: number;
  imageUrl: string;
  quantity: number;
  size: string;
  sku?: string;
  variantSku?: string | null;
  variantLabel?: string | null;
}

export interface AppliedCoupon {
  code: string;
  discountAmount: number;
  finalAmount: number;
}

interface CartState {
  items: CartItem[];
  appliedCoupon: AppliedCoupon | null;
  addToCart: (item: Omit<CartItem, 'quantity'>) => void;
  removeFromCart: (id: string) => void;
  setAppliedCoupon: (coupon: AppliedCoupon | null) => void;
  clearCart: () => void;
  getTotalItems: () => number;
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      appliedCoupon: null,

      addToCart: (product) => {
        set((state) => {
          const existingItem = state.items.find((item) => item._id === product._id);

          if (existingItem) {
            return {
              items: state.items.map((item) =>
                item._id === product._id
                  ? { ...item, quantity: item.quantity + 1 }
                  : item
              ),
            };
          }

          return { items: [...state.items, { ...product, quantity: 1 }] };
        });
      },

      removeFromCart: (id) => {
        set((state) => ({
          items: state.items.filter((item) => item._id !== id),
        }));
      },

      setAppliedCoupon: (coupon) => {
        set({ appliedCoupon: coupon });
      },

      clearCart: () => set({ items: [], appliedCoupon: null }),

      getTotalItems: () => {
        return get().items.reduce((total, item) => total + item.quantity, 0);
      },
    }),
    {
      name: 'gaumaya-cart-v2',
    }
  )
);
