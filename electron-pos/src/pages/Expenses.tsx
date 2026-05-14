import { useState, useMemo, useEffect } from "react";
import {
  BarChart3,
  CalendarDays,
  Edit2,
  FileText,
  Flame,
  Lock,
  Milk,
  Plus,
  Receipt,
  ShoppingBag,
  Trash2,
  TrendingDown,
  Wallet,
  Zap,
} from "lucide-react";
import { cn } from "../lib/utils";

type ExpenseCategory =
  | "MILK_PURCHASE"
  | "SALARY"
  | "SHOPPING_BAG"
  | "WASHING_MATERIAL"
  | "ROTI"
  | "ELECTRICITY_BILL"
  | "WASA_BILL"
  | "GAS_BILL"
  | "ELECTRICITY"
  | "FUEL"
  | "PACKAGING"
  | "RENT"
  | "MAINTENANCE"
  | "CLEANING"
  | "WASTAGE"
  | "MISCELLANEOUS"
  | "OTHER";

type Expense = {
  id: string;
  date?: string;
  expense_date?: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  addedBy?: string;
  created_by_id?: string;
};

type WastageProduct = {
  id: string;
  code: "MILK" | "YOGT";
  name: string;
  stock: number;
  cost_price: number;
  averageCost: number;
};

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  MILK_PURCHASE: "Milk Purchase",
  SALARY: "Salary",
  SHOPPING_BAG: "Shopping Bag",
  WASHING_MATERIAL: "Washing Material",
  ROTI: "Roti",
  ELECTRICITY_BILL: "Electricity Bill",
  WASA_BILL: "WASA Bill",
  GAS_BILL: "Gas Bill",
  ELECTRICITY: "Electricity",
  FUEL: "Fuel",
  PACKAGING: "Packaging",
  RENT: "Rent",
  MAINTENANCE: "Maintenance",
  CLEANING: "Cleaning",
  WASTAGE: "Wastage",
  MISCELLANEOUS: "Miscellaneous",
  OTHER: "Other",
};

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  MILK_PURCHASE: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  SALARY: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  SHOPPING_BAG: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  WASHING_MATERIAL: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  ROTI: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  ELECTRICITY_BILL: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  WASA_BILL: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  GAS_BILL: "bg-red-500/15 text-red-400 border-red-500/30",
  ELECTRICITY: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  FUEL: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  PACKAGING: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  RENT: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  MAINTENANCE: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  CLEANING: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30",
  WASTAGE: "bg-rose-500/15 text-rose-400 border-rose-500/30",
  MISCELLANEOUS: "bg-gray-500/15 text-gray-300 border-gray-500/30",
  OTHER: "bg-gray-500/15 text-gray-300 border-gray-500/30",
};

const BAR_COLORS: Record<ExpenseCategory, string> = {
  MILK_PURCHASE: "bg-blue-500",
  SALARY: "bg-purple-500",
  SHOPPING_BAG: "bg-emerald-500",
  WASHING_MATERIAL: "bg-cyan-500",
  ROTI: "bg-amber-500",
  ELECTRICITY_BILL: "bg-yellow-500",
  WASA_BILL: "bg-sky-500",
  GAS_BILL: "bg-red-500",
  ELECTRICITY: "bg-yellow-500",
  FUEL: "bg-orange-500",
  PACKAGING: "bg-emerald-500",
  RENT: "bg-indigo-500",
  MAINTENANCE: "bg-slate-500",
  CLEANING: "bg-cyan-500",
  WASTAGE: "bg-rose-500",
  MISCELLANEOUS: "bg-gray-500",
  OTHER: "bg-gray-500",
};

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek() {
  const date = new Date();
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return localDate(date);
}

function displayDate(value?: string) {
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return "-";
}

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function categoryLabel(category: ExpenseCategory) {
  return CATEGORY_LABELS[category] || String(category || "Other").replace(/_/g, " ");
}

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [monthExpenses, setMonthExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState({ totalToday: 0, totalMonth: 0, profitToday: 0, operatingMonth: 0, expectedSalary: 0 });
  const [filter, setFilter] = useState<"TODAY" | "WEEK" | "MONTH" | "ALL">("TODAY");
  const [user, setUser] = useState<any>(null);

  const [newDate, setNewDate] = useState(localDate());
  const [newCategory, setNewCategory] = useState<ExpenseCategory>("SHOPPING_BAG");
  const [newDesc, setNewDesc] = useState("");
  const [newAmount, setNewAmount] = useState("");
  const [wastageProducts, setWastageProducts] = useState<WastageProduct[]>([]);
  const [wastageForm, setWastageForm] = useState({ date: localDate(), productCode: "MILK" as "MILK" | "YOGT", quantity: "", sellAmount: "", notes: "" });

  const visibleTotal = useMemo(
    () => expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
    [expenses]
  );

  const categoryBreakdown = useMemo(() => {
    const totals = new Map<ExpenseCategory, number>();
    monthExpenses.forEach((expense) => {
      totals.set(expense.category, (totals.get(expense.category) || 0) + Number(expense.amount || 0));
    });
    const monthlyTotal = monthExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    return Array.from(totals.entries())
      .map(([category, amount]) => ({
        category,
        amount,
        percent: monthlyTotal > 0 ? Math.round((amount / monthlyTotal) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [monthExpenses]);

  const largestCategory = categoryBreakdown[0];
  const dailyAverage = summary.operatingMonth / Math.max(1, new Date().getDate());
  const isAdmin = user?.role === "ADMIN";
  const selectedWastageProduct = wastageProducts.find((product) => product.code === wastageForm.productCode);
  const wastageQuantity = Number(wastageForm.quantity || 0);
  const wastageRecovery = Number(wastageForm.sellAmount || 0);
  const wastageGross = Math.max(0, wastageQuantity * Number(selectedWastageProduct?.averageCost || 0));
  const wastageNet = Math.max(0, wastageGross - Math.max(0, wastageRecovery));

  const loadData = async () => {
    try {
      setIsLoading(true);
      const today = localDate();
      const monthStr = today.slice(0, 7);
      const listFilter =
        filter === "TODAY"
          ? { date: today }
          : filter === "WEEK"
            ? { startDate: startOfWeek(), endDate: today }
            : filter === "MONTH"
              ? { date: monthStr }
              : {};

      const [all, stats, monthRows, todayExpenses, currentUser, payroll, wastageDefaults] = await Promise.all([
        window.electronAPI?.expenses?.getAll(listFilter),
        window.electronAPI?.reports?.getDashboardStats(),
        window.electronAPI?.expenses?.getAll({ date: monthStr }),
        window.electronAPI?.expenses?.getAll({ date: today }),
        window.electronAPI?.auth?.getMe(),
        window.electronAPI?.employees?.getPayrollSummary?.(monthStr),
        window.electronAPI?.expenses?.getWastageDefaults?.(),
      ]);

      const normalized = (all || []).map((expense: any) => ({
        ...expense,
        category: expense.category || "MISCELLANEOUS",
        amount: Number(expense.amount || 0),
      }));
      const normalizedMonth = (monthRows || []).map((expense: any) => ({
        ...expense,
        category: expense.category || "MISCELLANEOUS",
        amount: Number(expense.amount || 0),
      }));
      const monthTotal = normalizedMonth.reduce((sum: number, expense: any) => sum + Number(expense.amount || 0), 0);
      const todayTotal = (todayExpenses || []).reduce((sum: number, expense: any) => sum + Number(expense.amount || 0), 0);
      const postedSalary = Number(payroll?.data?.postedSalaryExpenses || 0);
      const expectedSalary = Number(payroll?.data?.expectedGrossSalary || 0);
      const nonSalaryMonth = normalizedMonth
        .filter((expense: any) => expense.category !== "SALARY")
        .reduce((sum: number, expense: any) => sum + Number(expense.amount || 0), 0);

      setExpenses(normalized);
      setMonthExpenses(normalizedMonth);
      setUser(currentUser);
      setWastageProducts((wastageDefaults || []).map((product: any) => ({
        ...product,
        stock: Number(product.stock || 0),
        cost_price: Number(product.cost_price || 0),
        averageCost: Number(product.averageCost || product.cost_price || 0),
      })));
      setSummary({
        totalToday: todayTotal,
        totalMonth: monthTotal,
        profitToday: Number(stats?.kpis?.revenue || 0) - todayTotal,
        operatingMonth: nonSalaryMonth + Math.max(postedSalary, expectedSalary),
        expectedSalary,
      });
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [filter]);

  const handleAddExpense = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!newAmount || !newDesc.trim()) return;

    try {
      const res = await window.electronAPI?.expenses?.create({
        date: newDate,
        category: newCategory,
        description: newDesc.trim(),
        amount: Number(newAmount),
      });

      if (res?.success) {
        setNewDesc("");
        setNewAmount("");
        loadData();
      } else {
        alert("Failed to save expense: " + (res?.error || "Unknown error"));
      }
    } catch (err) {
      alert("Error saving expense");
    }
  };

  const handleDeleteExpense = async (id: string) => {
    const managerPin = prompt("Enter manager PIN to delete this expense");
    if (!managerPin) return;
    const reason = prompt("Reason for deleting this expense");
    if (!reason) return;
    const res = await window.electronAPI?.expenses?.remove(id, { managerPin, reason });
    if (res?.success) loadData();
    else alert(res?.error || "Could not delete expense");
  };

  const handleChangeCategory = async (expense: Expense, category: ExpenseCategory) => {
    if (!isAdmin) return;
    const res = await window.electronAPI?.expenses?.update(expense.id, { category });
    if (res?.success) loadData();
    else alert(res?.error || "Could not change category");
  };

  const handleAddWastage = async (event: React.FormEvent) => {
    event.preventDefault();
    const res = await window.electronAPI?.expenses?.addWastage({
      date: wastageForm.date,
      productCode: wastageForm.productCode,
      quantity: Number(wastageForm.quantity),
      sellAmount: Number(wastageForm.sellAmount || 0),
      notes: wastageForm.notes,
    });
    if (res?.success) {
      setWastageForm((current) => ({ ...current, quantity: "", sellAmount: "", notes: "" }));
      alert(`Wastage saved. Net loss: ${toMoney(res.netLoss || 0)}`);
      loadData();
    } else {
      alert(res?.error || "Could not save wastage");
    }
  };

  const exportExpenses = async (format: "excel" | "pdf") => {
    const today = localDate();
    const startDate = filter === "MONTH" ? `${today.slice(0, 7)}-01` : filter === "ALL" ? "2000-01-01" : filter === "WEEK" ? startOfWeek() : today;
    const result = await window.electronAPI?.reports?.exportReport({ type: "expense-report", format, params: { startDate, endDate: today } });
    if (!result?.success && result?.reason !== "canceled") alert(result?.error || "Export failed");
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Expense Dashboard</h1>
          <p className="text-text-secondary mt-1">Track shop costs, bills, salaries, and profit leakage.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportExpenses("excel")} className="btn-secondary flex items-center gap-2"><FileText className="w-4 h-4" /> Excel</button>
          <button onClick={() => exportExpenses("pdf")} className="btn-secondary flex items-center gap-2"><FileText className="w-4 h-4" /> PDF</button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard icon={TrendingDown} label="Today Expense" value={toMoney(summary.totalToday)} tone="danger" />
        <StatCard icon={Receipt} label="This Month" value={toMoney(summary.totalMonth)} tone="warning" />
        <StatCard icon={Wallet} label="After Expense Today" value={toMoney(summary.profitToday)} tone={summary.profitToday >= 0 ? "success" : "danger"} />
        <StatCard icon={BarChart3} label="Daily Avg This Month" value={toMoney(dailyAverage)} hint={`Includes salary ${toMoney(summary.expectedSalary)}`} tone="primary" />
        <StatCard icon={ShoppingBag} label="Biggest Cost" value={largestCategory ? categoryLabel(largestCategory.category) : "No data"} hint={largestCategory ? toMoney(largestCategory.amount) : ""} tone="accent" />
      </div>

      <form onSubmit={handleAddExpense} className="card overflow-hidden">
        <div className="p-4 border-b border-surface-4 bg-surface-2/70">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <Plus className="w-4 h-4 text-primary" /> Add Expense
          </h2>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-[150px_220px_1fr_150px_auto] gap-3 items-end">
          <div>
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Date</label>
            <input type="date" value={newDate} onChange={(e) => setNewDate(e.target.value)} className="input py-2.5" required />
          </div>
          <div>
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Category</label>
            <select value={newCategory} onChange={(e) => setNewCategory(e.target.value as ExpenseCategory)} className="input py-2.5">
              {Object.entries(CATEGORY_LABELS).map(([key, value]) => (
                <option key={key} value={key}>{value}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Description</label>
            <input type="text" value={newDesc} onChange={(e) => setNewDesc(e.target.value)} placeholder="e.g., shopping bags, washing powder, gas bill" className="input py-2.5" required />
          </div>
          <div>
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Amount (Rs)</label>
            <input type="number" min="1" step="0.01" value={newAmount} onChange={(e) => setNewAmount(e.target.value)} placeholder="0" className="input py-2.5 font-mono" required />
          </div>
          <button type="submit" className="btn-primary h-[42px] px-5 flex items-center justify-center gap-2 whitespace-nowrap">
            <Plus className="w-4 h-4" /> Save
          </button>
        </div>
      </form>

      <form onSubmit={handleAddWastage} className="card overflow-hidden">
        <div className="p-4 border-b border-surface-4 bg-surface-2/70 flex items-center justify-between gap-3">
          <h2 className="font-bold text-sm flex items-center gap-2">
            <Milk className="w-4 h-4 text-rose-400" /> Milk / Yogurt Wastage
          </h2>
          <p className="text-xs text-text-secondary">Net wastage = purchase cost - any recovery sale.</p>
        </div>
        <div className="p-4 grid grid-cols-1 md:grid-cols-[140px_160px_130px_150px_1fr_auto] gap-3 items-end">
          <div>
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Date</label>
            <input type="date" value={wastageForm.date} onChange={(e) => setWastageForm((f) => ({ ...f, date: e.target.value }))} className="input py-2.5" required />
          </div>
          <div>
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Product</label>
            <select value={wastageForm.productCode} onChange={(e) => setWastageForm((f) => ({ ...f, productCode: e.target.value as "MILK" | "YOGT" }))} className="input py-2.5">
              <option value="MILK">Milk</option>
              <option value="YOGT">Yogurt</option>
            </select>
          </div>
          <div>
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Qty (kg)</label>
            <input type="number" min="0.001" step="0.001" value={wastageForm.quantity} onChange={(e) => setWastageForm((f) => ({ ...f, quantity: e.target.value }))} className="input py-2.5 font-mono" required />
          </div>
          <div>
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Sold Recovery</label>
            <input type="number" min="0" step="0.01" value={wastageForm.sellAmount} onChange={(e) => setWastageForm((f) => ({ ...f, sellAmount: e.target.value }))} placeholder="0" className="input py-2.5 font-mono" />
          </div>
          <div>
            <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Reason / Notes</label>
            <input value={wastageForm.notes} onChange={(e) => setWastageForm((f) => ({ ...f, notes: e.target.value }))} placeholder="e.g., sour milk, broken pack, low-price sale" className="input py-2.5" />
          </div>
          <button type="submit" className="btn-primary h-[42px] px-5 whitespace-nowrap">Save Wastage</button>
        </div>
        <div className="px-4 pb-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
          <div className="rounded-lg border border-surface-4 p-3"><span className="text-text-secondary">Stock</span><p className="font-mono font-bold">{Number(selectedWastageProduct?.stock || 0).toFixed(2)} kg</p></div>
          <div className="rounded-lg border border-surface-4 p-3"><span className="text-text-secondary">Avg Cost</span><p className="font-mono font-bold">{toMoney(Number(selectedWastageProduct?.averageCost || 0))}/kg</p></div>
          <div className="rounded-lg border border-surface-4 p-3"><span className="text-text-secondary">Gross Loss</span><p className="font-mono font-bold text-danger">{toMoney(wastageGross)}</p></div>
          <div className="rounded-lg border border-surface-4 p-3"><span className="text-text-secondary">Net Expense</span><p className="font-mono font-bold text-rose-400">{toMoney(wastageNet)}</p></div>
        </div>
      </form>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_340px] gap-6">
        <div className="card overflow-hidden">
          <div className="flex border-b border-surface-4 bg-surface-2/50 overflow-x-auto">
            {["TODAY", "WEEK", "MONTH", "ALL"].map((tab) => (
              <button
                key={tab}
                onClick={() => setFilter(tab as any)}
                className={cn(
                  "px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                  filter === tab ? "border-primary text-primary bg-primary/5" : "border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-3"
                )}
              >
                {tab === "TODAY" ? "Today" : tab === "WEEK" ? "This Week" : tab === "MONTH" ? "This Month" : "All Time"}
              </button>
            ))}
          </div>

          <div className="overflow-x-auto">
            {isLoading ? (
              <div className="p-12 flex justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" /></div>
            ) : (
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-wider font-semibold border-b border-surface-4">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Description</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3">Added By</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-4">
                  {expenses.map((expense) => (
                    <tr key={expense.id} className="hover:bg-surface-3/50 transition-colors">
                      <td className="px-4 py-3 text-text-secondary text-xs">
                        <span className="inline-flex items-center gap-1"><CalendarDays className="w-3 h-3" />{displayDate(expense.expense_date || expense.date)}</span>
                      </td>
                      <td className="px-4 py-3">
                        {isAdmin ? (
                          <select
                            value={expense.category}
                            onChange={(event) => handleChangeCategory(expense, event.target.value as ExpenseCategory)}
                            className="input py-1 text-xs min-w-[150px]"
                          >
                            {Object.entries(CATEGORY_LABELS).map(([key, value]) => <option key={key} value={key}>{value}</option>)}
                          </select>
                        ) : (
                          <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold border inline-flex items-center gap-1", CATEGORY_COLORS[expense.category] || CATEGORY_COLORS.MISCELLANEOUS)}>
                            <Lock className="w-3 h-3" /> {categoryLabel(expense.category)}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-text-primary font-medium max-w-[360px] truncate">{expense.description}</td>
                      <td className="px-4 py-3 font-mono font-bold text-danger text-right">{toMoney(Number(expense.amount || 0))}</td>
                      <td className="px-4 py-3 text-text-secondary text-xs">{expense.addedBy || expense.created_by_id || "Admin"}</td>
                      <td className="px-4 py-3 text-right space-x-2">
                        <button className="p-1.5 text-text-secondary hover:text-primary hover:bg-primary/10 rounded transition-colors" title="Edit">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button
                          className="p-1.5 text-text-secondary hover:text-danger hover:bg-danger/10 rounded transition-colors"
                          title="Delete"
                          onClick={() => handleDeleteExpense(expense.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {expenses.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-12 text-center text-text-secondary">
                        <FileText className="w-14 h-14 mx-auto mb-3 opacity-20" />
                        <p className="font-bold text-text-primary">No expenses found</p>
                        <p className="text-sm mt-1">Add an expense above or change the filter.</p>
                      </td>
                    </tr>
                  )}
                  {expenses.length > 0 && (
                    <tr className="bg-surface-3 font-bold">
                      <td colSpan={3} className="px-4 py-3 text-right">Visible Total:</td>
                      <td className="px-4 py-3 font-mono text-danger text-right">{toMoney(visibleTotal)}</td>
                      <td colSpan={2} />
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <div className="card overflow-hidden">
            <div className="p-4 border-b border-surface-4 bg-surface-2/70">
              <h3 className="font-bold text-sm">Cost Breakdown</h3>
            </div>
            <div className="p-5 space-y-4">
              {categoryBreakdown.map(({ category, amount, percent }) => (
                <div key={category}>
                  <div className="flex justify-between text-xs mb-1 gap-3">
                    <span className="font-medium text-text-primary truncate">{categoryLabel(category)}</span>
                    <span className="font-mono text-text-secondary shrink-0">{toMoney(amount)} ({percent}%)</span>
                  </div>
                  <div className="w-full bg-surface-4 rounded-full h-2 overflow-hidden">
                    <div className={cn("h-full rounded-full", BAR_COLORS[category] || "bg-gray-500")} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              ))}
              {categoryBreakdown.length === 0 && <p className="text-sm text-text-secondary">No expense data this month.</p>}
            </div>
          </div>

          <div className="card p-5 space-y-3">
            <h3 className="font-bold text-sm">Owner Notes</h3>
            <Insight icon={ShoppingBag} text="Shopping bags are tracked separately because they quietly eat margin on small sales." />
            <Insight icon={Zap} text="Utility bills are split into electricity, WASA, and gas so monthly pressure is visible." />
            <Insight icon={Flame} text="If one category crosses 35% of visible expense, review supplier price or wastage." />
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, hint, tone }: { icon: any; label: string; value: string; hint?: string; tone: "danger" | "warning" | "success" | "primary" | "accent" }) {
  const toneClasses: Record<string, string> = {
    danger: "text-danger bg-danger/10",
    warning: "text-warning bg-warning/10",
    success: "text-success bg-success/10",
    primary: "text-primary bg-primary/10",
    accent: "text-accent bg-accent/10",
  };
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", toneClasses[tone])}>
          <Icon className="w-5 h-5" />
        </div>
        <p className="text-xs text-text-secondary font-bold uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-2xl font-bold text-text-primary font-mono truncate">{value}</p>
      {hint ? <p className="text-xs text-text-secondary mt-1 font-mono">{hint}</p> : null}
    </div>
  );
}

function Insight({ icon: Icon, text }: { icon: any; text: string }) {
  return (
    <div className="flex gap-3 text-sm text-text-secondary">
      <Icon className="w-4 h-4 mt-0.5 text-primary shrink-0" />
      <p>{text}</p>
    </div>
  );
}
