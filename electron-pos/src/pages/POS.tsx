import React, { useEffect, useState, useMemo, useRef } from "react";
import { Search, Plus, Minus, X, Check, Receipt as ReceiptIcon, CreditCard, Clock, Save } from "lucide-react";
import { useCartStore } from "../store/cartStore";
import { cn } from "../lib/utils";
import { format } from "date-fns";

type Product = { id: string; code: string; name: string; category: string; unit: string; selling_price: number; cost_price: number; stock: number; emoji?: string; low_stock_threshold?: number; tax_exempt?: number; };
type Customer = { id: string; name: string; card_number?: string; current_balance?: number; phone?: string; };
type DailyRate = { date?: string; milk_rate: number; yogurt_rate: number; };
type TaxConfig = { enabled: boolean; label: string; rate: number; };

function roundMoney(value: number) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function toMoney(value: number) {
  return `Rs. ${Math.round(Number(value || 0)).toLocaleString("en-PK")}`;
}

type TouchInputRequest = {
  title: string;
  mode: "number" | "text";
  value: string;
  setValue: (value: string) => void;
  allowDecimal?: boolean;
  masked?: boolean;
  onDone?: () => void;
};

function TouchInputPad({ input, onClose }: { input: TouchInputRequest; onClose: () => void }) {
  const [value, setValue] = useState(input.value || "");
  const textRows = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["Z", "X", "C", "V", "B", "N", "M"]
  ];

  useEffect(() => {
    setValue(input.value || "");
  }, [input]);

  const updateValue = (next: string) => {
    setValue(next);
    input.setValue(next);
  };

  const append = (char: string) => {
    if (input.mode === "number" && char === "." && (!input.allowDecimal || value.includes("."))) return;
    updateValue(value + char);
  };

  const finish = () => {
    input.onDone?.();
    onClose();
  };

  return (
    <div className="fixed inset-x-0 bottom-0 z-[160] bg-black/70 backdrop-blur-sm p-3">
      <div className="mx-auto max-w-3xl rounded-xl border border-surface-4 bg-surface-2 shadow-float overflow-hidden">
        <div className="flex items-center justify-between border-b border-surface-4 bg-surface-3 px-4 py-3">
          <div>
            <div className="text-xs font-bold uppercase text-text-secondary">{input.title}</div>
            <div className="mt-1 min-h-8 rounded-lg bg-surface-1 px-3 py-1.5 font-mono text-2xl text-white">
              {input.masked ? "•".repeat(value.length) : value || <span className="text-text-secondary">Tap keys</span>}
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg bg-surface-4 px-4 py-3 text-sm font-bold text-white">Close</button>
        </div>

        {input.mode === "number" ? (
          <div className="grid grid-cols-3 gap-2 p-3">
            {["7", "8", "9", "4", "5", "6", "1", "2", "3"].map((key) => (
              <button key={key} onClick={() => append(key)} className="h-16 rounded-lg bg-surface-3 text-3xl font-black text-white active:bg-success/40">{key}</button>
            ))}
            <button onClick={() => append(".")} disabled={!input.allowDecimal} className="h-16 rounded-lg bg-surface-3 text-3xl font-black text-white disabled:opacity-30">.</button>
            <button onClick={() => append("0")} className="h-16 rounded-lg bg-surface-3 text-3xl font-black text-white active:bg-success/40">0</button>
            <button onClick={() => updateValue(value.slice(0, -1))} className="h-16 rounded-lg bg-warning/20 text-xl font-black text-warning">Back</button>
            <button onClick={() => updateValue("")} className="h-14 rounded-lg bg-danger/20 text-lg font-black text-danger">Clear</button>
            <button onClick={finish} className="col-span-2 h-14 rounded-lg bg-success text-xl font-black text-white">Done</button>
          </div>
        ) : (
          <div className="space-y-2 p-3">
            {textRows.map((row) => (
              <div key={row.join("")} className="flex justify-center gap-2">
                {row.map((key) => (
                  <button key={key} onClick={() => append(key)} className="h-12 min-w-12 rounded-lg bg-surface-3 px-3 text-lg font-black text-white active:bg-info/40">{key}</button>
                ))}
              </div>
            ))}
            <div className="grid grid-cols-4 gap-2">
              <button onClick={() => append(" ")} className="col-span-2 h-12 rounded-lg bg-surface-3 text-lg font-bold text-white">Space</button>
              <button onClick={() => updateValue(value.slice(0, -1))} className="h-12 rounded-lg bg-warning/20 text-sm font-black text-warning">Back</button>
              <button onClick={() => updateValue("")} className="h-12 rounded-lg bg-danger/20 text-sm font-black text-danger">Clear</button>
              <button onClick={finish} className="col-span-4 h-14 rounded-lg bg-success text-xl font-black text-white">Done</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function POS() {
  // Global Data
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [rates, setRates] = useState<DailyRate>({ milk_rate: 0, yogurt_rate: 0 });
  const [todayRateMissing, setTodayRateMissing] = useState(false);
  const [rateEntry, setRateEntry] = useState({ milkRate: "", yogurtRate: "", managerPin: "" });
  const [isSavingRates, setIsSavingRates] = useState(false);
  const [syncStatus, setSyncStatus] = useState("Online");
  const [taxConfig, setTaxConfig] = useState<TaxConfig>({ enabled: false, label: "GST", rate: 0 });
  const [autoPrintReceipt, setAutoPrintReceipt] = useState(true);
  // Toast notifications for alerts (low stock, credit, etc.)
  const [alerts, setAlerts] = useState<string[]>([]);
  const addAlert = (msg: string) => {
    setAlerts(prev => [...prev, msg]);
    // Auto-dismiss after 5 seconds
    setTimeout(() => setAlerts(prev => prev.filter(a => a !== msg)), 5000);
  };
  
  // Cart & UI State
  const { items, subtotal, addItem, removeItem, updateQuantity, setItemDiscount, clearCart, setItems } = useCartStore();
  const [paymentMode, setPaymentMode] = useState<"CASH" | "ONLINE" | "CREDIT" | "SPLIT">("CASH");
  const [cashReceived, setCashReceived] = useState("");
  const [onlineReceived, setOnlineReceived] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>("");
  const [customerSearchQuery, setCustomerSearchQuery] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [receiptData, setReceiptData] = useState<any>(null);
  const [lastReceiptData, setLastReceiptData] = useState<any>(null);
  const [user, setUser] = useState<any>(null);
  const activeTransactionIdRef = useRef<string | null>(null);
  
  // Custom Inputs
  const [customMilkQty, setCustomMilkQty] = useState("");
  const [customMilkType, setCustomMilkType] = useState<"KG" | "RS">("RS");
  const [customYogurtInput, setCustomYogurtInput] = useState("");
  const [customYogurtType, setCustomYogurtType] = useState<"KG" | "RS">("RS");

  
  // Dropdown state
  const [showOtherItems, setShowOtherItems] = useState(false);
  const [otherSearch, setOtherSearch] = useState("");

  // Hold bills
  const [heldBills, setHeldBills] = useState<any[]>([]);
  const [showHoldPicker, setShowHoldPicker] = useState(false);
  
  // Shortcut Help
  const [showShortcutHelp, setShowShortcutHelp] = useState(false);
  const [discountItem, setDiscountItem] = useState<any>(null);
  const [itemDiscountType, setItemDiscountType] = useState<"RS" | "PERCENT">("RS");
  const [itemDiscountInput, setItemDiscountInput] = useState("");


  // Discount
  const [showDiscount, setShowDiscount] = useState(false);
  const [discountType, setDiscountType] = useState<"RS" | "PERCENT">("RS");
  const [discountInput, setDiscountInput] = useState("");

  // End of Day
  const [endOfDayData, setEndOfDayData] = useState<any>(null);
  const [physicalCash, setPhysicalCash] = useState<string>("");

  // Discount approval PIN modal
  const [discountPinModal, setDiscountPinModal] = useState(false);
  const [discountPinInput, setDiscountPinInput] = useState("");
  const [discountPinLabel, setDiscountPinLabel] = useState("");
  const discountPinResolveRef = useRef<((pin: string | null) => void) | null>(null);
  const [touchInput, setTouchInput] = useState<TouchInputRequest | null>(null);

  const openTouchInput = (input: TouchInputRequest) => {
    setTouchInput(input);
  };

  const askManagerPin = (label: string): Promise<string | null> =>
    new Promise((resolve) => {
      discountPinResolveRef.current = resolve;
      setDiscountPinInput("");
      setDiscountPinLabel(label);
      setDiscountPinModal(true);
    });

  const resolveDiscountPin = (pin: string | null) => {
    setDiscountPinModal(false);
    discountPinResolveRef.current?.(pin);
    discountPinResolveRef.current = null;
  };


  // Derived values
  const parsedDiscountValue = Number(discountInput);
  const discountValue = Number.isFinite(parsedDiscountValue) ? Math.max(0, parsedDiscountValue) : 0;
  const discountAmount = Math.min(
    subtotal,
    discountType === "PERCENT" ? (subtotal * Math.min(discountValue, 100) / 100) : discountValue
  );
  const taxableSubtotal = roundMoney(items.reduce((sum, item) => {
    const product = products.find((p) => p.id === item.productId);
    return sum + ((product && Number(product.tax_exempt || 0) === 1) ? 0 : item.lineTotal);
  }, 0));
  const taxableDiscountShare = subtotal > 0 ? discountAmount * (taxableSubtotal / subtotal) : 0;
  const taxableAmount = roundMoney(Math.max(0, taxableSubtotal - taxableDiscountShare));
  const taxAmount = taxConfig.enabled && taxConfig.rate > 0 ? roundMoney(taxableAmount * (taxConfig.rate / 100)) : 0;
  const grandTotal = Math.max(0, roundMoney(subtotal - discountAmount + taxAmount));
  
  const cashReceivedValue = Number(cashReceived) || 0;
  const onlineReceivedValue = Number(onlineReceived) || 0;
  const changeToReturn = paymentMode === "CASH" ? Math.max(0, cashReceivedValue - grandTotal) : 0;
  const splitRemaining = paymentMode === "SPLIT" ? Math.max(0, grandTotal - cashReceivedValue - onlineReceivedValue) : 0;
  const splitTotalReceived = cashReceivedValue + onlineReceivedValue;

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 60000); // Check for rate updates every minute
    return () => clearInterval(interval);
  }, []);

  const fetchData = async () => {
    const prods = await window.electronAPI?.products?.getAll() || [];
    setProducts(prods);
    const currentUser = await window.electronAPI?.auth?.getMe();
    setUser(currentUser);
    const todayRates = await window.electronAPI?.dailyRates?.getToday();
    if (todayRates) {
      setRates({ date: todayRates.date, milk_rate: todayRates.milk_rate, yogurt_rate: todayRates.yogurt_rate });
      setTodayRateMissing(false);
    } else {
      const latestRates = await window.electronAPI?.dailyRates?.getLatest();
      const fallbackRates = latestRates || {};
      const milkRate = Number(fallbackRates.milk_rate || 0);
      const yogurtRate = Number(fallbackRates.yogurt_rate || 0);
      setRates({ date: fallbackRates.date, milk_rate: milkRate, yogurt_rate: yogurtRate });
      setRateEntry((prev) => ({
        ...prev,
        milkRate: prev.milkRate || (milkRate > 0 ? String(milkRate) : ""),
        yogurtRate: prev.yogurtRate || (yogurtRate > 0 ? String(yogurtRate) : "")
      }));
      setTodayRateMissing(true);
    }
    const held = await window.electronAPI?.sales?.getHeld();
    if (held) {
      setHeldBills(held);
    }
    const settings = await window.electronAPI?.settings?.getAll();
    if (settings?.length) {
      const config = settings.reduce((acc: Record<string, string>, setting: any) => {
        acc[setting.key] = setting.value;
        return acc;
      }, {});
      setTaxConfig({
        enabled: String(config.taxEnabled || "false").toLowerCase() === "true",
        label: String(config.taxLabel || "GST").trim() || "GST",
        rate: Number(config.taxRate || 0) || 0
      });
      setAutoPrintReceipt(String(config.autoPrint ?? "true").toLowerCase() === "true");
    }
  };

  useEffect(() => {
    if (customerSearchQuery.trim() && paymentMode === "CREDIT") {
      const delay = setTimeout(async () => {
        const results = await window.electronAPI?.customers?.search(customerSearchQuery);
        setCustomers(results || []);
      }, 300);
      return () => clearTimeout(delay);
    } else {
      setCustomers([]);
    }
  }, [customerSearchQuery, paymentMode]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setShowOtherItems(false);
        setReceiptData(null);
      }
      if (e.key === "F2") {
        e.preventDefault();
        setShowOtherItems(true);
      }
      if (e.key === "Enter" && ratesReady && items.length > 0 && !isSubmitting && !receiptData && !showOtherItems) {
        if (paymentMode !== "CREDIT" || selectedCustomerId) {
          handleCheckout();
        }
      }
      if (e.ctrlKey && e.key === "d") {
        e.preventDefault();
        loadEndOfDay();
      }
      if (e.ctrlKey && e.key === "p") {
        e.preventDefault();
        if (lastReceiptData) setReceiptData(lastReceiptData);
      }
      if (e.ctrlKey && e.key === "h") {
        e.preventDefault();
        holdBill();
      }
      if (e.ctrlKey && e.key === "z") {
        e.preventDefault();
        if (items.length > 0) removeItem(items[items.length - 1].id);
      }
      if (e.key === "F1") {
        e.preventDefault();
        setShowHoldPicker(prev => !prev);
      }
      if (e.key === "F3") {
        e.preventDefault();
        setPaymentMode(prev => prev === "CASH" ? "ONLINE" : (prev === "ONLINE" ? "CREDIT" : (prev === "CREDIT" ? "SPLIT" : "CASH")));
      }
      if (e.key === "F4") {
        e.preventDefault();
        setShowDiscount(true);
      }
      if (e.key === "+" && items.length > 0) {
        const last = items[items.length - 1];
        updateQuantity(last.id, last.quantity + 1);
      }
      if (e.key === "-" && items.length > 0) {
        const last = items[items.length - 1];
        if (last.quantity > 1) updateQuantity(last.id, last.quantity - 1);
      }
      // Shortcut help modal '?' key
      if (e.key === "?" && !e.shiftKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setShowShortcutHelp(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items, isSubmitting, receiptData, paymentMode, selectedCustomerId, showOtherItems, lastReceiptData, heldBills, ratesReady]);

  const loadEndOfDay = async () => {
    const day = await window.electronAPI?.system?.getBusinessDate();
    const today = day?.date || format(new Date(), "yyyy-MM-dd");
    const data = await window.electronAPI?.reports?.getEndOfDay(today);
    setEndOfDayData({ ...data, date: today });
    setPhysicalCash(data?.cashInDrawer?.toString() || "");
  };

  const milkProduct = useMemo(() => products.find(p => String(p.code).toUpperCase() === "MILK"), [products]);
  const yogurtProduct = useMemo(() => products.find(p => String(p.code).toUpperCase() === "YOGT"), [products]);
  const otherProducts = useMemo(() => products.filter(p => p.id !== milkProduct?.id && p.id !== yogurtProduct?.id && p.name.toLowerCase().includes(otherSearch.toLowerCase())), [products, milkProduct, yogurtProduct, otherSearch]);
  const ratesReady = !todayRateMissing && rates.milk_rate > 0 && rates.yogurt_rate > 0;

  const requireTodaysRates = () => {
    if (ratesReady) return true;
    addAlert("Enter today's milk and yogurt rates before making sales.");
    return false;
  };

  const saveTodaysRates = async () => {
    const milkRate = Number(rateEntry.milkRate);
    const yogurtRate = Number(rateEntry.yogurtRate);
    if (!Number.isFinite(milkRate) || milkRate <= 0 || !Number.isFinite(yogurtRate) || yogurtRate <= 0) {
      alert("Milk and yogurt rates must be greater than zero.");
      return;
    }
    if (!rateEntry.managerPin.trim()) {
      alert("Manager PIN is required to set today's rates.");
      return;
    }

    setIsSavingRates(true);
    try {
      const result = await window.electronAPI?.dailyRates?.update({
        milkRate,
        yogurtRate,
        managerPin: rateEntry.managerPin.trim(),
        notes: "Set from POS opening prompt"
      });
      if (!result?.success) {
        alert(result?.error || "Could not save today's rates.");
        return;
      }
      setRateEntry({ milkRate: "", yogurtRate: "", managerPin: "" });
      await fetchData();
      addAlert("Today's rates saved.");
    } finally {
      setIsSavingRates(false);
    }
  };

  const addMilk = (qty: number) => {
    if (!requireTodaysRates()) return;
    if (!milkProduct) {
      addAlert("Milk system product is missing. Restart the app once to repair products.");
      return;
    }
    addItem({
      id: crypto.randomUUID(),
      productId: milkProduct.id,
      name: milkProduct.name,
      unit: "kg",
      quantity: qty,
      price: rates.milk_rate,
      costPrice: milkProduct.cost_price,
      lineTotal: qty * rates.milk_rate
    });
  };

  const addYogurtKg = (qty: number) => {
    if (!requireTodaysRates()) return;
    if (!yogurtProduct) {
      addAlert("Yogurt system product is missing. Restart the app once to repair products.");
      return;
    }
    addItem({
      id: crypto.randomUUID(),
      productId: yogurtProduct.id,
      name: yogurtProduct.name,
      unit: "kg",
      quantity: qty,
      price: rates.yogurt_rate,
      costPrice: yogurtProduct.cost_price,
      lineTotal: qty * rates.yogurt_rate
    });
  };

  const addYogurtRs = (amount: number) => {
    if (!requireTodaysRates()) return;
    if (!yogurtProduct) {
      addAlert("Yogurt system product is missing. Restart the app once to repair products.");
      return;
    }
    if (rates.yogurt_rate <= 0) return;
    const qty = Math.round((amount / rates.yogurt_rate) * 1000) / 1000;
    addItem({
      id: crypto.randomUUID(),
      productId: yogurtProduct.id,
      name: yogurtProduct.name,
      unit: "kg",
      quantity: qty,
      price: rates.yogurt_rate,
      costPrice: yogurtProduct.cost_price,
      lineTotal: amount // exact amount
    });
  };

  const addMilkRs = (amount: number) => {
    if (!requireTodaysRates()) return;
    if (!milkProduct) {
      addAlert("Milk system product is missing. Restart the app once to repair products.");
      return;
    }
    if (rates.milk_rate <= 0) return;
    const qty = Math.round((amount / rates.milk_rate) * 1000) / 1000;
    addItem({
      id: crypto.randomUUID(),
      productId: milkProduct.id,
      name: milkProduct.name,
      unit: "kg",
      quantity: qty,
      price: rates.milk_rate,
      costPrice: milkProduct.cost_price,
      lineTotal: amount // exact amount
    });
  };

  const handleCustomMilkAdd = () => {
    const val = Number(customMilkQty);
    if (val > 0) {
      if (customMilkType === "KG") addMilk(val);
      else addMilkRs(val);
      setCustomMilkType("KG");
      setCustomMilkQty("");
    }
  };


  const handleCustomYogurtAdd = () => {
    const val = Number(customYogurtInput);
    if (val > 0) {
      if (customYogurtType === "KG") addYogurtKg(val);
      else addYogurtRs(val);
      setCustomYogurtInput("");
    }
  };

  const holdBill = async () => {
    if (items.length === 0) return;
    if (heldBills.length >= 5) {
      alert("Maximum 5 bills can be held at once.");
      return;
    }
    const customerName = selectedCustomerId ? customers.find(c => c.id === selectedCustomerId)?.name || "Khata Customer" : "Walk-in";
    
    const holdData = {
      id: crypto.randomUUID(),
      customerId: selectedCustomerId,
      customerName,
      paymentType: paymentMode,
      subtotal,
      items: items.map(i => ({
        productId: i.productId,
        productName: i.name,
        unit: i.unit,
        quantity: i.quantity,
        price: i.price,
        lineTotal: i.lineTotal
      }))
    };

    const res = await window.electronAPI?.sales?.hold(holdData);
    if (res?.success) {
      fetchData(); // refresh held bills
      clearCart();
      setSelectedCustomerId("");
      setCustomerSearchQuery("");
      setPaymentMode("CASH");
      setShowHoldPicker(false);
    } else {
      alert("Error holding bill: " + res?.error);
    }
  };

  const resumeBill = async (held: any) => {
    clearCart();
    setItems(held.items);
    if (held.customerId) {
      setSelectedCustomerId(held.customerId);
      setCustomerSearchQuery(held.customerName);
    }
    setPaymentMode(held.paymentType || "CASH");
    
    const res = await window.electronAPI?.sales?.deleteHeld(held.id);
    if (res?.success) {
      fetchData();
    }
    setShowHoldPicker(false);
  };

  const discardHeldBill = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (confirm("Discard this held bill?")) {
      const res = await window.electronAPI?.sales?.deleteHeld(id);
      if (res?.success) {
        fetchData();
        if (heldBills.length <= 1) setShowHoldPicker(false);
      }
    }
  };

  const openItemDiscount = (item: any) => {
    setDiscountItem(item);
    setItemDiscountType(item.discountType === "PERCENT" ? "PERCENT" : "RS");
    setItemDiscountInput(item.discountValue ? String(item.discountValue) : "");
  };

  const applyItemDiscount = () => {
    if (!discountItem) return;
    const rawDiscount = Number(itemDiscountInput || 0);
    if (!Number.isFinite(rawDiscount) || rawDiscount < 0) {
      alert("Item discount must be a valid positive number.");
      return;
    }

    const grossLineTotal = discountItem.quantity * discountItem.price;
    if (itemDiscountType === "PERCENT" && rawDiscount > 100) {
      alert("Item percentage discount cannot be more than 100%.");
      return;
    }

    if (itemDiscountType === "RS" && rawDiscount > grossLineTotal) {
      alert("Item discount cannot be greater than the item total.");
      return;
    }

    setItemDiscount(discountItem.id, rawDiscount > 0 ? itemDiscountType : "NONE", rawDiscount);
    setDiscountItem(null);
    setItemDiscountInput("");
  };

  const handleCheckout = async () => {
    if (items.length === 0 || isSubmitting) return;
    if (!requireTodaysRates()) return;
    if (paymentMode === "CREDIT" && !selectedCustomerId) {
      alert("Please select a customer for khata/credit sale.");
      return;
    }

    if (discountInput.trim()) {
      const rawDiscount = Number(discountInput);
      if (!Number.isFinite(rawDiscount) || rawDiscount < 0) {
        alert("Discount must be a valid positive number.");
        return;
      }
      if (discountType === "PERCENT" && rawDiscount > 100) {
        alert("Percentage discount cannot be more than 100%.");
        return;
      }
      if (discountType === "RS" && rawDiscount > subtotal) {
        alert("Discount cannot be greater than the bill subtotal.");
        return;
      }
    }

    if (paymentMode === "CASH" && cashReceived.trim() && cashReceivedValue < grandTotal) {
      alert("Cash received is less than the bill total. Use Split if part is paid online, or Khata if it is monthly credit.");
      return;
    }

    if (paymentMode === "SPLIT" && cashReceivedValue <= 0) {
      alert("Split payment must include some cash.");
      return;
    }

    if (paymentMode === "SPLIT" && onlineReceivedValue <= 0) {
      alert("Split payment must include some online/digital payment.");
      return;
    }

    if (paymentMode === "SPLIT" && Math.round(splitTotalReceived) !== Math.round(grandTotal)) {
      alert(`Split payment must equal the bill total. Remaining: ${toMoney(grandTotal - splitTotalReceived)}`);
      return;
    }
    
    setIsSubmitting(true);
    try {
      if (!activeTransactionIdRef.current) {
        activeTransactionIdRef.current = crypto.randomUUID();
      }
      const transactionId = activeTransactionIdRef.current;

      // Capture current stocks for low-stock alerts check after sale
      const currentStocks = products.reduce((acc, p) => ({ ...acc, [p.id]: p.stock }), {} as Record<string, number>);
      
      const selectedCustomerObj = customers.find(c => c.id === selectedCustomerId);
      const cashTendered = paymentMode === "CASH"
        ? (cashReceivedValue > 0 ? cashReceivedValue : grandTotal)
        : paymentMode === "SPLIT"
          ? cashReceivedValue
          : 0;
      const amountPaid = paymentMode === "CREDIT" ? 0 : grandTotal;
      const balanceDue = paymentMode === "CREDIT" ? grandTotal : 0;
      const cashPaid = paymentMode === "CASH" ? grandTotal : (paymentMode === "SPLIT" ? cashReceivedValue : 0);
      const onlinePaid = paymentMode === "ONLINE" ? grandTotal : (paymentMode === "SPLIT" ? onlineReceivedValue : 0);
      const totalItemDiscount = items.reduce((sum, item) => sum + Number(item.discountAmount || 0), 0);
      const totalDiscountForApproval = roundMoney(discountAmount + totalItemDiscount);
      let managerPin: string | undefined;
      if (totalDiscountForApproval > 100) {
        const enteredPin = await askManagerPin(`Discount is ${toMoney(totalDiscountForApproval)} — Manager PIN required.`);
        if (!enteredPin) {
          setIsSubmitting(false);
          return;
        }
        managerPin = enteredPin;
      }

      const saleData = {
        transactionId,
        customerId: selectedCustomerId || null,
        cashierId: user?.id,
        paymentType: paymentMode,
        subtotal,
        discountType: discountValue > 0 ? discountType : "NONE",
        discountValue,
        discountAmount,
        grandTotal,
        amountPaid,
        balanceDue,
        cashPaid,
        onlinePaid,
        cashTendered,
        changeReturned: paymentMode === "CASH" ? changeToReturn : 0,
        managerPin,
        taxAmount,
        taxRate: taxConfig.rate,
        taxLabel: taxConfig.label,
        items: items.map(i => ({
          productId: i.productId,
          productName: i.name,
          unit: i.unit,
          quantity: i.quantity,
          sellingPrice: i.price,
          costPrice: i.costPrice || 0,
          discountType: i.discountType || "NONE",
          discountValue: i.discountValue || 0,
          lineTotal: i.lineTotal
        }))
      };

      const result = await window.electronAPI?.sales?.create(saleData);
      if (result && !result.success) {
        if (result.duplicate) {
          activeTransactionIdRef.current = null;
        }
        alert("Sale failed: " + result.error);
        setIsSubmitting(false);
        return;
      }

      if (result?.lateSaleNote) {
        addAlert(result.lateSaleNote);
      }
      
      const billNo = result?.billNumber || "BILL-" + Math.floor(Math.random() * 10000);
      const savedReceipt = result?.saleId ? await window.electronAPI?.sales?.getReceipt(result.saleId) : null;
      const savedSale = savedReceipt?.sale;
      const savedItems = (savedReceipt?.items || []).map((item: any) => ({
        id: item.id,
        productId: item.product_id,
        name: item.product_name,
        unit: item.unit,
        quantity: Number(item.quantity),
        price: Number(item.unit_price),
        costPrice: Number(item.cost_price),
        discountType: item.discount_type || "NONE",
        discountValue: Number(item.discount_value || 0),
        discountAmount: Number(item.discount_amount || 0),
        lineTotal: Number(item.line_total)
      }));
      const receiptSubtotal = Number(savedSale?.subtotal ?? result?.subtotal ?? subtotal);
      const receiptDiscount = Number(savedSale?.discount_amount ?? result?.discountAmount ?? discountAmount);
      const receiptTaxAmount = Number(savedSale?.tax_amount ?? result?.taxAmount ?? taxAmount);
      const receiptTaxLabel = String(savedSale?.tax_label ?? result?.taxLabel ?? taxConfig.label);
      const receiptGrandTotal = Number(savedSale?.grand_total ?? result?.grandTotal ?? grandTotal);
      const receiptCashTendered = Number(savedSale?.cash_tendered ?? result?.cashTendered ?? cashTendered);
      const receiptChangeReturned = Number(savedSale?.change_returned ?? result?.changeReturned ?? changeToReturn);
      const receiptAmountPaid = paymentMode === "CASH" ? receiptCashTendered : Number(savedSale?.amount_paid ?? result?.amountPaid ?? amountPaid);
      const receiptBalanceDue = Number(savedSale?.balance_due ?? result?.balanceDue ?? balanceDue);
      const splitPayments = savedReceipt?.splitPayments || [];
      
      const rData = {
        billNumber: billNo,
        date: new Date(),
        customer: selectedCustomerObj?.name || "Walk-in",
        items: savedItems.length > 0 ? savedItems : [...items],
        subtotal: receiptSubtotal,
        discount: receiptDiscount,
        taxAmount: receiptTaxAmount,
        taxLabel: receiptTaxLabel,
        grandTotal: receiptGrandTotal,
        amountPaid: receiptAmountPaid,
        balanceDue: receiptBalanceDue,
        cashPaid,
        onlinePaid,
        splitPayments,
        changeToReturn: paymentMode === "CASH" ? receiptChangeReturned : 0,
        paymentType: paymentMode
      };
      
      setLastReceiptData(rData);
      if (autoPrintReceipt) {
        const printResult = await window.electronAPI?.printer?.printReceipt(rData);
        if (printResult && !printResult.success) {
          console.error("Auto-print error:", printResult.error);
          setReceiptData(rData);
          addAlert(`Sale saved, but receipt did not print: ${printResult.error || "Printer error"}`);
        } else {
          addAlert("Sale Completed Successfully - Receipt Printed");
        }
      } else {
        setReceiptData(rData);
        addAlert("Sale saved. Auto-print is off, print the receipt manually.");
      }
      
      clearCart();
      setSelectedCustomerId("");
      setCustomerSearchQuery("");
      setPaymentMode("CASH");
      setCashReceived("");
      setOnlineReceived("");
      setDiscountInput("");
      setShowDiscount(false);
      activeTransactionIdRef.current = null;
      // After sale, check for low stock alerts
      items.forEach(item => {
        const prod = products.find(p => p.id === item.productId);
        if (prod) {
          const remaining = (currentStocks[prod.id] || 0) - item.quantity;
          if (remaining <= (prod.low_stock_threshold || 5)) {
            addAlert(`${prod.name} stock low — only ${remaining.toFixed(2)} left`);
          }
        }
      });
    } catch (err) {
      console.error(err);
      alert("Error processing sale");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
      <div className="flex flex-col h-full bg-surface-1 overflow-hidden font-sans select-none">
      {/* TOP STRIP */}
      {/* Alerts bar */}
    {alerts.length > 0 && (
      <div className="fixed top-4 left-1/2 transform -translate-x-1/2 space-y-2 z-50">
        {alerts.map((msg, i) => (
          <div key={i} className="bg-yellow-600 text-white px-4 py-2 rounded shadow-md animate-slide-down">
            ⚠️ {msg}
          </div>
        ))}
      </div>
    )}
    <div className="h-12 bg-surface-2 border-b border-surface-4 flex items-center justify-between px-4 shrink-0 relative z-20">
        <div className="relative">
          <button 
            onClick={() => setShowOtherItems(!showOtherItems)}
            className="flex items-center gap-2 px-3 py-1.5 bg-surface-3 hover:bg-surface-4 border border-surface-4 rounded text-sm font-medium text-text-primary transition-colors"
          >
            <Plus className="w-4 h-4" /> Other Items (F2)
          </button>
          
          {/* Other Items Dropdown */}
          {showOtherItems && (
            <div className="absolute top-full left-0 mt-2 w-80 bg-surface-2 border border-surface-4 rounded-lg shadow-float p-3 flex flex-col gap-3 max-h-[60vh]">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                <input 
                  autoFocus
                  type="text" 
                  placeholder="Search products..." 
                  value={otherSearch}
                  onChange={e => setOtherSearch(e.target.value)}
                  onFocus={() => openTouchInput({ title: "Search products", mode: "text", value: otherSearch, setValue: setOtherSearch })}
                  className="w-full bg-surface-3 border border-surface-4 rounded-md pl-9 pr-3 py-2 text-sm text-text-primary outline-none focus:border-primary"
                />
              </div>
              <div className="flex-1 overflow-y-auto flex flex-col gap-2">
                {otherProducts.length === 0 ? (
                  <p className="text-center text-sm text-text-secondary py-4">No items found</p>
                ) : (
                  otherProducts.map(p => (
                    <button 
                      key={p.id}
                      onClick={() => {
                        if (!requireTodaysRates()) return;
                        addItem({
                          id: crypto.randomUUID(), productId: p.id, name: p.name, unit: p.unit, 
                          quantity: 1, price: p.selling_price, costPrice: p.cost_price, lineTotal: p.selling_price
                        });
                      }}
                      className="flex items-center justify-between p-2 rounded-md hover:bg-surface-3 transition-colors text-left"
                    >
                      <div>
                        <div className="font-medium text-text-primary text-sm">{p.emoji || "📦"} {p.name}</div>
                        <div className="text-xs text-text-secondary">Stock: {p.stock}</div>
                      </div>
                      <div className="font-mono text-sm text-accent">{toMoney(p.selling_price)}</div>
                    </button>
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="text-lg font-bold text-text-primary flex items-center gap-2">
          <img
            src="./brand/gujjar-logo-square.png"
            alt="Gujjar Milk Shop"
            className="h-8 w-8 rounded-full bg-white object-cover border border-white/20"
          />
          Gujjar Milk Shop <span className="text-sm font-normal text-text-secondary ml-2">{format(new Date(), "dd MMM yyyy")}</span>
        </div>

        <div className="flex items-center gap-3">
          {selectedCustomerId && (
            <div className="bg-danger/20 border border-danger/30 text-danger px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
              Khata: {customers.find(c => c.id === selectedCustomerId)?.name}
            </div>
          )}
          <div className="flex items-center gap-1.5 px-2 py-1 bg-surface-3 rounded-full border border-surface-4">
            <div className="w-2 h-2 rounded-full bg-success"></div>
            <span className="text-xs font-medium text-text-secondary">{syncStatus}</span>
          </div>
        </div>
      </div>

      {/* MAIN PANELS */}
      <div className="flex-1 flex overflow-hidden relative z-10">
        
        {/* MILK PANEL - LEFT HALF */}
        <div className="flex-1 bg-[#040f09] border-r border-surface-4 flex flex-col relative">
          <div className="p-4 shrink-0 text-center border-b border-white/5">
            <h1 className="text-3xl font-black text-white tracking-wide">🥛 MILK</h1>
            <p className="text-xl font-mono text-accent mt-1 tracking-widest font-bold border border-accent/20 bg-accent/10 inline-block px-4 py-1 rounded-full">{ratesReady ? `Rs.${rates.milk_rate}/kg` : "Rate required"}</p>
          </div>
          
          <div className="flex-1 p-4 flex flex-col gap-4 overflow-hidden">
            {/* Custom Input */}
            <div className="flex gap-2 shrink-0 bg-white/5 p-2 rounded-xl border border-white/10">
              <input 
                type="number" 
                placeholder="Custom Value" 
                value={customMilkQty}
                onChange={e => setCustomMilkQty(e.target.value)}
                onFocus={() => openTouchInput({ title: "Milk custom value", mode: "number", value: customMilkQty, setValue: setCustomMilkQty, allowDecimal: true })}
                className="flex-1 bg-transparent px-3 py-2 text-white outline-none text-lg font-mono"
              />
              <div className="flex bg-surface-1 rounded-lg p-1">
                <button 
                  onClick={() => setCustomMilkType("KG")} 
                  className={cn("px-4 py-2 rounded-md text-sm font-bold transition-colors", customMilkType === "KG" ? "bg-success text-white" : "text-text-secondary hover:text-white")}
                >KG</button>
                <button 
                  onClick={() => setCustomMilkType("RS")} 
                  className={cn("px-4 py-2 rounded-md text-sm font-bold transition-colors", customMilkType === "RS" ? "bg-success text-white" : "text-text-secondary hover:text-white")}
                >RS</button>
              </div>
              <button onClick={handleCustomMilkAdd} disabled={!customMilkQty} className="bg-success hover:bg-success/90 text-white font-bold px-6 rounded-lg transition-colors disabled:opacity-50">
                Add
              </button>
            </div>

            {/* 6x3 Grid */}
            <div className="flex-1 grid grid-cols-3 gap-3">
              <div className="flex flex-col gap-3">
                {[1, 2, 3, 4, 5, 6].map(kg => (
                  <button key={kg} onClick={() => addMilk(kg)} className="flex-1 bg-white/5 hover:bg-white/10 active:bg-success/30 border border-white/10 rounded-xl flex flex-col items-center justify-center transition-all active:scale-95 group">
                    <span className="text-3xl font-bold text-white group-active:text-success">{kg} kg</span>
                    <span className="text-lg font-mono text-accent mt-1">{toMoney(kg * rates.milk_rate)}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-3">
                {[0.5, 1.5, 2.5, 3.5, 4.5, 5.5].map(kg => (
                  <button key={kg} onClick={() => addMilk(kg)} className="flex-1 bg-white/5 hover:bg-white/10 active:bg-success/30 border border-white/10 rounded-xl flex flex-col items-center justify-center transition-all active:scale-95 group">
                    <span className="text-3xl font-bold text-white group-active:text-success">{kg} kg</span>
                    <span className="text-lg font-mono text-accent mt-1">{toMoney(kg * rates.milk_rate)}</span>
                  </button>
                ))}
              </div>
              <div className="flex flex-col gap-3">
                {[7, 8, 9, 10, 11, 12].map(kg => (
                  <button key={kg} onClick={() => addMilk(kg)} className="flex-1 bg-white/5 hover:bg-white/10 active:bg-success/30 border border-white/10 rounded-xl flex flex-col items-center justify-center transition-all active:scale-95 group">
                    <span className="text-3xl font-bold text-white group-active:text-success">{kg} kg</span>
                    <span className="text-lg font-mono text-accent mt-1">{toMoney(kg * rates.milk_rate)}</span>
                  </button>
                ))}
              </div>
            </div>

          </div>

        </div>

        {/* YOGURT PANEL - RIGHT HALF */}
        <div className="flex-1 bg-[#04090f] flex flex-col relative">
          <div className="p-4 shrink-0 text-center border-b border-white/5">
            <h1 className="text-3xl font-black text-white tracking-wide">🫙 YOGURT</h1>
            <p className="text-xl font-mono text-accent mt-1 tracking-widest font-bold border border-accent/20 bg-accent/10 inline-block px-4 py-1 rounded-full">{ratesReady ? `Rs.${rates.yogurt_rate}/kg` : "Rate required"}</p>
          </div>
          
          <div className="flex-1 p-4 flex flex-col gap-4 overflow-y-auto">
            {/* Custom Input */}
            <div className="flex gap-2 shrink-0 bg-white/5 p-2 rounded-xl border border-white/10">
              <input 
                type="number" 
                placeholder="Custom Value" 
                value={customYogurtInput}
                onChange={e => setCustomYogurtInput(e.target.value)}
                onFocus={() => openTouchInput({ title: "Yogurt custom value", mode: "number", value: customYogurtInput, setValue: setCustomYogurtInput, allowDecimal: true })}
                className="flex-1 bg-transparent px-3 py-2 text-white outline-none text-lg font-mono"
              />
              <div className="flex bg-surface-1 rounded-lg p-1">
                <button 
                  onClick={() => setCustomYogurtType("KG")} 
                  className={cn("px-4 py-2 rounded-md text-sm font-bold transition-colors", customYogurtType === "KG" ? "bg-info text-white" : "text-text-secondary hover:text-white")}
                >KG</button>
                <button 
                  onClick={() => setCustomYogurtType("RS")} 
                  className={cn("px-4 py-2 rounded-md text-sm font-bold transition-colors", customYogurtType === "RS" ? "bg-purple-500 text-white" : "text-text-secondary hover:text-white")}
                >RS</button>
              </div>
              <button onClick={handleCustomYogurtAdd} disabled={!customYogurtInput} className="bg-surface-3 hover:bg-surface-4 text-white font-bold px-6 rounded-lg transition-colors border border-surface-4 disabled:opacity-50">
                Add
              </button>
            </div>

            <div className="flex-1 flex gap-4">
              {/* By Weight */}
              <div className="flex-1 flex flex-col">
                <h3 className="text-sm font-bold text-white/50 text-center mb-3 uppercase tracking-widest">By Weight (kg)</h3>
                <div className="flex-1 flex flex-col gap-3">
                  {[0.25, 0.50, 0.75, 1.00, 1.25, 1.50, 1.75, 2.00].map(kg => (
                    <button key={kg} onClick={() => addYogurtKg(kg)} className="flex-1 bg-info/10 hover:bg-info/20 active:bg-info/40 border border-info/20 rounded-xl flex flex-row items-center justify-between px-6 transition-all active:scale-95 group">
                      <span className="text-2xl font-bold text-white">{kg.toFixed(2)} kg</span>
                      <span className="text-lg font-mono text-info/80">{toMoney(kg * rates.yogurt_rate)}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* By Amount */}
              <div className="flex-1 flex flex-col">
                <h3 className="text-sm font-bold text-white/50 text-center mb-3 uppercase tracking-widest">By Amount (Rs)</h3>
                <div className="flex-1 flex flex-col gap-3">
                  {[50, 100, 150, 200, 250, 300].map(amt => (
                    <button key={amt} onClick={() => addYogurtRs(amt)} className="flex-1 bg-purple-500/10 hover:bg-purple-500/20 active:bg-purple-500/40 border border-purple-500/20 rounded-xl flex flex-row items-center justify-between px-6 transition-all active:scale-95 group">
                      <span className="text-2xl font-bold text-white">Rs. {amt}</span>
                      <span className="text-sm font-mono text-purple-300/80">≈ {((amt / rates.yogurt_rate) || 0).toFixed(2)} kg</span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* CART/CHECKOUT PANEL - RIGHT SIDE */}
        <div className="w-[380px] bg-surface-2 border-l border-surface-4 flex flex-col relative z-30 shadow-[0_-10px_40px_rgba(0,0,0,0.3)]">
          {/* Section 1: Bill Items */}
          <div className="flex-1 p-4 flex flex-col relative overflow-hidden">
            <div className="flex justify-between items-center mb-2">
              <h3 className="text-sm font-bold text-text-secondary uppercase tracking-widest flex items-center gap-2">
                Current Bill ({items.length})
                {lastReceiptData && (
                  <button onClick={() => setReceiptData(lastReceiptData)} className="ml-2 px-2 py-0.5 bg-surface-3 hover:bg-surface-4 border border-surface-4 rounded text-[10px] text-text-primary transition-colors flex items-center gap-1">
                    🖨 Reprint (Ctrl+P)
                  </button>
                )}
              </h3>
              {items.length > 0 && (
                <button onClick={clearCart} className="text-xs text-danger hover:underline">Clear All</button>
              )}
            </div>
            
            <div className="flex-1 overflow-y-auto whitespace-normal flex flex-col gap-2 pb-2">
              {items.length === 0 ? (
                <div className="h-full w-full flex items-center justify-center text-text-secondary opacity-50 text-sm">
                  No items added yet
                </div>
              ) : (
                items.map(item => (
                  <div key={item.id} className="flex flex-col bg-surface-3 border border-surface-4 rounded-lg p-3 shadow-sm animate-slide-up">
                    <div className="flex justify-between items-center gap-4 mb-1">
                      <span className="font-bold text-text-primary text-sm truncate">{item.name}</span>
                      <button onClick={() => removeItem(item.id)} className="text-text-secondary hover:text-danger p-1"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="flex justify-between items-end">
                      <div className="text-lg font-mono text-white">{item.quantity.toFixed(2)} <span className="text-xs text-text-secondary">{item.unit}</span></div>
                      <div className="font-mono font-bold text-accent">{toMoney(item.lineTotal)}</div>
                    </div>
                    <button
                      onClick={() => openItemDiscount(item)}
                      className={cn(
                        "mt-2 rounded-md border px-2 py-1 text-[10px] font-bold transition-colors",
                        item.discountAmount && item.discountAmount > 0
                          ? "border-warning/40 bg-warning/10 text-warning"
                          : "border-surface-4 text-text-secondary hover:bg-surface-4 hover:text-white"
                      )}
                    >
                      {item.discountAmount && item.discountAmount > 0 ? `Item Discount: -${toMoney(item.discountAmount)}` : "Add Item Discount"}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Section 2: Bill Summary */}
          <div className="border-t border-surface-4 p-4 flex flex-col bg-surface-2/50 relative overflow-visible shrink-0">
            <div className="text-sm text-text-secondary font-medium mb-1">Subtotal: <span className="float-right text-text-primary">{toMoney(subtotal)}</span></div>
            
            {showDiscount ? (
              <div className="bg-surface-3 p-2 rounded-lg border border-surface-4 mb-2 animate-slide-up relative z-50">
                 <div className="flex bg-surface-1 rounded p-1 mb-2">
                   <button onClick={() => setDiscountType("RS")} className={cn("flex-1 text-[10px] font-bold py-1 rounded", discountType === "RS" ? "bg-primary text-white" : "text-text-secondary")}>RS</button>
                   <button onClick={() => setDiscountType("PERCENT")} className={cn("flex-1 text-[10px] font-bold py-1 rounded", discountType === "PERCENT" ? "bg-primary text-white" : "text-text-secondary")}>%</button>
                 </div>
                 <input 
                   type="number" 
                   min="0"
                   max={discountType === "PERCENT" ? "100" : undefined}
                   value={discountInput}
                   onChange={e => setDiscountInput(e.target.value)}
                   onFocus={() => openTouchInput({ title: "Bill discount", mode: "number", value: discountInput, setValue: setDiscountInput, allowDecimal: true })}
                   className="w-full bg-surface-1 border border-surface-4 rounded px-2 py-1 text-sm text-white focus:border-primary outline-none"
                   placeholder="Amount"
                 />
                 <button onClick={() => {setShowDiscount(false); setDiscountInput("");}} className="absolute -top-2 -right-2 bg-danger text-white rounded-full w-5 h-5 flex items-center justify-center text-xs">✕</button>
              </div>
            ) : (
              <button onClick={() => setShowDiscount(true)} className="text-xs text-primary font-bold text-left mb-2 hover:underline">
                {discountAmount > 0 ? `- Discount: ${toMoney(discountAmount)}` : "+ Add Discount"}
              </button>
            )}

            {taxAmount > 0 && (
              <div className="text-sm text-info font-medium mb-2">
                {taxConfig.label} ({taxConfig.rate}%): <span className="float-right text-info">{toMoney(taxAmount)}</span>
              </div>
            )}

            <div className="text-sm text-text-secondary font-bold mb-1 border-t border-surface-4 pt-2">TOTAL</div>
            <div className="text-3xl font-black font-mono text-accent drop-shadow-md">{toMoney(grandTotal)}</div>
          </div>

          {/* Section 3: Payment */}
          <div className="border-t border-surface-4 p-4 flex flex-col bg-surface-1/30 relative shrink-0">
            <div className="flex bg-surface-3 rounded-lg p-1 border border-surface-4 mb-2">
              <button onClick={() => setPaymentMode("CASH")} className={cn("flex-1 py-1.5 rounded-md font-bold text-[10px] transition-all flex items-center justify-center", paymentMode === "CASH" ? "bg-success text-white shadow-md" : "text-text-secondary hover:text-white")}>CASH</button>
              <button onClick={() => setPaymentMode("ONLINE")} className={cn("flex-1 py-1.5 rounded-md font-bold text-[10px] transition-all flex items-center justify-center", paymentMode === "ONLINE" ? "bg-info text-white shadow-md" : "text-text-secondary hover:text-white")}>ONLINE</button>
              <button onClick={() => setPaymentMode("SPLIT")} className={cn("flex-1 py-1.5 rounded-md font-bold text-[10px] transition-all flex items-center justify-center", paymentMode === "SPLIT" ? "bg-warning text-black shadow-md" : "text-text-secondary hover:text-white")}>SPLIT</button>
              <button onClick={() => setPaymentMode("CREDIT")} className={cn("flex-1 py-1.5 rounded-md font-bold text-[10px] transition-all flex items-center justify-center", paymentMode === "CREDIT" ? "bg-danger text-white shadow-md" : "text-text-secondary hover:text-white")}>KHATA</button>
            </div>
            
            {paymentMode === "CREDIT" && (
               <div className="relative mb-2 animate-slide-up">
                 <div className="relative">
                   <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-secondary" />
                   <input 
                     type="text" 
                     placeholder="Search khata customer..." 
                     value={customerSearchQuery}
                     onChange={e => { setCustomerSearchQuery(e.target.value); setSelectedCustomerId(""); }}
                     onFocus={() => openTouchInput({
                       title: "Search khata customer",
                       mode: "text",
                       value: customerSearchQuery,
                       setValue: (value) => { setCustomerSearchQuery(value); setSelectedCustomerId(""); }
                     })}
                     className={cn("w-full bg-surface-3 border rounded-md pl-8 pr-2 py-1.5 text-xs text-white outline-none focus:border-info", selectedCustomerId ? "border-info bg-info/10" : "border-surface-4")}
                   />
                 </div>
                 
                 {!selectedCustomerId && customerSearchQuery && customers.length > 0 && (
                   <div className="absolute bottom-full left-0 right-0 mb-1 bg-surface-2 border border-surface-4 rounded-lg shadow-float max-h-[150px] overflow-y-auto z-[60]">
                     {customers.map(c => (
                       <button 
                         key={c.id} 
                         onClick={() => { setSelectedCustomerId(c.id); setCustomerSearchQuery(`${c.card_number ? `[${c.card_number}] ` : ''}${c.name}`); setCustomers([]); }}
                         className="w-full text-left p-2 border-b border-surface-4 hover:bg-surface-3 transition-colors flex justify-between items-center text-xs"
                       >
                         <span className="font-bold text-white">{c.name}</span>
                       </button>
                     ))}
                   </div>
                 )}
               </div>
            )}

            {paymentMode === "CASH" && (
              <div className="flex flex-col bg-success/10 border border-success/30 rounded-lg p-2 animate-slide-up relative">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div>
                    <div className="text-[10px] font-bold text-success uppercase">Fast cash sale</div>
                    <div className="text-[10px] text-text-secondary">Cash box is optional. Press Enter or CASH to complete.</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] text-text-secondary uppercase">Bill</div>
                    <div className="text-lg font-black font-mono text-success">{toMoney(grandTotal)}</div>
                  </div>
                </div>
                <div className="grid grid-cols-4 gap-1.5 mb-2">
                  {[grandTotal, 500, 1000, 5000].map((amount, index) => (
                    <button
                      key={`${index}-${amount}`}
                      type="button"
                      onClick={() => setCashReceived(String(Math.round(amount)))}
                      className="h-8 rounded-md bg-surface-3 hover:bg-surface-4 border border-surface-4 text-[11px] font-bold text-white"
                    >
                      {amount === grandTotal ? "Exact" : `Rs ${amount}`}
                    </button>
                  ))}
                </div>
                <label className="text-[10px] font-bold text-text-secondary uppercase mb-1">Optional change calculator</label>
                <input type="number" min="0" inputMode="numeric" placeholder="Leave blank for exact cash" value={cashReceived} onChange={e => setCashReceived(e.target.value)} onFocus={() => openTouchInput({ title: "Cash received", mode: "number", value: cashReceived, setValue: setCashReceived, allowDecimal: true })} className="w-full bg-surface-1 border border-surface-4 rounded p-1.5 text-sm font-mono text-white outline-none focus:border-success mb-1" />
                {cashReceivedValue > 0 && cashReceivedValue < grandTotal && (
                  <div className="text-xs font-bold text-warning mt-1">Received is short by {toMoney(grandTotal - cashReceivedValue)}</div>
                )}
                {cashReceivedValue > grandTotal && (
                  <div className="text-xs font-bold text-success animate-bounce-in mt-1">Change: {toMoney(changeToReturn)}</div>
                )}
              </div>
            )}

            {paymentMode === "ONLINE" && (
              <div className="flex flex-col items-center justify-center bg-info/10 border border-info/30 rounded-lg p-3 animate-slide-up text-center">
                <div className="text-[10px] font-bold text-info uppercase tracking-widest mb-1">Online / Digital Paid</div>
                <div className="text-2xl font-black font-mono text-info">{toMoney(grandTotal)}</div>
              </div>
            )}
            
            {paymentMode === "SPLIT" && (
              <div className="flex flex-col bg-surface-2 border border-surface-4 rounded-lg p-2 animate-slide-up relative">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-[10px] font-bold text-text-secondary uppercase">
                    Cash
                    <input type="number" placeholder="Rs" value={cashReceived} onChange={e => setCashReceived(e.target.value)} onFocus={() => openTouchInput({ title: "Split cash", mode: "number", value: cashReceived, setValue: setCashReceived, allowDecimal: true })} className="mt-1 w-full bg-surface-1 border border-surface-4 rounded p-1.5 text-sm font-mono text-white outline-none focus:border-success" />
                  </label>
                  <label className="text-[10px] font-bold text-text-secondary uppercase">
                    Online
                    <input type="number" placeholder="Rs" value={onlineReceived} onChange={e => setOnlineReceived(e.target.value)} onFocus={() => openTouchInput({ title: "Split online", mode: "number", value: onlineReceived, setValue: setOnlineReceived, allowDecimal: true })} className="mt-1 w-full bg-surface-1 border border-surface-4 rounded p-1.5 text-sm font-mono text-white outline-none focus:border-info" />
                  </label>
                </div>
                <div className="mt-2 space-y-1 text-xs font-mono">
                  <div className="flex justify-between text-success"><span>Cash</span><span>{toMoney(cashReceivedValue)}</span></div>
                  <div className="flex justify-between text-info"><span>Online</span><span>{toMoney(onlineReceivedValue)}</span></div>
                  <div className={cn("flex justify-between font-bold", splitRemaining === 0 ? "text-success" : "text-warning")}><span>Remaining</span><span>{toMoney(splitRemaining)}</span></div>
                </div>
              </div>
            )}

            {paymentMode === "CREDIT" && (
              <div className="flex flex-col items-center justify-center text-danger/50 font-bold tracking-widest text-sm text-center">
                FULL KHATA<br/>{toMoney(grandTotal)} DUE
              </div>
            )}
          </div>

          {/* Section 4: Actions */}
          <div className="border-t border-surface-4 p-4 flex flex-col gap-3 bg-surface-2 shrink-0">
            <button 
              onClick={handleCheckout} 
              disabled={!ratesReady || items.length === 0 || isSubmitting || (paymentMode === "CREDIT" && !selectedCustomerId)}
              className="w-full h-14 bg-success hover:bg-success/90 disabled:bg-surface-4 disabled:text-text-secondary text-white font-black text-xl rounded-xl shadow-glow disabled:shadow-none transition-all flex items-center justify-center gap-2 active:scale-95"
            >
              {!ratesReady ? "ENTER TODAY'S RATES" : isSubmitting ? "..." : (paymentMode === "CASH" ? "CASH ✓" : (paymentMode === "ONLINE" ? "ONLINE ✓" : (paymentMode === "CREDIT" ? "KHATA ✓" : "SPLIT ✓")))}
            </button>
            
            <div className="flex gap-2 h-10">
              <div className="relative flex-1">
                <button 
                  onClick={holdBill}
                  disabled={items.length === 0}
                  className="w-full h-full bg-surface-3 hover:bg-surface-4 border border-surface-4 text-text-primary text-sm font-bold rounded-lg disabled:opacity-50 transition-colors"
                >
                  HOLD
                </button>
                {heldBills.length > 0 && (
                  <button 
                    onClick={() => setShowHoldPicker(!showHoldPicker)}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-info text-white text-xs font-bold rounded-full flex items-center justify-center shadow-md animate-bounce-in z-10"
                  >
                    {heldBills.length}
                  </button>
                )}
                {/* Hold Picker */}
                {showHoldPicker && heldBills.length > 0 && (
                  <div className="absolute bottom-full right-0 mb-3 w-64 bg-surface-2 border border-surface-4 rounded-lg shadow-float p-2 flex flex-col gap-2">
                    <div className="text-xs font-bold text-text-secondary px-2 py-1 uppercase">Parked Bills</div>
                    {heldBills.map((b, i) => (
                       <div key={b.id} className="p-2 bg-surface-3 hover:bg-surface-4 rounded-md text-left flex justify-between items-center transition-colors group">
                         <button onClick={() => resumeBill(b)} className="flex-1 text-left">
                           <div className="font-bold text-sm text-white">{b.customerName}</div>
                           <div className="text-[10px] text-text-secondary">{format(new Date(b.time), "hh:mm a")} • {b.items.length} items</div>
                         </button>
                         <div className="flex items-center gap-2">
                           <div className="font-mono text-accent font-bold text-xs">{toMoney(b.subtotal)}</div>
                           <button onClick={(e) => discardHeldBill(e, b.id)} className="text-danger opacity-0 group-hover:opacity-100 p-1 hover:bg-danger/20 rounded">
                             <X className="w-3 h-3" />
                           </button>
                         </div>
                       </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

      </div>

      {todayRateMissing && (
        <div className="fixed inset-0 z-[130] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-warning/40 bg-surface-2 shadow-float overflow-hidden">
            <div className="border-b border-surface-4 bg-surface-3 p-5">
              <h2 className="text-xl font-black text-white">Enter Today's Rates</h2>
              <p className="mt-1 text-sm text-text-secondary">Sales are locked until today's milk and yogurt rates are saved.</p>
            </div>
            <div className="p-5 space-y-4">
              {rates.date && (
                <div className="rounded-lg border border-surface-4 bg-surface-1 px-3 py-2 text-xs text-text-secondary">
                  Last saved rates from {rates.date}: Milk Rs.{rates.milk_rate}, Yogurt Rs.{rates.yogurt_rate}
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-text-secondary">Milk Rs/kg</label>
                  <input
                    type="number"
                    min="1"
                    value={rateEntry.milkRate}
                    onChange={(event) => setRateEntry((prev) => ({ ...prev, milkRate: event.target.value }))}
                    onFocus={() => openTouchInput({ title: "Milk rate", mode: "number", value: rateEntry.milkRate, setValue: (value) => setRateEntry((prev) => ({ ...prev, milkRate: value })), allowDecimal: true })}
                    className="input text-xl font-mono"
                    autoFocus
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-bold uppercase text-text-secondary">Yogurt Rs/kg</label>
                  <input
                    type="number"
                    min="1"
                    value={rateEntry.yogurtRate}
                    onChange={(event) => setRateEntry((prev) => ({ ...prev, yogurtRate: event.target.value }))}
                    onFocus={() => openTouchInput({ title: "Yogurt rate", mode: "number", value: rateEntry.yogurtRate, setValue: (value) => setRateEntry((prev) => ({ ...prev, yogurtRate: value })), allowDecimal: true })}
                    className="input text-xl font-mono"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold uppercase text-text-secondary">Manager PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={rateEntry.managerPin}
                  onChange={(event) => setRateEntry((prev) => ({ ...prev, managerPin: event.target.value }))}
                  onFocus={() => openTouchInput({ title: "Manager PIN", mode: "number", value: rateEntry.managerPin, setValue: (value) => setRateEntry((prev) => ({ ...prev, managerPin: value })), masked: true })}
                  onKeyDown={(event) => event.key === "Enter" && saveTodaysRates()}
                  className="input text-center text-2xl font-mono tracking-widest"
                  placeholder="PIN"
                />
              </div>
            </div>
            <div className="border-t border-surface-4 bg-surface-3 p-4">
              <button
                onClick={saveTodaysRates}
                disabled={isSavingRates}
                className="btn-primary h-12 w-full text-base font-black"
              >
                {isSavingRates ? "Saving..." : "Save Rates and Unlock POS"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RECEIPT MODAL */}
      {receiptData && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-white rounded-lg shadow-float w-full max-w-sm overflow-hidden flex flex-col">
            <div className="p-6 text-gray-900 print-receipt font-mono text-sm leading-relaxed">
              <div className="text-center mb-4">
                <h2 className="text-2xl font-black tracking-tight">GUJJAR MILK SHOP</h2>
                <p className="text-xs mt-1 font-medium">Fresh. Fast. Trusted.</p>
                <div className="border-b-2 border-dashed border-gray-400 my-3" />
              </div>
              <div className="mb-4 text-xs space-y-1">
                <div>Bill: <span className="font-bold">{receiptData.billNumber}</span></div>
                <div>Date: {format(receiptData.date, "dd-MMM-yyyy hh:mm a")}</div>
                {receiptData.paymentType === "CREDIT" ? (
                  <div className="mt-2 text-sm font-bold bg-gray-200 p-1 text-center border border-gray-400">
                    CREDIT SALE: {receiptData.customer}
                  </div>
                ) : receiptData.paymentType === "ONLINE" || receiptData.paymentType === "SPLIT" ? (
                  <div className="mt-2 text-sm font-bold bg-gray-200 p-1 text-center border border-gray-400">
                    {receiptData.paymentType === "ONLINE" ? "ONLINE PAYMENT" : "CASH + ONLINE SPLIT"}
                  </div>
                ) : (
                  <div>Customer: Walk-in</div>
                )}
                <div className="border-b-2 border-dashed border-gray-400 my-3" />
              </div>
              <div className="space-y-2 mb-4">
                {receiptData.items.map((i: any) => (
                  <div key={i.id} className="flex justify-between text-xs">
                    <span className="truncate w-32 font-bold">{i.name}</span>
                    <span>{i.quantity.toFixed(2)} <span className="text-[10px] text-gray-500">x{i.price}</span></span>
                    <span className="font-bold">{i.lineTotal.toFixed(0)}</span>
                    {i.discountAmount > 0 && (
                      <div className="basis-full text-[10px] text-gray-500 text-right">Item discount -Rs. {i.discountAmount.toFixed(0)}</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="border-t-2 border-dashed border-gray-400 pt-3 mb-4 text-xs space-y-1.5">
                <div className="flex justify-between"><span>Subtotal:</span><span>Rs. {receiptData.subtotal.toFixed(0)}</span></div>
                {receiptData.discount > 0 && (
                  <div className="flex justify-between"><span>Discount:</span><span>-Rs. {receiptData.discount.toFixed(0)}</span></div>
                )}
                {receiptData.taxAmount > 0 && (
                  <div className="flex justify-between"><span>{receiptData.taxLabel || "Tax"}:</span><span>Rs. {receiptData.taxAmount.toFixed(0)}</span></div>
                )}
                <div className="flex justify-between font-black text-base mt-2 pt-2 border-t border-gray-300"><span>TOTAL:</span><span>Rs. {receiptData.grandTotal.toFixed(0)}</span></div>
                
                {receiptData.paymentType === "CASH" && receiptData.amountPaid > receiptData.grandTotal && (
                  <>
                    <div className="flex justify-between mt-2 text-[10px]"><span>Cash Received:</span><span>Rs. {receiptData.amountPaid.toFixed(0)}</span></div>
                    <div className="flex justify-between text-[10px]"><span>Change:</span><span>Rs. {receiptData.changeToReturn.toFixed(0)}</span></div>
                  </>
                )}
                
                {receiptData.paymentType === "ONLINE" && (
                  <div className="flex justify-between mt-2"><span>Online Paid:</span><span>Rs. {receiptData.onlinePaid.toFixed(0)}</span></div>
                )}

                {receiptData.paymentType === "SPLIT" && (
                  <>
                    <div className="flex justify-between mt-2"><span>Cash Paid:</span><span>Rs. {receiptData.cashPaid.toFixed(0)}</span></div>
                    <div className="flex justify-between"><span>Online Paid:</span><span>Rs. {receiptData.onlinePaid.toFixed(0)}</span></div>
                  </>
                )}
              </div>
              <div className="text-center text-xs mt-6 font-medium">
                <div className="border-2 border-gray-900 p-2 mb-3 font-black">
                  ITEM COUNTER: KEEP THIS RECEIPT<br />
                  DO NOT RETURN TO CUSTOMER
                </div>
                <p>Thank you! Come again 🙏</p>
              </div>
            </div>
            
            <div className="p-4 bg-gray-100 border-t border-gray-200 flex gap-3">
              <button 
                onClick={async () => {
                  try {
                    const res = await window.electronAPI?.printer?.printReceipt(receiptData);
                    if (!res?.success) {
                      alert(res?.error || "Receipt did not print. Please check the printer and try again.");
                    }
                  } catch (err: any) {
                    alert(err?.message || "Receipt did not print. Please check the printer and try again.");
                  }
                }}
                className="flex-1 bg-gray-800 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-gray-700 transition-colors shadow-md active:scale-95"
              >
                <ReceiptIcon className="w-5 h-5" /> PRINT
              </button>
              <button 
                onClick={() => setReceiptData(null)}
                className="flex-1 bg-green-600 text-white font-bold py-4 rounded-xl flex items-center justify-center gap-2 hover:bg-green-500 transition-colors shadow-md active:scale-95"
              >
                <Check className="w-5 h-5" /> DONE (Esc)
              </button>
            </div>
          </div>
        </div>
      )}

      {discountItem && (
        <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-surface-2 border border-surface-4 rounded-xl shadow-float overflow-hidden animate-slide-up">
            <div className="p-4 border-b border-surface-4">
              <h2 className="text-lg font-bold text-text-primary">Item Discount</h2>
              <p className="text-sm text-text-secondary mt-1">{discountItem.name} - {toMoney(discountItem.quantity * discountItem.price)}</p>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => setItemDiscountType("RS")} className={cn("rounded-lg py-2 font-bold text-sm", itemDiscountType === "RS" ? "bg-primary text-white" : "bg-surface-3 text-text-secondary")}>Rs.</button>
                <button onClick={() => setItemDiscountType("PERCENT")} className={cn("rounded-lg py-2 font-bold text-sm", itemDiscountType === "PERCENT" ? "bg-primary text-white" : "bg-surface-3 text-text-secondary")}>%</button>
              </div>
              <input
                type="number"
                min="0"
                max={itemDiscountType === "PERCENT" ? "100" : undefined}
                value={itemDiscountInput}
                onChange={(event) => setItemDiscountInput(event.target.value)}
                onFocus={() => openTouchInput({ title: "Item discount", mode: "number", value: itemDiscountInput, setValue: setItemDiscountInput, allowDecimal: true })}
                className="w-full bg-surface-1 border border-surface-4 rounded-lg px-4 py-3 text-lg font-mono text-white outline-none focus:border-primary"
                placeholder={itemDiscountType === "PERCENT" ? "Discount %" : "Discount Rs."}
              />
              <div className="text-xs text-text-secondary">
                This discount applies only to this item line, not the whole bill.
              </div>
            </div>
            <div className="p-4 border-t border-surface-4 flex gap-2">
              <button onClick={() => { setItemDiscount(discountItem.id, "NONE", 0); setDiscountItem(null); }} className="btn-secondary flex-1">Remove</button>
              <button onClick={() => setDiscountItem(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={applyItemDiscount} className="btn-primary flex-1">Apply</button>
            </div>
          </div>
        </div>
      )}

      {/* END OF DAY MODAL */}
      {endOfDayData && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 border border-surface-4 rounded-xl shadow-float w-full max-w-sm overflow-hidden flex flex-col">
            <div className="p-4 border-b border-surface-4 bg-surface-3 flex justify-between items-center">
              <h2 className="font-bold text-lg text-white">📊 Today's Summary</h2>
              <button onClick={() => setEndOfDayData(null)} className="text-text-secondary hover:text-white">✕</button>
            </div>
            <div className="p-6 text-sm text-text-primary space-y-4">
              <div className="text-center font-bold text-accent mb-2">
                {format(new Date(endOfDayData.date), "dd MMMM yyyy")}
              </div>
              
              <div className="space-y-2">
                <div className="flex justify-between"><span>Total Bills:</span><span className="font-bold">{endOfDayData.bills}</span></div>
                <div className="flex justify-between font-bold text-base mt-1 text-success"><span>Total Sales:</span><span>{toMoney(endOfDayData.totalSales)}</span></div>
              </div>
              
              <div className="border-t border-surface-4 pt-4 space-y-2">
                <div className="flex justify-between text-success"><span>Cash Sales:</span><span>{toMoney(endOfDayData.cashSales)}</span></div>
                <div className="flex justify-between text-danger"><span>Credit Sales:</span><span>{toMoney(endOfDayData.creditSales)}</span></div>
              </div>

              <div className="border-t border-surface-4 pt-4 space-y-2">
                <div className="flex justify-between"><span>Milk Sold:</span><span className="font-mono">{endOfDayData.milkSold?.toFixed(2)} kg</span></div>
                <div className="flex justify-between"><span>Yogurt Sold:</span><span className="font-mono">{endOfDayData.yogurtSold?.toFixed(2)} kg</span></div>
              </div>

              <div className="border-t border-surface-4 pt-4 space-y-2">
                <div className="flex justify-between text-danger"><span>Expenses:</span><span>{toMoney(endOfDayData.expenses)}</span></div>
                <div className="flex justify-between font-bold text-info"><span>Net Profit:</span><span>{toMoney(endOfDayData.totalSales - endOfDayData.expenses)}</span></div>
              </div>

              <div className="border-t border-surface-4 pt-4 bg-surface-3 -mx-6 px-6 pb-2 mt-4 space-y-2">
                <div className="flex justify-between items-center mt-2">
                  <span>Physical Cash Count:</span>
                  <input 
                    type="number" 
                    value={physicalCash} 
                    onChange={e => setPhysicalCash(e.target.value)}
                    onFocus={() => openTouchInput({ title: "Physical cash count", mode: "number", value: physicalCash, setValue: setPhysicalCash, allowDecimal: true })}
                    className="w-32 bg-surface-1 border border-surface-4 rounded px-2 py-1 text-sm font-mono text-white text-right focus:border-success outline-none"
                  />
                </div>
                <div className="flex justify-between text-text-secondary mt-2"><span>System Expected:</span><span className="font-mono">{toMoney(endOfDayData.cashInDrawer)}</span></div>
                
                {(() => {
                  const physical = Number(physicalCash) || 0;
                  const diff = physical - endOfDayData.cashInDrawer;
                  return (
                    <div className="flex justify-between font-bold mt-1 pt-2 border-t border-surface-4">
                      <span>Variance:</span>
                      <span className={cn("font-mono", diff < 0 ? "text-danger" : (diff > 0 ? "text-warning" : "text-success"))}>
                        {diff > 0 ? "+" : ""}{toMoney(diff)}
                        {diff < 0 && " ⚠"}
                      </span>
                    </div>
                  );
                })()}
              </div>
            </div>
            
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button 
                onClick={() => { window.print(); }}
                className="flex-1 bg-surface-4 text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-surface-4/80 transition-colors"
              >
                Print
              </button>
              <button 
                onClick={async () => {
                  const physical = Number(physicalCash) || 0;
                  const diff = physical - endOfDayData.cashInDrawer;
                  await window.electronAPI?.reports?.closeRegister({
                    date: endOfDayData.date,
                    physicalCash: physical,
                    expectedCash: endOfDayData.cashInDrawer,
                    difference: diff
                  });
                  setEndOfDayData(null);
                  alert("Day Closed Successfully.");
                }}
                className="flex-1 bg-success text-white font-bold py-3 rounded-lg flex items-center justify-center gap-2 hover:bg-success/90 transition-colors"
              >
                Close Day ✓
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Shortcut Help Modal */}
      {showShortcutHelp && (
        <div className="fixed inset-0 z-[110] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-2 border border-surface-4 rounded-xl shadow-float w-full max-w-md overflow-hidden animate-bounce-in">
            <div className="p-4 border-b border-surface-4 bg-surface-3 flex justify-between items-center">
              <h2 className="font-bold text-lg text-white">⌨ Keyboard Shortcuts</h2>
              <button onClick={() => setShowShortcutHelp(false)} className="text-text-secondary hover:text-white">✕</button>
            </div>
            <div className="p-6 grid grid-cols-1 gap-3">
              <div className="flex justify-between items-center text-sm"><span className="text-text-secondary">Other Items List</span><kbd className="bg-surface-4 px-2 py-1 rounded font-mono text-xs text-accent">F2</kbd></div>
              <div className="flex justify-between items-center text-sm"><span className="text-text-secondary">Held Bills Panel</span><kbd className="bg-surface-4 px-2 py-1 rounded font-mono text-xs text-accent">F1</kbd></div>
              <div className="flex justify-between items-center text-sm"><span className="text-text-secondary">Toggle Payment Mode</span><kbd className="bg-surface-4 px-2 py-1 rounded font-mono text-xs text-accent">F3</kbd></div>
              <div className="flex justify-between items-center text-sm"><span className="text-text-secondary">Open Discount</span><kbd className="bg-surface-4 px-2 py-1 rounded font-mono text-xs text-accent">F4</kbd></div>
              <div className="flex justify-between items-center text-sm"><span className="text-text-secondary">Complete Sale</span><kbd className="bg-surface-4 px-2 py-1 rounded font-mono text-xs text-accent">Enter</kbd></div>
              <div className="flex justify-between items-center text-sm"><span className="text-text-secondary">Hold Current Bill</span><kbd className="bg-surface-4 px-2 py-1 rounded font-mono text-xs text-accent">Ctrl + H</kbd></div>
              <div className="flex justify-between items-center text-sm"><span className="text-text-secondary">Undo Last Item</span><kbd className="bg-surface-4 px-2 py-1 rounded font-mono text-xs text-accent">Ctrl + Z</kbd></div>
              <div className="flex justify-between items-center text-sm"><span className="text-text-secondary">Reprint Last Bill</span><kbd className="bg-surface-4 px-2 py-1 rounded font-mono text-xs text-accent">Ctrl + P</kbd></div>
              <div className="flex justify-between items-center text-sm"><span className="text-text-secondary">End of Day Summary</span><kbd className="bg-surface-4 px-2 py-1 rounded font-mono text-xs text-accent">Ctrl + D</kbd></div>
              <div className="flex justify-between items-center text-sm pt-2 border-t border-surface-4"><span className="text-text-secondary">Show this Help</span><kbd className="bg-surface-4 px-2 py-1 rounded font-mono text-xs text-accent">?</kbd></div>
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex justify-end">
              <button onClick={() => setShowShortcutHelp(false)} className="btn-primary text-sm px-6">Close</button>
            </div>
          </div>
        </div>
      )}

      {/* MANAGER PIN MODAL (discount approval) */}
      {discountPinModal && (
        <div className="fixed inset-0 z-[120] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-2 border border-surface-4 rounded-xl shadow-float w-full max-w-xs overflow-hidden animate-bounce-in">
            <div className="p-4 border-b border-surface-4 bg-surface-3 flex justify-between items-center">
              <h2 className="font-bold text-base text-white">Manager Approval</h2>
              <button onClick={() => resolveDiscountPin(null)} className="text-text-secondary hover:text-white">✕</button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-sm text-text-secondary text-center">{discountPinLabel}</p>
              <input
                type="password"
                inputMode="numeric"
                value={discountPinInput}
                onChange={e => setDiscountPinInput(e.target.value)}
                onFocus={() => openTouchInput({ title: "Manager PIN", mode: "number", value: discountPinInput, setValue: setDiscountPinInput, masked: true })}
                onKeyDown={e => e.key === "Enter" && resolveDiscountPin(discountPinInput)}
                className="input font-mono text-2xl text-center tracking-widest py-4"
                placeholder="••••"
                autoFocus
              />
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => resolveDiscountPin(null)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={() => resolveDiscountPin(discountPinInput)} disabled={!discountPinInput} className="btn-primary flex-1">
                Approve
              </button>
            </div>
          </div>
        </div>
      )}
      {touchInput && (
        <TouchInputPad input={touchInput} onClose={() => setTouchInput(null)} />
      )}
    </div>
  );
}
