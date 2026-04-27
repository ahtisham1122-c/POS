import { create } from "zustand";

export interface CartItem {
  id: string;
  productId: string;
  name: string;
  unit: string;
  qty: number;
  unitPrice: number;
  lineTotal: number;
}

export interface HeldBill {
  id: string;
  items: CartItem[];
  customerId: string | null;
  customerName: string;
  paymentType: "CASH" | "CREDIT" | "PARTIAL";
  amountPaid: number;
  discountType: "NONE" | "FLAT" | "PERCENTAGE";
  discountValue: number;
  timestamp: string;
}

interface CartState {
  items: CartItem[];
  customerId: string | null;
  customerName: string;
  paymentType: "CASH" | "CREDIT" | "PARTIAL";
  amountPaid: number;
  discountType: "NONE" | "FLAT" | "PERCENTAGE";
  discountValue: number;
  heldBills: HeldBill[];
  
  addItem: (product: any, qty: number, unitPrice: number) => void;
  removeItem: (productId: string) => void;
  updateQty: (productId: string, qty: number) => void;
  setCustomer: (id: string | null, name: string) => void;
  setPaymentType: (type: "CASH" | "CREDIT" | "PARTIAL") => void;
  setAmountPaid: (amount: number) => void;
  setDiscount: (type: "NONE" | "FLAT" | "PERCENTAGE", value: number) => void;
  clearCart: () => void;
  holdBill: () => void;
  resumeBill: (id: string) => void;
  deleteHeldBill: (id: string) => void;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  customerId: null,
  customerName: "Walk-in Customer",
  paymentType: "CASH",
  amountPaid: 0,
  discountType: "NONE",
  discountValue: 0,
  heldBills: [],

  addItem: (product, qty, unitPrice) => {
    const items = get().items;
    const existing = items.find((i) => i.productId === product.id);
    
    if (existing) {
      const newQty = existing.qty + qty;
      set({
        items: items.map((i) =>
          i.productId === product.id
            ? { ...i, qty: newQty, lineTotal: newQty * unitPrice }
            : i
        ),
      });
    } else {
      set({
        items: [
          ...items,
          {
            id: Math.random().toString(36).substr(2, 9),
            productId: product.id,
            name: product.name,
            unit: product.unit,
            qty,
            unitPrice,
            lineTotal: qty * unitPrice,
          },
        ],
      });
    }
  },

  removeItem: (productId) =>
    set({ items: get().items.filter((i) => i.productId !== productId) }),

  updateQty: (productId, qty) => {
    if (qty <= 0) {
      get().removeItem(productId);
      return;
    }
    set({
      items: get().items.map((i) =>
        i.productId === productId ? { ...i, qty, lineTotal: qty * i.unitPrice } : i
      ),
    });
  },

  setCustomer: (id, name) => set({ customerId: id, customerName: name }),
  setPaymentType: (type) => set({ paymentType: type }),
  setAmountPaid: (amount) => set({ amountPaid: amount }),
  setDiscount: (type, value) => set({ discountType: type, discountValue: value }),
  clearCart: () =>
    set({
      items: [],
      customerId: null,
      customerName: "Walk-in Customer",
      paymentType: "CASH",
      amountPaid: 0,
      discountType: "NONE",
      discountValue: 0,
    }),

  holdBill: () => {
    const state = get();
    if (state.items.length === 0) return;
    
    const newHeldBill: HeldBill = {
      id: Date.now().toString(),
      items: state.items,
      customerId: state.customerId,
      customerName: state.customerName,
      paymentType: state.paymentType,
      amountPaid: state.amountPaid,
      discountType: state.discountType,
      discountValue: state.discountValue,
      timestamp: new Date().toISOString(),
    };
    
    set({
      heldBills: [...state.heldBills, newHeldBill],
    });
    state.clearCart();
  },

  resumeBill: (id) => {
    const bill = get().heldBills.find((b) => b.id === id);
    if (!bill) return;
    
    set({
      items: bill.items,
      customerId: bill.customerId,
      customerName: bill.customerName,
      paymentType: bill.paymentType,
      amountPaid: bill.amountPaid,
      discountType: bill.discountType,
      discountValue: bill.discountValue,
      heldBills: get().heldBills.filter((b) => b.id !== id),
    });
  },

  deleteHeldBill: (id) =>
    set({ heldBills: get().heldBills.filter((b) => b.id !== id) }),
}));

// Selectors
export const selectSubtotal = (state: CartState) =>
  state.items.reduce((acc, item) => acc + item.lineTotal, 0);

export const selectDiscountAmount = (state: CartState) => {
  const subtotal = selectSubtotal(state);
  if (state.discountType === "FLAT") return state.discountValue;
  if (state.discountType === "PERCENTAGE") return subtotal * (state.discountValue / 100);
  return 0;
};

export const selectGrandTotal = (state: CartState) =>
  selectSubtotal(state) - selectDiscountAmount(state);

export const selectBalanceDue = (state: CartState) =>
  selectGrandTotal(state) - state.amountPaid;
