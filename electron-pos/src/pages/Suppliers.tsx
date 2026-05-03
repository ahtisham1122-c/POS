import { useEffect, useMemo, useState } from "react";
import { Banknote, CalendarDays, CheckCircle2, Download, Milk, Pencil, Plus, Printer, RefreshCw, Truck, UserRoundPlus, X } from "lucide-react";
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
  const [shift, setShift] = useState<"MORNING" | "EVENING">("MORNING");
  const [milkType, setMilkType] = useState<MilkType>("BUFFALO");
  const [quantity, setQuantity] = useState("");
  const [rate, setRate] = useState("");
  const [notes, setNotes] = useState("");
  const [editingCollectionId, setEditingCollectionId] = useState("");
  const [paymentSupplierId, setPaymentSupplierId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [reportMode, setReportMode] = useState<"1-10" | "1-15" | "1-25" | "FULL" | "CUSTOM">("1-10");
  const [reportStart, setReportStart] = useState(() => new Date().toISOString().slice(0, 8) + "01");
  const [reportEnd, setReportEnd] = useState(() => new Date().toISOString().slice(0, 8) + "10");
  const [cycleReport, setCycleReport] = useState<any>(null);
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

  const payableTotal = suppliers.reduce((sum, supplier) => sum + Number(supplier.current_balance || 0), 0);
  const todayQuantity = collections
    .filter((item) => item.collection_date === collectionDate)
    .reduce((sum, item) => sum + Number(item.quantity || 0), 0);
  const todayAmount = collections
    .filter((item) => item.collection_date === collectionDate)
    .reduce((sum, item) => sum + Number(item.total_amount || 0), 0);

  useEffect(() => {
    loadData();
  }, [collectionDate]);

  useEffect(() => {
    applyReportMode(reportMode);
  }, []);

  useEffect(() => {
    if (selectedSupplier && !editingCollectionId) {
      setRate(String(supplierRate(selectedSupplier, milkType)));
    }
  }, [selectedSupplierId, milkType]);

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

  async function addSupplier() {
    setMessage(null);
    const wasEditing = Boolean(editingSupplierId);
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

    resetSupplierForm();
    setMessage({ type: "success", text: wasEditing ? "Supplier/farm updated successfully." : "Supplier/farm added successfully." });
    await loadData();
  }

  function resetSupplierForm() {
    setEditingSupplierId("");
    setSupplierForm({ name: "", phone: "", address: "", allowedShifts: "BOTH", defaultRate: "0", cowRate: "0", buffaloRate: "0" });
  }

  function editSupplier(supplier: Supplier) {
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
  }

  async function addCollection() {
    setMessage(null);
    if (!selectedSupplierId) {
      setMessage({ type: "error", text: "Select a supplier/farm first." });
      return;
    }

    const payload = {
      supplierId: selectedSupplierId,
      date: collectionDate,
      shift,
      milkType,
      quantity: Number(quantity || 0),
      rate: Number(rate || 0),
      notes,
    };
    const result = editingCollectionId
      ? await window.electronAPI?.suppliers?.updateCollection(editingCollectionId, payload)
      : await window.electronAPI?.suppliers?.collectMilk(payload);

    if (!result?.success) {
      setMessage({ type: "error", text: result?.error || "Failed to save milk collection." });
      return;
    }

    setMessage({ type: "success", text: `Milk collection saved: ${toMoney(result.totalAmount || 0)} payable.` });
    setEditingCollectionId("");
    setSelectedSupplierId("");
    setQuantity("");
    setNotes("");
    await loadData();
  }

  function editCollection(item: any) {
    setEditingCollectionId(item.id);
    setSelectedSupplierId(item.supplier_id);
    setCollectionDate(item.collection_date);
    setShift(item.shift);
    setMilkType((item.milk_type || "MIXED") as MilkType);
    setQuantity(String(item.quantity || ""));
    setRate(String(item.rate || ""));
    setNotes(item.notes || "");
  }

  function cancelCollectionEdit() {
    setEditingCollectionId("");
    setQuantity("");
    setNotes("");
    if (selectedSupplier) setRate(String(supplierRate(selectedSupplier, milkType)));
  }

  async function paySupplier() {
    setMessage(null);
    if (!paymentSupplierId) {
      setMessage({ type: "error", text: "Select supplier to pay." });
      return;
    }

    const result = await window.electronAPI?.suppliers?.collectPayment(paymentSupplierId, {
      amount: Number(paymentAmount || 0),
      notes: "Supplier payment",
    });

    if (!result?.success) {
      setMessage({ type: "error", text: result?.error || "Payment failed." });
      return;
    }

    setMessage({ type: "success", text: `Supplier payment saved. New balance: ${toMoney(result.balanceAfter || 0)}.` });
    setPaymentAmount("");
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

  async function loadCycleReport() {
    const report = await window.electronAPI?.suppliers?.getCycleReport({ startDate: reportStart, endDate: reportEnd });
    setCycleReport(report);
  }

  function exportCycleCsv() {
    if (!cycleReport) return;
    const rows = [
      ["Supplier", "Phone", "Morning kg", "Evening kg", "Cow kg", "Buffalo kg", "Total kg", "Collection Amount", "Paid", "Period Balance", "Current Balance"],
      ...cycleReport.suppliers.map((row: any) => [
        row.name,
        row.phone || "",
        row.morning_quantity,
        row.evening_quantity,
        row.cow_quantity,
        row.buffalo_quantity,
        row.total_quantity,
        row.collection_amount,
        row.paid_amount,
        row.period_balance,
        row.current_balance
      ])
    ];
    const csv = rows.map((row: Array<string | number>) => row.map((cell: string | number) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `supplier-cycle-${reportStart}-to-${reportEnd}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  async function exportSupplierReport(format: "excel" | "pdf") {
    const result = await window.electronAPI?.reports?.exportReport({
      type: "supplier-report",
      format,
      params: { startDate: reportStart, endDate: reportEnd }
    });
    if (!result?.success && result?.reason !== "canceled") {
      setMessage({ type: "error", text: result?.error || "Export failed." });
    }
  }

  async function openStatement(supplierId: string) {
    const result = await window.electronAPI?.suppliers?.getCycleStatement({ supplierId, startDate: reportStart, endDate: reportEnd });
    setStatement(result);
  }

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6 animate-slide-up">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Suppliers & Milk Purchase</h1>
          <p className="text-text-secondary mt-1">Manage farms with morning/evening collection shifts and supplier payables.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => exportSupplierReport("excel")} className="btn-secondary flex items-center justify-center gap-2">
            <Download className="w-4 h-4" />
            Excel
          </button>
          <button onClick={() => exportSupplierReport("pdf")} className="btn-secondary flex items-center justify-center gap-2">
            <Printer className="w-4 h-4" />
            PDF
          </button>
          <button onClick={loadData} className="btn-secondary flex items-center justify-center gap-2">
            <RefreshCw className="w-4 h-4" />
            Refresh
          </button>
        </div>
      </div>

      {message && (
        <div className={cn(
          "rounded-xl border px-4 py-3 flex items-center gap-3",
          message.type === "success" ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"
        )}>
          <CheckCircle2 className="w-5 h-5" />
          <span className="font-medium">{message.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Stat label="Active Farms" value={String(suppliers.length)} />
        <Stat label="Today Milk Purchase" value={`${todayQuantity.toFixed(2)} kg`} />
        <Stat label="Supplier Payables" value={toMoney(payableTotal)} tone="warning" />
      </div>

      <div className="grid xl:grid-cols-[0.9fr_1.1fr] gap-6">
        <div className="space-y-6">
          <div className="card overflow-hidden">
            <div className="p-5 border-b border-surface-4 bg-surface-2/70">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold text-lg text-text-primary flex items-center gap-2">
                  <UserRoundPlus className="w-5 h-5 text-primary" />
                  {editingSupplierId ? "Edit Farm / Supplier" : "Add Farm / Supplier"}
                </h2>
                {editingSupplierId && (
                  <button onClick={resetSupplierForm} className="btn-secondary px-3 py-2 text-xs flex items-center gap-1">
                    <X className="w-3 h-3" />
                    Cancel
                  </button>
                )}
              </div>
            </div>
            <div className="p-5 space-y-4">
              <input className="input" placeholder="Farm / supplier name" value={supplierForm.name} onChange={(event) => setSupplierForm((current) => ({ ...current, name: event.target.value }))} />
              <input className="input" placeholder="Phone number" value={supplierForm.phone} onChange={(event) => setSupplierForm((current) => ({ ...current, phone: event.target.value }))} />
              <input className="input" placeholder="Address / area" value={supplierForm.address} onChange={(event) => setSupplierForm((current) => ({ ...current, address: event.target.value }))} />
              <div className="grid grid-cols-2 gap-3">
                <select className="input" value={supplierForm.allowedShifts} onChange={(event) => setSupplierForm((current) => ({ ...current, allowedShifts: event.target.value }))}>
                  <option value="BOTH">Morning + Evening</option>
                  <option value="MORNING">Morning only</option>
                  <option value="EVENING">Evening only</option>
                </select>
                <input className="input" type="number" placeholder="Mixed/default rate" value={supplierForm.defaultRate} onChange={(event) => setSupplierForm((current) => ({ ...current, defaultRate: event.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input className="input" type="number" placeholder="Cow milk rate" value={supplierForm.cowRate} onChange={(event) => setSupplierForm((current) => ({ ...current, cowRate: event.target.value }))} />
                <input className="input" type="number" placeholder="Buffalo milk rate" value={supplierForm.buffaloRate} onChange={(event) => setSupplierForm((current) => ({ ...current, buffaloRate: event.target.value }))} />
              </div>
              <button onClick={addSupplier} className="btn-primary w-full h-11 flex items-center justify-center gap-2">
                {editingSupplierId ? <Pencil className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
                {editingSupplierId ? "Update Supplier" : "Add Supplier"}
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-5 border-b border-surface-4 bg-surface-2/70">
              <h2 className="font-bold text-lg text-text-primary flex items-center gap-2">
                <Banknote className="w-5 h-5 text-warning" />
                Pay Supplier
              </h2>
            </div>
            <div className="p-5 space-y-4">
              <select className="input" value={paymentSupplierId} onChange={(event) => setPaymentSupplierId(event.target.value)}>
                <option value="">Select supplier</option>
                {suppliers.map((supplier) => (
                  <option key={supplier.id} value={supplier.id}>{supplier.name} - {toMoney(supplier.current_balance)}</option>
                ))}
              </select>
              <input className="input" type="number" placeholder="Payment amount" value={paymentAmount} onChange={(event) => setPaymentAmount(event.target.value)} />
              <button onClick={paySupplier} className="w-full h-11 rounded-lg bg-warning hover:bg-warning/90 text-black font-bold">
                Save Supplier Payment
              </button>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="card overflow-hidden">
            <div className="p-5 border-b border-surface-4 bg-surface-2/70">
              <div className="flex items-center justify-between gap-3">
                <h2 className="font-bold text-lg text-text-primary flex items-center gap-2">
                  <Milk className="w-5 h-5 text-primary" />
                  {editingCollectionId ? "Edit Milk Collection" : "Milk Collection Entry"}
                </h2>
                {editingCollectionId && (
                  <button onClick={cancelCollectionEdit} className="btn-secondary px-3 py-2 text-xs flex items-center gap-1">
                    <X className="w-3 h-3" />
                    Cancel
                  </button>
                )}
              </div>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid md:grid-cols-4 gap-3">
                <input className="input" type="date" value={collectionDate} onChange={(event) => setCollectionDate(event.target.value)} />
                <select className="input" value={shift} onChange={(event) => setShift(event.target.value as any)}>
                  <option value="MORNING">Morning Shift</option>
                  <option value="EVENING">Evening Shift</option>
                </select>
                <select className="input" value={milkType} onChange={(event) => setMilkType(event.target.value as MilkType)}>
                  <option value="BUFFALO">Buffalo Milk</option>
                  <option value="COW">Cow Milk</option>
                  <option value="MIXED">Mixed Milk</option>
                </select>
                <select className="input" value={selectedSupplierId} onChange={(event) => setSelectedSupplierId(event.target.value)}>
                  <option value="">Select farm</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>{supplier.name} ({supplier.allowed_shifts})</option>
                  ))}
                </select>
              </div>
              <div className="grid md:grid-cols-3 gap-3">
                <input className="input text-xl font-mono" type="number" placeholder="Milk kg" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                <input className="input text-xl font-mono" type="number" placeholder="Rate / kg" value={rate} onChange={(event) => setRate(event.target.value)} />
                <div className="rounded-lg border border-surface-4 bg-surface-3 p-3">
                  <p className="text-xs text-text-secondary uppercase font-bold">Total Payable</p>
                  <p className="text-xl font-mono font-bold text-accent">{toMoney(Number(quantity || 0) * Number(rate || 0))}</p>
                </div>
              </div>
              <input className="input" placeholder="Notes, optional" value={notes} onChange={(event) => setNotes(event.target.value)} />
              <button onClick={addCollection} className="btn-primary w-full h-12 flex items-center justify-center gap-2">
                {editingCollectionId ? <Pencil className="w-5 h-5" /> : <Truck className="w-5 h-5" />}
                {editingCollectionId ? "Update Milk Collection" : "Save Milk Collection"}
              </button>
            </div>
          </div>

          <div className="card overflow-hidden">
            <div className="p-5 border-b border-surface-4 bg-surface-2/70 flex items-center justify-between">
              <h2 className="font-bold text-lg text-text-primary">Collections for {collectionDate}</h2>
              <span className="text-sm font-mono text-accent">{toMoney(todayAmount)}</span>
            </div>
            {isLoading ? (
              <div className="p-10 text-center text-text-secondary">Loading...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-widest font-bold">
                    <tr>
                      <th className="px-4 py-3">Farm</th>
                      <th className="px-4 py-3">Shift</th>
                      <th className="px-4 py-3">Milk</th>
                      <th className="px-4 py-3 text-right">Qty</th>
                      <th className="px-4 py-3 text-right">Rate</th>
                      <th className="px-4 py-3 text-right">Total</th>
                      <th className="px-4 py-3 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-4">
                    {collections.map((item) => (
                      <tr key={item.id} className="hover:bg-surface-3/50 transition-colors">
                        <td className="px-4 py-3 font-bold text-text-primary">{item.supplier_name}</td>
                        <td className="px-4 py-3">
                          <span className={cn("px-2 py-1 rounded-md text-[10px] font-bold", item.shift === "MORNING" ? "bg-info/10 text-info" : "bg-warning/10 text-warning")}>
                            {item.shift}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-bold text-text-primary">{item.milk_type || "MIXED"}</td>
                        <td className="px-4 py-3 text-right font-mono">{Number(item.quantity).toFixed(2)} kg</td>
                        <td className="px-4 py-3 text-right font-mono">{toMoney(item.rate)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-accent">{toMoney(item.total_amount)}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => editCollection(item)} className="btn-secondary py-1.5 px-3 text-xs inline-flex items-center gap-1">
                            <Pencil className="w-3 h-3" />
                            Edit
                          </button>
                        </td>
                      </tr>
                    ))}
                    {collections.length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-10 text-center text-text-secondary">No milk collection entered for this date.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-5 border-b border-surface-4 bg-surface-2/70 flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div>
            <h2 className="font-bold text-lg text-text-primary flex items-center gap-2">
              <CalendarDays className="w-5 h-5 text-primary" />
              Supplier Payment Cycle Report
            </h2>
            <p className="text-sm text-text-secondary mt-1">Calculate farm payments for 1-10, 1-15, 1-25, full month, or custom dates.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {(["1-10", "1-15", "1-25", "FULL", "CUSTOM"] as const).map((mode) => (
              <button
                key={mode}
                onClick={() => applyReportMode(mode)}
                className={cn("px-3 py-2 rounded-lg text-sm font-bold border transition-colors", reportMode === mode ? "bg-primary border-primary text-white" : "border-surface-4 text-text-secondary hover:bg-surface-3")}
              >
                {mode === "FULL" ? "Full Month" : mode}
              </button>
            ))}
          </div>
        </div>

        <div className="p-5 space-y-5">
          <div className="flex flex-col md:flex-row gap-3">
            <input className="input md:w-44" type="date" value={reportStart} onChange={(event) => { setReportMode("CUSTOM"); setReportStart(event.target.value); }} />
            <input className="input md:w-44" type="date" value={reportEnd} onChange={(event) => { setReportMode("CUSTOM"); setReportEnd(event.target.value); }} />
            <button onClick={loadCycleReport} className="btn-primary flex items-center justify-center gap-2">
              <RefreshCw className="w-4 h-4" />
              Load Report
            </button>
            <button onClick={exportCycleCsv} disabled={!cycleReport} className="btn-secondary flex items-center justify-center gap-2 disabled:opacity-50">
              <Download className="w-4 h-4" />
              Export CSV
            </button>
            <button onClick={() => window.print()} disabled={!cycleReport} className="btn-secondary flex items-center justify-center gap-2 disabled:opacity-50">
              <Printer className="w-4 h-4" />
              Print
            </button>
          </div>

          {cycleReport ? (
            <>
              <div className="grid md:grid-cols-6 gap-4">
                <Stat label="Total Milk" value={`${cycleReport.totals.total_quantity.toFixed(2)} kg`} />
                <Stat label="Morning Milk" value={`${cycleReport.totals.morning_quantity.toFixed(2)} kg`} />
                <Stat label="Evening Milk" value={`${cycleReport.totals.evening_quantity.toFixed(2)} kg`} />
                <Stat label="Cow Milk" value={`${cycleReport.totals.cow_quantity.toFixed(2)} kg`} />
                <Stat label="Buffalo Milk" value={`${cycleReport.totals.buffalo_quantity.toFixed(2)} kg`} />
                <Stat label="Cycle Payable" value={toMoney(cycleReport.totals.period_balance)} tone="warning" />
              </div>

              <div className="overflow-x-auto border border-surface-4 rounded-xl">
                <table className="w-full text-left text-sm whitespace-nowrap">
                  <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-widest font-bold">
                    <tr>
                      <th className="px-4 py-3">Supplier</th>
                      <th className="px-4 py-3 text-right">Morning</th>
                      <th className="px-4 py-3 text-right">Evening</th>
                      <th className="px-4 py-3 text-right">Cow</th>
                      <th className="px-4 py-3 text-right">Buffalo</th>
                      <th className="px-4 py-3 text-right">Total kg</th>
                      <th className="px-4 py-3 text-right">Collection</th>
                      <th className="px-4 py-3 text-right">Paid</th>
                        <th className="px-4 py-3 text-right">Cycle Balance</th>
                        <th className="px-4 py-3 text-right">Current Balance</th>
                        <th className="px-4 py-3 text-right">Statement</th>
                      </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-4">
                    {cycleReport.suppliers.map((row: any) => (
                      <tr key={row.id} className="hover:bg-surface-3/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="font-bold text-text-primary">{row.name}</p>
                          <p className="text-xs text-text-secondary">{row.phone || row.code}</p>
                        </td>
                        <td className="px-4 py-3 text-right font-mono">{row.morning_quantity.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono">{row.evening_quantity.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono">{row.cow_quantity.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono">{row.buffalo_quantity.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold">{row.total_quantity.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right font-mono">{toMoney(row.collection_amount)}</td>
                        <td className="px-4 py-3 text-right font-mono text-success">{toMoney(row.paid_amount)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-warning">{toMoney(row.period_balance)}</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-accent">{toMoney(row.current_balance)}</td>
                        <td className="px-4 py-3 text-right">
                          <button onClick={() => openStatement(row.id)} className="btn-secondary py-1.5 px-3 text-xs">
                            Print
                          </button>
                        </td>
                      </tr>
                    ))}
                    {cycleReport.suppliers.length === 0 && (
                      <tr>
                        <td colSpan={11} className="p-10 text-center text-text-secondary">No suppliers found for this report.</td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot className="bg-surface-3 border-t border-surface-4 font-bold">
                    <tr>
                      <td className="px-4 py-3">TOTAL</td>
                      <td className="px-4 py-3 text-right font-mono">{cycleReport.totals.morning_quantity.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono">{cycleReport.totals.evening_quantity.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono">{cycleReport.totals.cow_quantity.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono">{cycleReport.totals.buffalo_quantity.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono">{cycleReport.totals.total_quantity.toFixed(2)}</td>
                      <td className="px-4 py-3 text-right font-mono">{toMoney(cycleReport.totals.collection_amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-success">{toMoney(cycleReport.totals.paid_amount)}</td>
                      <td className="px-4 py-3 text-right font-mono text-warning">{toMoney(cycleReport.totals.period_balance)}</td>
                      <td className="px-4 py-3 text-right font-mono text-accent">{toMoney(cycleReport.totals.current_balance)}</td>
                      <td className="px-4 py-3"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : (
            <div className="p-10 text-center border border-dashed border-surface-4 rounded-xl text-text-secondary">
              Select a payment cycle and click Load Report.
            </div>
          )}
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-5 border-b border-surface-4 bg-surface-2/70">
          <h2 className="font-bold text-lg text-text-primary">Supplier Balances</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-widest font-bold">
              <tr>
                <th className="px-4 py-3">Code</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Shifts</th>
                <th className="px-4 py-3 text-right">Cow Rate</th>
                <th className="px-4 py-3 text-right">Buffalo Rate</th>
                <th className="px-4 py-3 text-right">Payable Balance</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="hover:bg-surface-3/50 transition-colors">
                  <td className="px-4 py-3 font-mono text-text-secondary">{supplier.code}</td>
                  <td className="px-4 py-3">
                    <p className="font-bold text-text-primary">{supplier.name}</p>
                    <p className="text-xs text-text-secondary">{supplier.phone || "No phone"}</p>
                  </td>
                  <td className="px-4 py-3">{supplier.allowed_shifts}</td>
                  <td className="px-4 py-3 text-right font-mono">{toMoney(supplier.cow_rate || supplier.default_rate)}</td>
                  <td className="px-4 py-3 text-right font-mono">{toMoney(supplier.buffalo_rate || supplier.default_rate)}</td>
                  <td className="px-4 py-3 text-right font-mono font-bold text-warning">{toMoney(supplier.current_balance)}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => editSupplier(supplier)} className="btn-secondary py-1.5 px-3 text-xs inline-flex items-center gap-1">
                      <Pencil className="w-3 h-3" />
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
              {suppliers.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-10 text-center text-text-secondary">Add your first farm/supplier to begin milk collection.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {statement && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 border border-surface-4 rounded-xl shadow-float w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
            <div className="p-4 border-b border-surface-4 flex items-center justify-between no-print">
              <div>
                <h2 className="font-bold text-lg text-text-primary">Supplier Statement</h2>
                <p className="text-sm text-text-secondary">{statement.supplier.name} - {statement.startDate} to {statement.endDate}</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => window.print()} className="btn-primary flex items-center gap-2">
                  <Printer className="w-4 h-4" />
                  Print
                </button>
                <button onClick={() => setStatement(null)} className="btn-secondary">Close</button>
              </div>
            </div>

            <div className="overflow-y-auto p-6 bg-white text-black print-target supplier-statement">
              <div className="text-center border-b-2 border-black pb-4 mb-4">
              <h1 className="text-2xl font-black">GUJJAR MILK SHOP</h1>
                <p className="text-sm">Fresh. Fast. Trusted.</p>
                <h2 className="text-lg font-bold mt-3">Supplier Milk Statement</h2>
                <p className="text-sm">{statement.startDate} to {statement.endDate}</p>
              </div>

              <div className="grid grid-cols-2 gap-4 text-sm mb-5">
                <div>
                  <p><strong>Supplier:</strong> {statement.supplier.name}</p>
                  <p><strong>Code:</strong> {statement.supplier.code}</p>
                  <p><strong>Phone:</strong> {statement.supplier.phone || "-"}</p>
                </div>
                <div className="text-right">
                  <p><strong>Allowed Shifts:</strong> {statement.supplier.allowed_shifts}</p>
                  <p><strong>Printed:</strong> {new Date().toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2 text-center mb-5">
                <StatementBox label="Opening Balance" value={toMoney(statement.openingBalance)} />
                <StatementBox label="Milk Amount" value={toMoney(statement.collectionAmount)} />
                <StatementBox label="Paid" value={toMoney(statement.paidAmount)} />
                <StatementBox label="Closing Balance" value={toMoney(statement.closingBalance)} strong />
              </div>

              <div className="grid grid-cols-5 gap-2 text-center mb-5">
                <StatementBox label="Morning Milk" value={`${statement.morningQuantity.toFixed(2)} kg`} />
                <StatementBox label="Evening Milk" value={`${statement.eveningQuantity.toFixed(2)} kg`} />
                <StatementBox label="Cow Milk" value={`${statement.cowQuantity.toFixed(2)} kg`} />
                <StatementBox label="Buffalo Milk" value={`${statement.buffaloQuantity.toFixed(2)} kg`} />
                <StatementBox label="Total Milk" value={`${statement.totalQuantity.toFixed(2)} kg`} strong />
              </div>

              <h3 className="font-bold text-sm border-b border-black pb-1 mb-2">Milk Collections</h3>
              <table className="w-full text-xs border-collapse mb-5">
                <thead>
                  <tr className="border-b border-black">
                    <th className="text-left py-1">Date</th>
                    <th className="text-left py-1">Shift</th>
                    <th className="text-left py-1">Milk</th>
                    <th className="text-right py-1">Qty</th>
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
                      <td className="py-1 text-right">{Number(row.quantity).toFixed(2)} kg</td>
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
              <table className="w-full text-xs border-collapse mb-8">
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

              <div className="grid grid-cols-2 gap-10 text-xs mt-12">
                <div className="border-t border-black pt-2 text-center">Supplier Signature</div>
              <div className="border-t border-black pt-2 text-center">Gujjar Milk Shop Signature</div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="card p-5">
      <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">{label}</p>
      <p className={cn("text-2xl font-bold font-mono text-text-primary", tone === "warning" && "text-warning")}>{value}</p>
    </div>
  );
}

function StatementBox({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="border border-black p-2">
      <p className="text-[10px] uppercase">{label}</p>
      <p className={cn("font-bold", strong && "text-base")}>{value}</p>
    </div>
  );
}
