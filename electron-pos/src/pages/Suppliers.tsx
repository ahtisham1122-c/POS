import { useEffect, useMemo, useState } from "react";
import { Banknote, CalendarDays, CheckCircle2, Download, Milk, Pencil, Plus, Printer, RefreshCw, Truck, UserRoundPlus, X, ChevronRight, FileText } from "lucide-react";
import { cn } from "../lib/utils";

type Supplier = {
  id: string;
  code: string;
  name: string;
  phone?: string;
  address?: string;
  allowed_shifts: "MORNING" | "EVENING" | "BOTH";
  default_rate: number;
  cow_rate?: number;
  buffalo_rate?: number;
  current_balance: number;
};

type MilkType = "COW" | "BUFFALO" | "MIXED";

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })}`;
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function supplierRate(supplier: Supplier | undefined, type: MilkType) {
  if (!supplier) return 0;
  const fallback = Number(supplier.default_rate || 0);
  if (type === "COW") return Number(supplier.cow_rate || fallback || 0);
  if (type === "BUFFALO") return Number(supplier.buffalo_rate || fallback || 0);
  return fallback;
}

export default function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [collections, setCollections] = useState<any[]>([]);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [collectionDate, setCollectionDate] = useState(today());
  
  // Modals
  const [isSupplierModalOpen, setIsSupplierModalOpen] = useState(false);
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"COLLECTION" | "REPORT">("COLLECTION");

  const [paymentAmount, setPaymentAmount] = useState("");
  
  // Report Mode
  const [reportMode, setReportMode] = useState<"1-10" | "1-15" | "1-25" | "FULL" | "CUSTOM">("1-10");
  const [reportStart, setReportStart] = useState(() => new Date().toISOString().slice(0, 8) + "01");
  const [reportEnd, setReportEnd] = useState(() => new Date().toISOString().slice(0, 8) + "10");
  const [statement, setStatement] = useState<any>(null);

  const [supplierForm, setSupplierForm] = useState({
    name: "",
    phone: "",
    address: "",
    allowedShifts: "BOTH",
    defaultRate: "0",
    cowRate: "0",
    buffaloRate: "0",
  });
  const [editingSupplierId, setEditingSupplierId] = useState("");
  
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const selectedSupplier = useMemo(
    () => suppliers.find((supplier) => supplier.id === selectedSupplierId),
    [suppliers, selectedSupplierId]
  );

  const supplierCollections = useMemo(
    () => collections.filter(c => c.supplier_id === selectedSupplierId),
    [collections, selectedSupplierId]
  );

  const morningCollection = supplierCollections.find(c => c.shift === "MORNING");
  const eveningCollection = supplierCollections.find(c => c.shift === "EVENING");

  const payableTotal = suppliers.reduce((sum, supplier) => sum + Number(supplier.current_balance || 0), 0);
  const todayQuantity = collections.reduce((sum, item) => sum + Number(item.quantity || 0), 0);

  useEffect(() => {
    loadData();
  }, [collectionDate]);

  useEffect(() => {
    applyReportMode(reportMode);
  }, []);

  useEffect(() => {
    if (selectedSupplierId && activeTab === "REPORT") {
      loadStatement();
    }
  }, [selectedSupplierId, activeTab, reportStart, reportEnd]);

  async function loadData() {
    setIsLoading(true);
    try {
      const [supplierData, collectionData] = await Promise.all([
        window.electronAPI?.suppliers?.getAll(),
        window.electronAPI?.suppliers?.getCollections({ date: collectionDate }),
      ]);
      setSuppliers(supplierData || []);
      setCollections(collectionData || []);
    } finally {
      setIsLoading(false);
    }
  }

  function openAddSupplier() {
    setEditingSupplierId("");
    setSupplierForm({ name: "", phone: "", address: "", allowedShifts: "BOTH", defaultRate: "0", cowRate: "0", buffaloRate: "0" });
    setIsSupplierModalOpen(true);
  }

  function openEditSupplier(supplier: Supplier) {
    setEditingSupplierId(supplier.id);
    setSupplierForm({
      name: supplier.name,
      phone: supplier.phone || "",
      address: supplier.address || "",
      allowedShifts: supplier.allowed_shifts,
      defaultRate: String(supplier.default_rate || 0),
      cowRate: String(supplier.cow_rate || supplier.default_rate || 0),
      buffaloRate: String(supplier.buffalo_rate || supplier.default_rate || 0),
    });
    setIsSupplierModalOpen(true);
  }

  async function saveSupplier() {
    setMessage(null);
    const payload = {
      name: supplierForm.name,
      phone: supplierForm.phone,
      address: supplierForm.address,
      allowedShifts: supplierForm.allowedShifts,
      defaultRate: Number(supplierForm.defaultRate || 0),
      cowRate: Number(supplierForm.cowRate || supplierForm.defaultRate || 0),
      buffaloRate: Number(supplierForm.buffaloRate || supplierForm.defaultRate || 0),
    };
    const result = editingSupplierId
      ? await window.electronAPI?.suppliers?.update(editingSupplierId, payload)
      : await window.electronAPI?.suppliers?.create(payload);

    if (!result?.success) {
      setMessage({ type: "error", text: result?.error || "Failed to save supplier." });
      return;
    }

    setIsSupplierModalOpen(false);
    setMessage({ type: "success", text: "Supplier saved successfully." });
    if (!editingSupplierId) {
      // Just clear selection or let it be
    }
    await loadData();
  }

  async function paySupplier() {
    setMessage(null);
    if (!selectedSupplierId) return;

    const result = await window.electronAPI?.suppliers?.collectPayment(selectedSupplierId, {
      amount: Number(paymentAmount || 0),
      notes: "Supplier payment",
    });

    if (!result?.success) {
      setMessage({ type: "error", text: result?.error || "Payment failed." });
      return;
    }

    setMessage({ type: "success", text: `Payment saved. New balance: ${toMoney(result.balanceAfter || 0)}.` });
    setPaymentAmount("");
    setIsPaymentModalOpen(false);
    await loadData();
  }

  function applyReportMode(mode: typeof reportMode) {
    setReportMode(mode);
    if (mode === "CUSTOM") return;

    const base = new Date();
    const year = base.getFullYear();
    const month = String(base.getMonth() + 1).padStart(2, "0");
    const lastDay = new Date(year, base.getMonth() + 1, 0).getDate();
    const endDay = mode === "1-10" ? 10 : mode === "1-15" ? 15 : mode === "1-25" ? 25 : lastDay;
    setReportStart(`${year}-${month}-01`);
    setReportEnd(`${year}-${month}-${String(endDay).padStart(2, "0")}`);
  }

  async function loadStatement() {
    if (!selectedSupplierId) return;
    setStatement(null);
    const result = await window.electronAPI?.suppliers?.getCycleStatement({ supplierId: selectedSupplierId, startDate: reportStart, endDate: reportEnd });
    setStatement(result);
  }

  async function exportGlobalCycleReport(format: "excel" | "pdf") {
    const result = await window.electronAPI?.reports?.exportReport({
      type: "supplier-report",
      format,
      params: { startDate: reportStart, endDate: reportEnd }
    });
    if (!result?.success && result?.reason !== "canceled") {
      setMessage({ type: "error", text: result?.error || "Export failed." });
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto flex flex-col h-[calc(100vh-2rem)] animate-slide-up gap-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 shrink-0">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Suppliers & Milk Purchase</h1>
          <p className="text-text-secondary mt-1">Select a farm to add entries or make payments.</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end">
            <span className="text-xs text-text-secondary uppercase font-bold tracking-wider">Today's Milk</span>
            <span className="font-mono font-bold text-primary">{todayQuantity.toFixed(2)} kg</span>
          </div>
          <div className="h-8 w-px bg-surface-4"></div>
          <div className="flex flex-col items-end">
            <span className="text-xs text-text-secondary uppercase font-bold tracking-wider">Total Payables</span>
            <span className="font-mono font-bold text-warning">{toMoney(payableTotal)}</span>
          </div>
          <button onClick={loadData} className="btn-secondary h-10 w-10 p-0 flex items-center justify-center rounded-full ml-2">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {message && (
        <div className={cn("rounded-xl border px-4 py-3 flex items-center gap-3 shrink-0", message.type === "success" ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger")}>
          {message.type === "success" ? <CheckCircle2 className="w-5 h-5" /> : <X className="w-5 h-5 cursor-pointer" onClick={() => setMessage(null)} />}
          <span className="font-medium flex-1">{message.text}</span>
        </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        {/* LEFT PANEL: Farm Selector */}
        <div className="w-full lg:w-80 xl:w-96 flex flex-col gap-4 shrink-0 h-full">
          <div className="card p-4 flex justify-between items-center bg-surface-2/70 shrink-0">
            <h2 className="font-bold text-lg flex items-center gap-2">
              <UserRoundPlus className="w-5 h-5 text-primary" /> Farms
            </h2>
            <button className="btn-primary px-3 py-1.5 text-xs inline-flex items-center gap-1" onClick={openAddSupplier}>
              <Plus className="w-3 h-3" /> Add
            </button>
          </div>
          <div className="card flex-1 overflow-y-auto overflow-x-hidden p-2 space-y-1">
            {suppliers.map(supplier => (
              <button
                key={supplier.id}
                onClick={() => setSelectedSupplierId(supplier.id)}
                className={cn(
                  "w-full text-left p-3 rounded-lg flex items-center justify-between transition-colors",
                  selectedSupplierId === supplier.id ? "bg-primary/10 border border-primary/30" : "hover:bg-surface-3 border border-transparent"
                )}
              >
                <div className="min-w-0 flex-1 pr-2">
                  <p className={cn("font-bold truncate", selectedSupplierId === supplier.id ? "text-primary" : "text-text-primary")}>{supplier.name}</p>
                  <p className="text-xs text-text-secondary mt-0.5 truncate">{supplier.phone || supplier.code}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className={cn("font-mono text-sm font-bold", Number(supplier.current_balance) > 0 ? "text-warning" : "text-text-secondary")}>
                    {toMoney(supplier.current_balance)}
                  </p>
                  <p className="text-[10px] text-text-secondary uppercase">{supplier.allowed_shifts}</p>
                </div>
              </button>
            ))}
            {suppliers.length === 0 && (
              <div className="p-6 text-center text-text-secondary text-sm">
                No farms added yet. Click Add to start.
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL: Active Farm Detail */}
        <div className="flex-1 flex flex-col h-full bg-surface-1 rounded-2xl border border-surface-4 overflow-hidden shadow-sm">
          {selectedSupplier ? (
            <>
              {/* Supplier Header */}
              <div className="p-6 border-b border-surface-4 bg-surface-2/40 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shrink-0">
                <div>
                  <h2 className="text-2xl font-bold text-text-primary flex items-center gap-2">
                    {selectedSupplier.name}
                    <button onClick={() => openEditSupplier(selectedSupplier)} className="text-text-secondary hover:text-primary transition-colors">
                      <Pencil className="w-4 h-4" />
                    </button>
                  </h2>
                  <div className="flex items-center gap-3 mt-2 text-sm text-text-secondary">
                    <span>{selectedSupplier.phone || "No phone"}</span>
                    <span>•</span>
                    <span>Default Rate: {toMoney(selectedSupplier.default_rate)}</span>
                    {(selectedSupplier.cow_rate || 0) > 0 && <span>• Cow: {toMoney(selectedSupplier.cow_rate || 0)}</span>}
                    {(selectedSupplier.buffalo_rate || 0) > 0 && <span>• Buffalo: {toMoney(selectedSupplier.buffalo_rate || 0)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-4 bg-surface-1 p-3 rounded-xl border border-surface-4">
                  <div>
                    <p className="text-xs text-text-secondary uppercase font-bold tracking-wider">Payable Balance</p>
                    <p className="text-xl font-mono font-bold text-warning">{toMoney(selectedSupplier.current_balance)}</p>
                  </div>
                  <button onClick={() => setIsPaymentModalOpen(true)} className="btn-primary h-10 px-4 flex items-center gap-2 whitespace-nowrap">
                    <Banknote className="w-4 h-4" /> Pay
                  </button>
                </div>
              </div>

              {/* Tabs */}
              <div className="flex gap-1 border-b border-surface-4 px-4 pt-4 shrink-0">
                <button
                  className={cn("px-4 py-2 text-sm font-bold border-b-2 transition-colors", activeTab === "COLLECTION" ? "border-primary text-primary" : "border-transparent text-text-secondary hover:text-text-primary")}
                  onClick={() => setActiveTab("COLLECTION")}
                >
                  Daily Collections
                </button>
                <button
                  className={cn("px-4 py-2 text-sm font-bold border-b-2 transition-colors", activeTab === "REPORT" ? "border-primary text-primary" : "border-transparent text-text-secondary hover:text-text-primary")}
                  onClick={() => setActiveTab("REPORT")}
                >
                  Cycle Report & Statement
                </button>
              </div>

              {/* Tab Content */}
              <div className="flex-1 overflow-y-auto p-6">
                {activeTab === "COLLECTION" && (
                  <div className="space-y-6 max-w-4xl mx-auto animate-fade-in">
                    <div className="flex items-center justify-between">
                      <h3 className="font-bold text-lg">Collections for Date</h3>
                      <input type="date" value={collectionDate} onChange={e => setCollectionDate(e.target.value)} className="input w-48" />
                    </div>

                    <div className="grid md:grid-cols-2 gap-6">
                      <ShiftEntry
                        shift="MORNING"
                        supplier={selectedSupplier}
                        collection={morningCollection}
                        date={collectionDate}
                        onSuccess={loadData}
                        allowed={selectedSupplier.allowed_shifts === "MORNING" || selectedSupplier.allowed_shifts === "BOTH"}
                      />
                      <ShiftEntry
                        shift="EVENING"
                        supplier={selectedSupplier}
                        collection={eveningCollection}
                        date={collectionDate}
                        onSuccess={loadData}
                        allowed={selectedSupplier.allowed_shifts === "EVENING" || selectedSupplier.allowed_shifts === "BOTH"}
                      />
                    </div>
                  </div>
                )}

                {activeTab === "REPORT" && (
                  <div className="space-y-6 animate-fade-in h-full flex flex-col max-w-5xl mx-auto">
                    <div className="flex flex-wrap items-center justify-between gap-4 card p-4 shrink-0">
                      <div className="flex flex-wrap gap-2">
                        {(["1-10", "1-15", "1-25", "FULL", "CUSTOM"] as const).map((mode) => (
                          <button
                            key={mode}
                            onClick={() => applyReportMode(mode)}
                            className={cn("px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors", reportMode === mode ? "bg-primary border-primary text-white" : "border-surface-4 text-text-secondary hover:bg-surface-3")}
                          >
                            {mode === "FULL" ? "Full Month" : mode}
                          </button>
                        ))}
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="date" className="input text-sm h-9" value={reportStart} onChange={e => { setReportMode("CUSTOM"); setReportStart(e.target.value); }} />
                        <span className="text-text-secondary">to</span>
                        <input type="date" className="input text-sm h-9" value={reportEnd} onChange={e => { setReportMode("CUSTOM"); setReportEnd(e.target.value); }} />
                      </div>
                      <div className="flex items-center gap-2 ml-auto">
                         <button onClick={() => exportGlobalCycleReport("excel")} className="btn-secondary h-9 px-3 text-xs flex items-center gap-1">
                           <Download className="w-3 h-3"/> All Farms (Excel)
                         </button>
                         <button onClick={() => window.print()} className="btn-primary h-9 px-3 text-xs flex items-center gap-1" disabled={!statement}>
                           <Printer className="w-3 h-3"/> Print Statement
                         </button>
                      </div>
                    </div>

                    {statement ? (
                      <div className="card flex-1 overflow-y-auto p-8 bg-white text-black print-target">
                        <div className="text-center border-b-2 border-black pb-4 mb-4">
                          <h1 className="text-2xl font-black">GUJJAR MILK SHOP</h1>
                          <p className="text-sm">Supplier Milk Statement</p>
                          <p className="text-sm mt-1">{statement.startDate} to {statement.endDate}</p>
                        </div>

                        {/* Supplier identity block — owner asked for the supplier
                            name to appear prominently on every printed statement
                            so there's no confusion when stacking multiple farms'
                            sheets at month-end reconciliation. */}
                        <div className="border border-black rounded-md px-4 py-3 mb-5 flex justify-between items-start gap-4">
                          <div>
                            <p className="text-[10px] uppercase tracking-wider text-gray-600">Supplier</p>
                            <p className="text-lg font-black leading-tight">
                              {statement.supplier?.name || "Unnamed Supplier"}
                            </p>
                            <p className="text-xs text-gray-700 mt-0.5">
                              {statement.supplier?.code ? `Code: ${statement.supplier.code}` : ""}
                              {statement.supplier?.code && statement.supplier?.phone ? "   ·   " : ""}
                              {statement.supplier?.phone ? `Phone: ${statement.supplier.phone}` : ""}
                            </p>
                            {statement.supplier?.address ? (
                              <p className="text-xs text-gray-700">{statement.supplier.address}</p>
                            ) : null}
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-wider text-gray-600">Period</p>
                            <p className="text-sm font-bold">{statement.startDate}</p>
                            <p className="text-[11px] text-gray-700">to {statement.endDate}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-4 gap-2 text-center mb-6">
                          <StatementBox label="Opening Balance" value={toMoney(statement.openingBalance)} />
                          <StatementBox label="Milk Amount" value={toMoney(statement.collectionAmount)} />
                          <StatementBox label="Paid" value={toMoney(statement.paidAmount)} />
                          <StatementBox label="Closing Balance" value={toMoney(statement.closingBalance)} strong />
                        </div>

                        <h3 className="font-bold text-sm border-b border-black pb-1 mb-2">Milk Collections</h3>
                        <table className="w-full text-xs border-collapse mb-6">
                          <thead>
                            <tr className="border-b border-black">
                              <th className="text-left py-1">Date</th>
                              <th className="text-left py-1">Shift</th>
                              <th className="text-left py-1">Type</th>
                              <th className="text-right py-1">Qty (kg)</th>
                              <th className="text-right py-1">Rate</th>
                              <th className="text-right py-1">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statement.collections.map((row: any) => (
                              <tr key={row.id} className="border-b border-gray-300">
                                <td className="py-1">{row.collection_date}</td>
                                <td className="py-1">{row.shift}</td>
                                <td className="py-1">{row.milk_type || "MIXED"}</td>
                                <td className="py-1 text-right">{Number(row.quantity).toFixed(2)}</td>
                                <td className="py-1 text-right">{toMoney(row.rate)}</td>
                                <td className="py-1 text-right font-bold">{toMoney(row.total_amount)}</td>
                              </tr>
                            ))}
                            {statement.collections.length === 0 && (
                              <tr><td colSpan={6} className="py-4 text-center">No collections in this period.</td></tr>
                            )}
                          </tbody>
                        </table>

                        <h3 className="font-bold text-sm border-b border-black pb-1 mb-2">Payments</h3>
                        <table className="w-full text-xs border-collapse">
                          <thead>
                            <tr className="border-b border-black">
                              <th className="text-left py-1">Date</th>
                              <th className="text-left py-1">Notes</th>
                              <th className="text-right py-1">Amount</th>
                            </tr>
                          </thead>
                          <tbody>
                            {statement.payments.map((row: any) => (
                              <tr key={row.id} className="border-b border-gray-300">
                                <td className="py-1">{String(row.payment_date).slice(0, 10)}</td>
                                <td className="py-1">{row.notes || "-"}</td>
                                <td className="py-1 text-right font-bold">{toMoney(row.amount)}</td>
                              </tr>
                            ))}
                            {statement.payments.length === 0 && (
                              <tr><td colSpan={3} className="py-4 text-center">No payments in this period.</td></tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="flex-1 flex items-center justify-center text-text-secondary">
                        Loading statement...
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-text-secondary p-10">
              <Milk className="w-16 h-16 opacity-20 mb-4" />
              <p className="text-xl font-bold text-text-primary">No Farm Selected</p>
              <p className="mt-2">Choose a farm from the list to view its collections and reports.</p>
            </div>
          )}
        </div>
      </div>

      {/* Supplier Modal */}
      {isSupplierModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-lg overflow-hidden border border-surface-4 animate-slide-up">
            <div className="p-5 border-b border-surface-4 flex justify-between items-center">
              <h3 className="font-bold text-lg">{editingSupplierId ? "Edit Farm" : "Add Farm"}</h3>
              <button onClick={() => setIsSupplierModalOpen(false)} className="text-text-secondary hover:text-text-primary"><X className="w-5 h-5"/></button>
            </div>
            <div className="p-5 space-y-4">
              <input className="input" placeholder="Farm / supplier name" value={supplierForm.name} onChange={(e) => setSupplierForm(c => ({ ...c, name: e.target.value }))} />
              <input className="input" placeholder="Phone number" value={supplierForm.phone} onChange={(e) => setSupplierForm(c => ({ ...c, phone: e.target.value }))} />
              <input className="input" placeholder="Address / area" value={supplierForm.address} onChange={(e) => setSupplierForm(c => ({ ...c, address: e.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-secondary font-bold mb-1 block">Allowed Shifts</label>
                  <select className="input" value={supplierForm.allowedShifts} onChange={(e) => setSupplierForm(c => ({ ...c, allowedShifts: e.target.value }))}>
                    <option value="BOTH">Morning + Evening</option>
                    <option value="MORNING">Morning only</option>
                    <option value="EVENING">Evening only</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs text-text-secondary font-bold mb-1 block">Default Rate</label>
                  <input className="input" type="number" value={supplierForm.defaultRate} onChange={(e) => setSupplierForm(c => ({ ...c, defaultRate: e.target.value }))} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-text-secondary font-bold mb-1 block">Cow Rate (Optional)</label>
                  <input className="input" type="number" value={supplierForm.cowRate} onChange={(e) => setSupplierForm(c => ({ ...c, cowRate: e.target.value }))} />
                </div>
                <div>
                  <label className="text-xs text-text-secondary font-bold mb-1 block">Buffalo Rate (Optional)</label>
                  <input className="input" type="number" value={supplierForm.buffaloRate} onChange={(e) => setSupplierForm(c => ({ ...c, buffaloRate: e.target.value }))} />
                </div>
              </div>
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex justify-end gap-3">
              <button onClick={() => setIsSupplierModalOpen(false)} className="btn-secondary">Cancel</button>
              <button onClick={saveSupplier} className="btn-primary px-6">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {isPaymentModalOpen && selectedSupplier && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-sm overflow-hidden border border-surface-4 animate-slide-up">
            <div className="p-5 border-b border-surface-4 flex justify-between items-center bg-warning/10 text-warning">
              <h3 className="font-bold text-lg flex items-center gap-2"><Banknote className="w-5 h-5"/> Pay Supplier</h3>
              <button onClick={() => setIsPaymentModalOpen(false)} className="hover:opacity-70"><X className="w-5 h-5"/></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <p className="text-sm text-text-secondary">Paying</p>
                <p className="font-bold text-lg">{selectedSupplier.name}</p>
              </div>
              <div>
                <p className="text-sm text-text-secondary mb-1">Current Payable</p>
                <p className="font-mono font-bold text-warning">{toMoney(selectedSupplier.current_balance)}</p>
              </div>
              <div className="pt-2">
                <label className="text-sm font-bold text-text-primary mb-2 block">Payment Amount</label>
                <input className="input text-xl font-mono" autoFocus type="number" placeholder="0" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
              </div>
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setIsPaymentModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={paySupplier} disabled={!paymentAmount || Number(paymentAmount) <= 0} className="w-1/2 rounded-lg bg-warning hover:bg-warning/90 text-black font-bold transition-colors disabled:opacity-50">
                Confirm Payment
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// Subcomponent for Shift Entry
function ShiftEntry({ shift, supplier, collection, date, onSuccess, allowed }: any) {
  const [isEditing, setIsEditing] = useState(false);
  const [milkType, setMilkType] = useState<MilkType>(collection?.milk_type || "BUFFALO");
  const [quantity, setQuantity] = useState(collection ? String(collection.quantity) : "");
  const [rate, setRate] = useState(collection ? String(collection.rate) : String(supplierRate(supplier, "BUFFALO")));
  const [notes, setNotes] = useState(collection?.notes || "");
  const [isSaving, setIsSaving] = useState(false);

  // Sync rate when milk type changes if not editing an existing collection
  useEffect(() => {
    if (!collection && !isEditing) {
      setRate(String(supplierRate(supplier, milkType)));
    }
  }, [milkType, supplier, collection, isEditing]);

  if (!allowed) {
    return (
      <div className="card p-5 opacity-50 flex flex-col items-center justify-center text-center h-full min-h-[250px]">
        <p className="font-bold text-text-secondary uppercase">{shift} SHIFT</p>
        <p className="text-sm mt-2">Not allowed for this farm.</p>
      </div>
    );
  }

  const isFormActive = isEditing || !collection;

  async function handleSave() {
    setIsSaving(true);
    try {
      const payload = {
        supplierId: supplier.id,
        date,
        shift,
        milkType,
        quantity: Number(quantity || 0),
        rate: Number(rate || 0),
        notes,
      };
      const result = collection
        ? await window.electronAPI?.suppliers?.updateCollection(collection.id, payload)
        : await window.electronAPI?.suppliers?.collectMilk(payload);

      if (result?.success) {
        setIsEditing(false);
        onSuccess();
      }
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className={cn("card p-5 flex flex-col transition-all", isFormActive ? "border-primary/50 shadow-md" : "")}>
      <div className="flex justify-between items-center mb-4">
        <h4 className={cn("font-bold text-sm tracking-wider uppercase", shift === "MORNING" ? "text-info" : "text-warning")}>
          {shift} SHIFT
        </h4>
        {collection && !isEditing && (
          <button onClick={() => setIsEditing(true)} className="btn-secondary px-2 py-1 text-xs flex items-center gap-1">
            <Pencil className="w-3 h-3" /> Edit
          </button>
        )}
        {isEditing && (
          <button onClick={() => { setIsEditing(false); setQuantity(String(collection.quantity)); setRate(String(collection.rate)); }} className="text-text-secondary hover:text-text-primary">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {!isFormActive ? (
        <div className="flex-1 flex flex-col justify-center">
          <div className="text-center space-y-1 py-4">
            <p className="text-3xl font-mono font-bold text-text-primary">{Number(collection.quantity).toFixed(2)} <span className="text-lg text-text-secondary">kg</span></p>
            <p className="text-sm text-text-secondary">{collection.milk_type || "MIXED"} @ {toMoney(collection.rate)}/kg</p>
          </div>
          <div className="mt-auto pt-4 border-t border-surface-4 flex justify-between items-center">
            <span className="text-xs text-text-secondary font-bold uppercase">Total</span>
            <span className="font-mono font-bold text-accent text-lg">{toMoney(collection.total_amount)}</span>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col space-y-4">
          <select className="input text-sm" value={milkType} onChange={(e) => setMilkType(e.target.value as MilkType)}>
            <option value="BUFFALO">Buffalo Milk</option>
            <option value="COW">Cow Milk</option>
            <option value="MIXED">Mixed Milk</option>
          </select>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] text-text-secondary font-bold uppercase mb-1 block">Quantity (kg)</label>
              <input type="number" className="input font-mono text-lg py-2" value={quantity} onChange={e => setQuantity(e.target.value)} placeholder="0.00" />
            </div>
            <div>
              <label className="text-[10px] text-text-secondary font-bold uppercase mb-1 block">Rate / kg</label>
              <input type="number" className="input font-mono text-lg py-2" value={rate} onChange={e => setRate(e.target.value)} />
            </div>
          </div>
          <input className="input text-sm" placeholder="Notes (optional)" value={notes} onChange={e => setNotes(e.target.value)} />
          
          <div className="mt-auto pt-4 flex items-center justify-between">
            <div>
              <p className="text-[10px] text-text-secondary font-bold uppercase">Payable</p>
              <p className="font-mono font-bold text-accent">{toMoney(Number(quantity || 0) * Number(rate || 0))}</p>
            </div>
            <button onClick={handleSave} disabled={isSaving || !quantity || Number(quantity) <= 0} className="btn-primary px-5 py-2">
              {isSaving ? "..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatementBox({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="border border-black p-2 bg-gray-50/50">
      <p className="text-[10px] uppercase text-gray-600">{label}</p>
      <p className={cn("font-bold text-black", strong && "text-base")}>{value}</p>
    </div>
  );
}
