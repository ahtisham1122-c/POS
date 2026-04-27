"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { customerService, dailyRateService, productService, saleService } from "@/services/api";
import { useAuthStore } from "@/store/authStore";
import {
  selectDiscountAmount,
  selectGrandTotal,
  selectSubtotal,
  useCartStore,
} from "@/store/cartStore";
import { formatCurrency, cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppModal } from "@/components/shared/AppModal";
import { EmptyState } from "@/components/shared/EmptyState";
import { LoadingSkeleton } from "@/components/shared/LoadingSkeleton";
import {
  Banknote,
  CheckCircle2,
  ChevronLeft,
  CreditCard,
  PanelRight,
  HelpCircle,
  History,
  Minus,
  Pencil,
  Plus,
  Printer,
  Search,
  ShoppingCart,
  Trash2,
  User2,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";

type PaymentMode = "CASH" | "CREDIT" | "PARTIAL";
type QuickMode = "MILK" | "YOGURT" | null;

const tabs = [
  { value: "ALL", label: "All" },
  { value: "MILK", label: "🥛 Milk" },
  { value: "YOGURT", label: "🫙 Yogurt" },
  { value: "BUTTER_CREAM", label: "🧈 Ghee" },
  { value: "DRINKS", label: "🥤 Drinks" },
  { value: "CHEESE", label: "🧀 Cheese" },
  { value: "SWEETS", label: "🍬 Sweets" },
  { value: "OTHER", label: "📦 Other" },
];

const milkPresets = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10];
const yogurtWeightPresets = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const yogurtAmountPresets = [50, 100, 150, 200, 250, 300];

function getEffectivePrice(product: any, rates: any) {
  if (product.category === "MILK") return Number(rates?.milkRate || product.sellingPrice || 0);
  if (product.category === "YOGURT") return Number(rates?.yogurtRate || product.sellingPrice || 0);
  return Number(product.sellingPrice || 0);
}

export default function POSPage() {
  const queryClient = useQueryClient();
  const searchRef = useRef<HTMLInputElement>(null);
  const customerRef = useRef<HTMLInputElement>(null);
  const cart = useCartStore();
  const user = useAuthStore((state) => state.user);

  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState("ALL");
  const [quickMode, setQuickMode] = useState<QuickMode>(null);
  const [splitAmount, setSplitAmount] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [receiptData, setReceiptData] = useState<any>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [heldDrawerOpen, setHeldDrawerOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [rateEditorOpen, setRateEditorOpen] = useState(false);
  const [milkRateEdit, setMilkRateEdit] = useState("");
  const [yogurtRateEdit, setYogurtRateEdit] = useState("");
  const [customQty, setCustomQty] = useState("");
  const [customYogurtMode, setCustomYogurtMode] = useState<"KG" | "RS">("KG");

  const { data: products, isLoading: productsLoading } = useQuery<any>({
    queryKey: ["products", "pos", search],
    queryFn: () => productService.getAll({ search }),
  });

  const { data: customers, isFetching: customersLoading } = useQuery<any>({
    queryKey: ["customers", "pos", customerSearch],
    queryFn: () => customerService.getAll({ search: customerSearch }),
  });

  const { data: todayRates } = useQuery<any>({
    queryKey: ["daily-rates", "today"],
    queryFn: () => dailyRateService.getToday(),
  });

  const saleMutation = useMutation({
    mutationFn: saleService.create,
    onSuccess: (response: any) => {
      setReceiptData(response);
      cart.clearCart();
      setSplitAmount("");
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["sales"] });
      queryClient.invalidateQueries({ queryKey: ["customers"] });
      queryClient.invalidateQueries({ queryKey: ["reports"] });
      toast.success("Sale completed successfully");
    },
    onError: (error: any) => toast.error(error.message || "Failed to complete sale"),
  });

  const updateRateMutation = useMutation({
    mutationFn: dailyRateService.update,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-rates"] });
      setRateEditorOpen(false);
      toast.success("Daily rates updated");
    },
    onError: (error: any) => toast.error(error.message || "Failed to update rates"),
  });

  const productsList = products ?? [];
  const filteredProducts = useMemo(() => {
    if (activeTab === "ALL") return productsList;
    return productsList.filter((product: any) => product.category === activeTab);
  }, [productsList, activeTab]);

  const milkProduct = useMemo(
    () => productsList.find((product: any) => product.category === "MILK"),
    [productsList]
  );
  const yogurtProduct = useMemo(
    () => productsList.find((product: any) => product.category === "YOGURT"),
    [productsList]
  );

  const subtotal = selectSubtotal(cart);
  const discountAmount = selectDiscountAmount(cart);
  const grandTotal = Math.max(0, selectGrandTotal(cart));
  const split = Number(splitAmount || 0);
  const balanceDue = Math.max(0, grandTotal - split);
  const milkRate = Number(todayRates?.milkRate || milkProduct?.sellingPrice || 0);
  const yogurtRate = Number(todayRates?.yogurtRate || yogurtProduct?.sellingPrice || 0);
  const canEditRates = user?.role === "ADMIN" || user?.role === "MANAGER";

  const selectedCustomer = useMemo(() => {
    if (!cart.customerId) return null;
    return (customers ?? []).find((customer: any) => customer.id === cart.customerId) ?? null;
  }, [cart.customerId, customers]);

  const completeSale = (mode: PaymentMode) => {
    if (!cart.items.length) {
      toast.error("Cart is empty");
      return;
    }

    let amountPaid = grandTotal;
    let paymentType: PaymentMode = mode;

    if (mode === "CREDIT") {
      if (!cart.customerId) {
        toast.error("Select a customer for credit sale");
        return;
      }
      amountPaid = 0;
    }

    if (mode === "PARTIAL") {
      if (!cart.customerId) {
        toast.error("Select customer for partial payment");
        return;
      }
      if (split <= 0 || split >= grandTotal) {
        toast.error("Partial amount must be greater than 0 and less than total");
        return;
      }
      amountPaid = split;
    }

    saleMutation.mutate({
      customerId: cart.customerId,
      paymentType,
      amountPaid,
      discountType: cart.discountType,
      discountValue: cart.discountValue,
      items: cart.items.map((item) => ({
        productId: item.productId,
        quantity: item.qty,
        unitPrice: item.unitPrice,
      })),
    });
  };

  const addProduct = (product: any, qty = 1, unitPrice?: number) => {
    const price = unitPrice ?? getEffectivePrice(product, todayRates);
    cart.addItem(product, qty, price);
  };

  const addMilkByQty = (qty: number) => {
    if (!milkProduct) return;
    addProduct(milkProduct, qty, milkRate);
    toast.success(`Milk added: ${qty.toFixed(2)} kg`);
  };

  const addYogurtByQty = (qty: number) => {
    if (!yogurtProduct) return;
    addProduct(yogurtProduct, qty, yogurtRate);
    toast.success(`Yogurt added: ${qty.toFixed(2)} kg`);
  };

  const saveRates = () => {
    const milk = Number(milkRateEdit || milkRate);
    const yogurt = Number(yogurtRateEdit || yogurtRate);
    if (milk <= 0 || yogurt <= 0) {
      toast.error("Rates must be greater than zero");
      return;
    }
    updateRateMutation.mutate({ milkRate: milk, yogurtRate: yogurt });
  };

  const holdCurrentBill = () => {
    if (!cart.items.length) {
      toast.error("No items in current bill");
      return;
    }
    cart.holdBill();
    toast.success("Bill held");
  };

  const startNewSale = () => {
    cart.clearCart();
    setSplitAmount("");
    setDiscountOpen(false);
    toast.success("New sale started");
  };

  const printLastReceipt = () => {
    if (!receiptData) {
      toast.error("No receipt to print");
      return;
    }
    window.print();
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "F2") {
        event.preventDefault();
        searchRef.current?.focus();
      }

      if (event.key === "Enter" && cart.items.length > 0 && !saleMutation.isPending) {
        const target = event.target as HTMLElement | null;
        if (!target || target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          event.preventDefault();
          completeSale("CASH");
        }
      }

      if (event.key === "Escape") {
        if (shortcutsOpen) setShortcutsOpen(false);
        if (rateEditorOpen) setRateEditorOpen(false);
        if (heldDrawerOpen) setHeldDrawerOpen(false);
        if (quickMode) setQuickMode(null);
      }

      if (event.key === "?" && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        setShortcutsOpen(true);
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "h") {
        event.preventDefault();
        holdCurrentBill();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
        event.preventDefault();
        startNewSale();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        printLastReceipt();
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        customerRef.current?.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    cart.items.length,
    heldDrawerOpen,
    quickMode,
    rateEditorOpen,
    receiptData,
    saleMutation.isPending,
    shortcutsOpen,
    split,
    grandTotal,
    cart.customerId,
  ]);

  useEffect(() => {
    if (!rateEditorOpen) return;
    setMilkRateEdit(String(milkRate || ""));
    setYogurtRateEdit(String(yogurtRate || ""));
  }, [rateEditorOpen, milkRate, yogurtRate]);

  return (
    <div className="-m-4 md:-m-6 min-h-[calc(100vh-56px)] bg-bg text-text">
      <div className="grid h-[calc(100vh-56px)] grid-cols-1 lg:grid-cols-[62%_38%]">
        <section className="flex min-h-0 flex-col border-r border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="relative w-full max-w-lg">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
                <Input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products... (F2)"
                  className="h-12 rounded-lg border-border bg-surface-2 pl-10"
                />
              </div>

              <div className="inline-flex items-center gap-2 rounded-full border border-warning/40 bg-warning/15 px-3 py-2 text-sm font-medium text-warning">
                <span>🥛 Rs.{milkRate}/kg</span>
                <span className="opacity-70">|</span>
                <span>🫙 Rs.{yogurtRate}/kg</span>
                {canEditRates && (
                  <button
                    onClick={() => setRateEditorOpen(true)}
                    className="ml-1 rounded p-1 transition-colors hover:bg-warning/25"
                    aria-label="Edit daily rates"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>

            <Tabs value={activeTab} onValueChange={(value) => { setActiveTab(value); setQuickMode(null); }}>
              <TabsList className="hide-scrollbar h-12 w-full justify-start overflow-x-auto rounded-lg bg-surface-2 p-1">
                {tabs.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="h-10 rounded-md whitespace-nowrap data-[state=active]:bg-primary data-[state=active]:text-white"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          </div>

          <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            {productsLoading ? (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
                {Array.from({ length: 12 }).map((_, index) => (
                  <LoadingSkeleton key={index} className="h-[180px] w-full rounded-lg" />
                ))}
              </div>
            ) : quickMode === "MILK" ? (
              <MilkQuickEntry
                rate={milkRate}
                onBack={() => setQuickMode(null)}
                onAddQty={addMilkByQty}
                customQty={customQty}
                setCustomQty={setCustomQty}
              />
            ) : quickMode === "YOGURT" ? (
              <YogurtQuickEntry
                rate={yogurtRate}
                onBack={() => setQuickMode(null)}
                onAddQty={addYogurtByQty}
                customQty={customQty}
                setCustomQty={setCustomQty}
                customMode={customYogurtMode}
                setCustomMode={setCustomYogurtMode}
              />
            ) : filteredProducts.length === 0 ? (
              <EmptyState
                icon={ShoppingCart}
                title="No products found"
                description="Try changing the category or search text."
              />
            ) : (
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 2xl:grid-cols-4">
                {filteredProducts.map((product: any) => {
                  const outOfStock = Number(product.stock) <= 0;
                  const lowStock = Number(product.stock) <= Number(product.lowStockThreshold || 0);
                  const price = getEffectivePrice(product, todayRates);
                  return (
                    <button
                      key={product.id}
                      onClick={() => {
                        if (product.category === "MILK") {
                          setQuickMode("MILK");
                          setCustomQty("");
                          return;
                        }
                        if (product.category === "YOGURT") {
                          setQuickMode("YOGURT");
                          setCustomQty("");
                          return;
                        }
                        addProduct(product, 1, price);
                      }}
                      disabled={outOfStock}
                      className={cn(
                        "interactive rounded-lg border border-border bg-surface-2 p-3 text-left transition-all",
                        "hover:border-primary/60 hover:shadow-glow active:scale-[0.98]",
                        outOfStock && "cursor-not-allowed opacity-50"
                      )}
                    >
                      <div className="mb-2 text-4xl leading-none">{product.emoji || "📦"}</div>
                      <p className="line-clamp-1 text-sm font-semibold text-text">{product.name}</p>
                      <p className="mt-0.5 text-xs text-text-secondary">{product.unit} • {formatCurrency(price)}</p>
                      <div className="mt-2">
                        <Badge
                          className={cn(
                            "h-6 rounded-full border text-[11px]",
                            outOfStock && "border-danger/40 bg-danger/15 text-danger",
                            !outOfStock && lowStock && "border-warning/40 bg-warning/15 text-warning",
                            !outOfStock && !lowStock && "border-success/40 bg-success/15 text-success"
                          )}
                        >
                          {outOfStock ? "Out of Stock" : lowStock ? `⚠ ${product.stock} ${product.unit}` : `${product.stock} ${product.unit}`}
                        </Badge>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        <aside className="relative flex min-h-0 flex-col bg-surface-2">
          <div className="border-b border-border p-4">
            <Label className="mb-2 block text-xs uppercase tracking-wider text-text-secondary">Customer</Label>
            <div className="relative">
              <User2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
              <Input
                ref={customerRef}
                value={customerSearch}
                onChange={(e) => setCustomerSearch(e.target.value)}
                placeholder={cart.customerName || "Walk-in Customer"}
                className="h-11 rounded-lg border-border bg-surface pl-10"
              />
            </div>

            <div className="hide-scrollbar mt-2 max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface p-1">
              <button
                onClick={() => cart.setCustomer(null, "Walk-in Customer")}
                className={cn(
                  "flex h-10 w-full items-center justify-between rounded-md px-2 text-sm transition-colors",
                  !cart.customerId ? "bg-primary text-white" : "hover:bg-surface-3"
                )}
              >
                <span>Walk-in Customer</span>
                <span className="mono text-xs">{formatCurrency(0)}</span>
              </button>
              {customersLoading && (
                <div className="px-2 py-2 text-xs text-text-secondary">Loading customers...</div>
              )}
              {(customers ?? []).slice(0, 6).map((customer: any) => (
                <button
                  key={customer.id}
                  onClick={() => cart.setCustomer(customer.id, customer.name)}
                  className={cn(
                    "flex h-10 w-full items-center justify-between rounded-md px-2 text-sm transition-colors",
                    cart.customerId === customer.id ? "bg-primary text-white" : "hover:bg-surface-3"
                  )}
                >
                  <span className="truncate">{customer.name}</span>
                  <span className="mono text-xs">{formatCurrency(customer.currentBalance || 0)}</span>
                </button>
              ))}
            </div>

            {selectedCustomer && Number(selectedCustomer.currentBalance) > 0 && (
              <div className="mt-2 rounded-md border border-warning/40 bg-warning/15 px-2 py-1 text-xs text-warning">
                Pending due: {formatCurrency(selectedCustomer.currentBalance)}
              </div>
            )}
          </div>

          <div className="hide-scrollbar min-h-0 flex-1 overflow-y-auto p-4">
            {!cart.items.length ? (
              <EmptyState
                icon={ShoppingCart}
                title="Cart is empty"
                description="Select products from the left panel."
                className="min-h-[220px]"
              />
            ) : (
              <div className="space-y-2">
                {cart.items.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border bg-surface p-2.5 transition-all duration-200 hover:border-primary/40"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-text">{item.name}</p>
                        <p className="mono text-xs text-text-secondary">
                          {item.qty.toFixed(2)} {item.unit} × {formatCurrency(item.unitPrice)}
                        </p>
                      </div>
                      <button
                        onClick={() => cart.removeItem(item.productId)}
                        className="rounded p-1 text-text-secondary hover:bg-surface-2 hover:text-danger"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="inline-flex h-9 items-center rounded-full border border-border bg-surface-2 px-1">
                        <button
                          onClick={() => cart.updateQty(item.productId, Number((item.qty - 0.25).toFixed(2)))}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-surface-3"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="mono w-14 text-center text-sm">{item.qty.toFixed(2)}</span>
                        <button
                          onClick={() => cart.updateQty(item.productId, Number((item.qty + 0.25).toFixed(2)))}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-full hover:bg-surface-3"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <p className="mono text-sm font-semibold text-accent">{formatCurrency(item.lineTotal)}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-border p-4">
            <button
              onClick={() => setDiscountOpen((prev) => !prev)}
              className="mb-2 text-xs font-medium text-primary hover:text-primary-light"
            >
              {discountOpen ? "− Hide Discount" : "+ Add Discount"}
            </button>

            {discountOpen && (
              <div className="mb-3 rounded-lg border border-border bg-surface p-2.5">
                <div className="mb-2 grid grid-cols-2 gap-2">
                  <Button
                    variant={cart.discountType === "FLAT" ? "default" : "outline"}
                    className="h-9"
                    onClick={() => cart.setDiscount("FLAT", cart.discountValue || 0)}
                  >
                    Flat Rs.
                  </Button>
                  <Button
                    variant={cart.discountType === "PERCENTAGE" ? "default" : "outline"}
                    className="h-9"
                    onClick={() => cart.setDiscount("PERCENTAGE", cart.discountValue || 0)}
                  >
                    Percentage %
                  </Button>
                </div>
                <Input
                  type="number"
                  value={cart.discountValue}
                  onChange={(e) => cart.setDiscount(cart.discountType === "NONE" ? "FLAT" : cart.discountType, Number(e.target.value))}
                  className="h-10"
                />
                <p className="mt-1 text-xs text-success">Saving {formatCurrency(discountAmount)}</p>
              </div>
            )}

            <div className="mb-3 rounded-lg border border-border bg-surface p-3">
              <SummaryRow label="Subtotal" value={formatCurrency(subtotal)} />
              <SummaryRow label="Discount" value={`- ${formatCurrency(discountAmount)}`} />
              <div className="my-2 border-t border-border" />
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-text">TOTAL</span>
                <span className="mono text-2xl font-bold text-text">{formatCurrency(grandTotal)}</span>
              </div>
            </div>

            <div className="mb-3 grid grid-cols-3 gap-2">
              <PaymentTab
                active={cart.paymentType === "CASH"}
                icon={Banknote}
                label="CASH"
                onClick={() => cart.setPaymentType("CASH")}
              />
              <PaymentTab
                active={cart.paymentType === "CREDIT"}
                icon={Wallet}
                label="CREDIT"
                onClick={() => cart.setPaymentType("CREDIT")}
              />
              <PaymentTab
                active={cart.paymentType === "PARTIAL"}
                icon={CreditCard}
                label="PARTIAL"
                onClick={() => cart.setPaymentType("PARTIAL")}
              />
            </div>

            {cart.paymentType === "PARTIAL" && (
              <div className="mb-3 rounded-lg border border-border bg-surface p-2.5">
                <Label className="mb-1 block text-xs text-text-secondary">Amount Paid (Rs.)</Label>
                <Input
                  value={splitAmount}
                  onChange={(e) => setSplitAmount(e.target.value)}
                  type="number"
                  className="h-10"
                />
                <p className="mt-2 text-xs text-danger">
                  Remaining Due: <span className="mono font-semibold">{formatCurrency(balanceDue)}</span>
                </p>
              </div>
            )}

            <div className="mb-2 flex items-center justify-between">
              <button
                onClick={() => setHeldDrawerOpen(true)}
                className="inline-flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-text-secondary hover:bg-surface"
              >
                <History className="h-3.5 w-3.5" />
                Held Bills
                {cart.heldBills.length > 0 && (
                  <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-warning/20 px-1 text-warning">
                    {cart.heldBills.length}
                  </span>
                )}
              </button>
              <button
                onClick={() => setShortcutsOpen(true)}
                className="inline-flex items-center gap-1 text-xs text-text-secondary hover:text-text"
              >
                <HelpCircle className="h-3.5 w-3.5" />
                Shortcuts
              </button>
            </div>

            <div className="grid grid-cols-[1fr_1.5fr] gap-2">
              <Button
                variant="outline"
                className="h-12"
                onClick={holdCurrentBill}
              >
                HOLD BILL
              </Button>
              <Button
                className="h-12 bg-primary text-white hover:bg-primary-light"
                disabled={!cart.items.length || saleMutation.isPending}
                onClick={() => completeSale(cart.paymentType)}
              >
                {saleMutation.isPending ? "Processing..." : "COMPLETE SALE ✓"}
              </Button>
            </div>
          </div>

          <HeldBillsDrawer
            open={heldDrawerOpen}
            onClose={() => setHeldDrawerOpen(false)}
            onResume={(id) => {
              cart.resumeBill(id);
              setHeldDrawerOpen(false);
              toast.success("Held bill resumed");
            }}
            onDelete={(id) => cart.deleteHeldBill(id)}
            bills={cart.heldBills}
          />
        </aside>
      </div>

      <RateEditorModal
        open={rateEditorOpen}
        onOpenChange={setRateEditorOpen}
        milkRate={milkRateEdit}
        yogurtRate={yogurtRateEdit}
        onMilkChange={setMilkRateEdit}
        onYogurtChange={setYogurtRateEdit}
        onSave={saveRates}
        saving={updateRateMutation.isPending}
      />

      <ShortcutsModal open={shortcutsOpen} onOpenChange={setShortcutsOpen} />

      <ReceiptModal
        data={receiptData}
        onClose={() => setReceiptData(null)}
      />
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-text-secondary">{label}</span>
      <span className="mono text-text">{value}</span>
    </div>
  );
}

function PaymentTab({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "inline-flex h-12 flex-col items-center justify-center rounded-lg border text-[10px] font-semibold transition-all",
        active
          ? "border-primary bg-primary text-white"
          : "border-border bg-surface text-text-secondary hover:bg-surface-3"
      )}
    >
      <Icon className="mb-1 h-4 w-4" />
      {label}
    </button>
  );
}

function MilkQuickEntry({
  rate,
  onBack,
  onAddQty,
  customQty,
  setCustomQty,
}: {
  rate: number;
  onBack: () => void;
  onAddQty: (qty: number) => void;
  customQty: string;
  setCustomQty: (value: string) => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text">🥛 Fresh Milk • Rs.{rate}/kg</h3>
        <Button variant="outline" className="h-10" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {milkPresets.map((qty) => (
          <button
            key={qty}
            onClick={() => onAddQty(qty)}
            className="interactive rounded-lg border border-primary/40 bg-surface-2 p-3 text-center hover:bg-primary hover:text-white"
          >
            <p className="mono text-lg font-semibold">{qty.toFixed(2)}</p>
            <p className="mono text-xs text-accent">Rs. {(qty * rate).toFixed(0)}</p>
          </button>
        ))}
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <Label className="mb-2 block text-xs uppercase tracking-wider text-text-secondary">Enter kg manually</Label>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input
            value={customQty}
            onChange={(e) => setCustomQty(e.target.value)}
            type="number"
            step="0.01"
            className="h-12 text-lg"
          />
          <Button
            className="h-12 bg-primary text-white hover:bg-primary-light"
            onClick={() => {
              const qty = Number(customQty || 0);
              if (qty <= 0) return;
              onAddQty(qty);
              setCustomQty("");
            }}
          >
            ADD TO BILL
          </Button>
        </div>
        <p className="mono mt-2 text-sm text-text-secondary">
          {Number(customQty || 0).toFixed(2)} kg = {formatCurrency(Number(customQty || 0) * rate)}
        </p>
      </div>
    </section>
  );
}

function YogurtQuickEntry({
  rate,
  onBack,
  onAddQty,
  customQty,
  setCustomQty,
  customMode,
  setCustomMode,
}: {
  rate: number;
  onBack: () => void;
  onAddQty: (qty: number) => void;
  customQty: string;
  setCustomQty: (value: string) => void;
  customMode: "KG" | "RS";
  setCustomMode: (mode: "KG" | "RS") => void;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-text">🫙 Fresh Yogurt • Rs.{rate}/kg</h3>
        <Button variant="outline" className="h-10" onClick={onBack}>
          <ChevronLeft className="mr-1 h-4 w-4" />
          Back
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {yogurtWeightPresets.map((qty) => (
          <button
            key={qty}
            onClick={() => onAddQty(qty)}
            className="interactive rounded-lg border border-primary/40 bg-surface-2 p-3 text-center hover:bg-primary hover:text-white"
          >
            <p className="mono text-lg font-semibold">{qty.toFixed(2)}</p>
            <p className="mono text-xs text-accent">Rs. {(qty * rate).toFixed(0)}</p>
          </button>
        ))}
      </div>

      <div>
        <p className="mb-2 text-sm font-medium text-text-secondary">Or select by amount (Rs.)</p>
        <div className="grid grid-cols-3 gap-2">
          {yogurtAmountPresets.map((amount) => {
            const qty = amount / rate;
            return (
              <button
                key={amount}
                onClick={() => onAddQty(Number(qty.toFixed(2)))}
                className="interactive rounded-lg border border-border bg-surface-2 p-2 text-center hover:border-primary"
              >
                <p className="mono text-base font-semibold">Rs.{amount}</p>
                <p className="mono text-xs text-accent">{qty.toFixed(2)} kg</p>
              </button>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="mb-2 inline-flex rounded-md border border-border bg-surface-2 p-1">
          <button
            onClick={() => setCustomMode("KG")}
            className={cn("h-8 rounded px-3 text-xs", customMode === "KG" ? "bg-primary text-white" : "text-text-secondary")}
          >
            KG
          </button>
          <button
            onClick={() => setCustomMode("RS")}
            className={cn("h-8 rounded px-3 text-xs", customMode === "RS" ? "bg-primary text-white" : "text-text-secondary")}
          >
            Rs.
          </button>
        </div>
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Input
            value={customQty}
            onChange={(e) => setCustomQty(e.target.value)}
            type="number"
            step="0.01"
            className="h-12 text-lg"
            placeholder={customMode === "KG" ? "Enter kg" : "Enter amount"}
          />
          <Button
            className="h-12 bg-primary text-white hover:bg-primary-light"
            onClick={() => {
              const value = Number(customQty || 0);
              if (value <= 0) return;
              const qty = customMode === "KG" ? value : value / rate;
              onAddQty(Number(qty.toFixed(2)));
              setCustomQty("");
            }}
          >
            ADD TO BILL
          </Button>
        </div>
      </div>
    </section>
  );
}

function HeldBillsDrawer({
  open,
  onClose,
  bills,
  onResume,
  onDelete,
}: {
  open: boolean;
  onClose: () => void;
  bills: any[];
  onResume: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div
      className={cn(
        "absolute inset-y-0 right-0 z-20 w-[340px] border-l border-border bg-surface p-3 shadow-card transition-transform duration-200",
        open ? "translate-x-0" : "translate-x-full"
      )}
    >
      <div className="mb-3 flex items-center justify-between">
        <h4 className="text-sm font-semibold text-text">Held Bills</h4>
        <button onClick={onClose} className="rounded p-1 text-text-secondary hover:bg-surface-2">
          <X className="h-4 w-4" />
        </button>
      </div>
      {bills.length === 0 ? (
            <EmptyState
          icon={PanelRight}
          title="No held bills"
          description="Hold bills to resume later."
          className="min-h-[200px]"
        />
      ) : (
        <div className="hide-scrollbar space-y-2 overflow-y-auto pr-1">
          {bills.map((bill) => {
            const total = bill.items.reduce((sum: number, item: any) => sum + Number(item.lineTotal || 0), 0);
            return (
              <div key={bill.id} className="rounded-lg border border-border bg-surface-2 p-2.5">
                <p className="text-sm font-medium text-text">{bill.customerName}</p>
                <p className="mono text-xs text-text-secondary">{bill.items.length} items • {formatCurrency(total)}</p>
                <p className="text-[10px] text-text-secondary">
                  {new Date(bill.timestamp).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" })}
                </p>
                <div className="mt-2 flex gap-1.5">
                  <Button size="sm" className="h-8 flex-1" onClick={() => onResume(bill.id)}>Resume</Button>
                  <Button size="sm" variant="outline" className="h-8 flex-1" onClick={() => onDelete(bill.id)}>
                    Remove
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RateEditorModal({
  open,
  onOpenChange,
  milkRate,
  yogurtRate,
  onMilkChange,
  onYogurtChange,
  onSave,
  saving,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  milkRate: string;
  yogurtRate: string;
  onMilkChange: (value: string) => void;
  onYogurtChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      title="Update Daily Rates"
      description="Set today's milk and yogurt rates."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={onSave} disabled={saving}>{saving ? "Saving..." : "Save Rates"}</Button>
        </>
      }
    >
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Milk Rate (Rs./kg)</Label>
          <Input value={milkRate} onChange={(e) => onMilkChange(e.target.value)} type="number" />
        </div>
        <div className="space-y-1">
          <Label>Yogurt Rate (Rs./kg)</Label>
          <Input value={yogurtRate} onChange={(e) => onYogurtChange(e.target.value)} type="number" />
        </div>
      </div>
    </AppModal>
  );
}

function ShortcutsModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const rows = [
    ["F2", "Focus product search"],
    ["Enter", "Complete sale (cart not empty)"],
    ["Escape", "Close modal / go back"],
    ["Ctrl + H", "Hold current bill"],
    ["Ctrl + N", "New sale / clear cart"],
    ["Ctrl + P", "Print last receipt"],
    ["Ctrl + K", "Focus customer/global search"],
  ];

  return (
    <AppModal open={open} onOpenChange={onOpenChange} title="Keyboard Shortcuts" description="Use these for faster billing.">
      <div className="space-y-2">
        {rows.map(([key, description]) => (
          <div key={key} className="flex items-center justify-between rounded-md border border-border bg-surface-2 px-3 py-2">
            <span className="mono rounded border border-border bg-surface px-2 py-1 text-xs">{key}</span>
            <span className="text-sm text-text-secondary">{description}</span>
          </div>
        ))}
      </div>
    </AppModal>
  );
}

function ReceiptModal({ data, onClose }: { data: any; onClose: () => void }) {
  if (!data) return null;

  return (
    <AppModal
      open={Boolean(data)}
      onOpenChange={onClose}
      title="Receipt"
      description="Sale completed successfully."
      className="sm:max-w-[520px]"
      footer={
        <>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="mr-1.5 h-4 w-4" />
            Print Receipt
          </Button>
          <Button onClick={onClose}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" />
            New Sale
          </Button>
        </>
      }
    >
      <div className="print-target receipt-print rounded-md border border-border bg-surface p-3">
        <div className="mb-2 text-center">
          <p className="text-lg font-bold text-text">🐄 NOON DAIRY</p>
          <p className="text-xs text-text-secondary">Fresh. Fast. Trusted.</p>
          <p className="text-xs text-text-secondary">Faisalabad, Pakistan</p>
        </div>
        <div className="mb-2 border-y border-dashed border-border py-1 text-xs">
          <div className="flex justify-between">
            <span>Bill</span>
            <span className="mono">{data.billNumber}</span>
          </div>
          <div className="flex justify-between">
            <span>Date</span>
            <span className="mono">{new Date(data.createdAt).toLocaleString("en-PK")}</span>
          </div>
          <div className="flex justify-between">
            <span>Payment</span>
            <span className="mono">{data.paymentType}</span>
          </div>
        </div>

        <div className="space-y-1 text-sm">
          {(data.items ?? []).map((item: any) => (
            <div key={item.id} className="flex items-center justify-between">
              <span className="truncate pr-2">
                {item.productName} ({item.quantity})
              </span>
              <span className="mono">{formatCurrency(item.lineTotal)}</span>
            </div>
          ))}
        </div>

        <div className="mt-2 border-t border-dashed border-border pt-2 text-sm">
          <SummaryRow label="Subtotal" value={formatCurrency(data.subtotal || 0)} />
          <SummaryRow label="Discount" value={`- ${formatCurrency(data.discountAmount || 0)}`} />
          <SummaryRow label="TOTAL" value={formatCurrency(data.grandTotal || 0)} />
          <SummaryRow label="Paid" value={formatCurrency(data.amountPaid || 0)} />
          <SummaryRow label="Balance Due" value={formatCurrency(data.balanceDue || 0)} />
        </div>
      </div>
    </AppModal>
  );
}
