import { create } from 'zustand';

interface CartItem {
  id: string; // Cart-unique ID
  productId: string;
  name: string;
  unit: string;
  quantity: number;
  price: number;
  costPrice?: number;
  discountType?: "NONE" | "RS" | "PERCENT";
  discountValue?: number;
  discountAmount?: number;
  lineTotal: number;
}

function calculateDiscountedLine(item: CartItem) {
  const gross = item.quantity * item.price;
  const discountValue = Number(item.discountValue || 0);
  let discountAmount = 0;

  if (item.discountType === "PERCENT") {
    discountAmount = gross * (Math.min(Math.max(discountValue, 0), 100) / 100);
  } else if (item.discountType === "RS") {
    discountAmount = Math.min(Math.max(discountValue, 0), gross);
  }

  return {
    ...item,
    discountType: discountAmount > 0 ? item.discountType : "NONE",
    discountValue: discountAmount > 0 ? discountValue : 0,
    discountAmount,
    lineTotal: gross - discountAmount,
  };
}

interface CartState {
  items: CartItem[];
  addItem: (item: CartItem) => void;
  updateQuantity: (id: string, q: number) => void;
  setItemDiscount: (id: string, discountType: "NONE" | "RS" | "PERCENT", discountValue: number) => void;
  removeItem: (id: string) => void;
  clearCart: () => void;
  setItems: (items: CartItem[]) => void;
  subtotal: number;
}

export const useCartStore = create<CartState>((set) => ({
  items: [],
  subtotal: 0,
  addItem: (item) => set((state) => {
    const existing = state.items.find(i => i.productId === item.productId && i.price === item.price);
    if (existing) {
      const updated = state.items.map(i => 
        i.productId === item.productId && i.price === item.price
        ? calculateDiscountedLine({ ...i, quantity: i.quantity + item.quantity })
        : i
      );
      return { items: updated, subtotal: updated.reduce((sum, i) => sum + i.lineTotal, 0) };
    }
    const newItems = [...state.items, calculateDiscountedLine({ ...item, discountType: item.discountType || "NONE", discountValue: item.discountValue || 0 })];
    return { items: newItems, subtotal: newItems.reduce((sum, i) => sum + i.lineTotal, 0) };
  }),
  updateQuantity: (id, q) => set((state) => {
    const updated = state.items.map(i => i.id === id ? calculateDiscountedLine({ ...i, quantity: q }) : i);
    return { items: updated, subtotal: updated.reduce((sum, i) => sum + i.lineTotal, 0) };
  }),
  setItemDiscount: (id, discountType, discountValue) => set((state) => {
    const updated = state.items.map(i => i.id === id ? calculateDiscountedLine({ ...i, discountType, discountValue }) : i);
    return { items: updated, subtotal: updated.reduce((sum, i) => sum + i.lineTotal, 0) };
  }),
  removeItem: (id) => set((state) => {
    const updated = state.items.filter(i => i.id !== id);
    return { items: updated, subtotal: updated.reduce((sum, i) => sum + i.lineTotal, 0) };
  }),
  clearCart: () => set({ items: [], subtotal: 0 }),
  setItems: (items) => {
    const calculated = items.map((item) => calculateDiscountedLine({ ...item, discountType: item.discountType || "NONE", discountValue: item.discountValue || 0 }));
    return set({ items: calculated, subtotal: calculated.reduce((sum, i) => sum + i.lineTotal, 0) });
  }
}));
