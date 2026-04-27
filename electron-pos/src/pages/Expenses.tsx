import { useState, useMemo, useEffect } from "react";
import { Receipt, TrendingDown, Wallet, Plus, Trash2, Edit2, FileText } from "lucide-react";
import { cn } from "../lib/utils";

type ExpenseCategory = "MILK_PURCHASE" | "SALARY" | "ELECTRICITY" | "FUEL" | "RENT" | "OTHER";

type Expense = {
  id: string;
  date: string;
  category: ExpenseCategory;
  description: string;
  amount: number;
  addedBy: string;
};

const CATEGORY_COLORS: Record<ExpenseCategory, string> = {
  MILK_PURCHASE: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  SALARY: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  ELECTRICITY: "bg-yellow-500/15 text-yellow-400 border-yellow-500/30",
  FUEL: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  RENT: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  OTHER: "bg-gray-500/15 text-gray-400 border-gray-500/30",
};

const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  MILK_PURCHASE: "Milk Purchase",
  SALARY: "Salary",
  ELECTRICITY: "Electricity",
  FUEL: "Fuel",
  RENT: "Rent",
  OTHER: "Other",
};

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function Expenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [summary, setSummary] = useState({ totalToday: 0, totalMonth: 0, profitToday: 0 });
  
  const [filter, setFilter] = useState<"TODAY" | "WEEK" | "MONTH" | "ALL">("TODAY");

  const loadData = async () => {
    try {
      setIsLoading(true);
      const today = new Date().toISOString().split('T')[0];
      const monthStr = today.substring(0, 7);
      
      const [all, stats] = await Promise.all([
        window.electronAPI?.expenses?.getAll(filter === "TODAY" ? { date: today } : (filter === "MONTH" ? { date: monthStr } : {})),
        window.electronAPI?.reports?.getDashboardStats()
      ]);

      const monthExpenses = await window.electronAPI?.expenses?.getAll({ date: monthStr });
      const monthTotal = monthExpenses?.reduce((sum: number, e: any) => sum + e.amount, 0) || 0;
      const todayTotal = all?.reduce((sum: number, e: any) => sum + e.amount, 0) || 0;

      setExpenses(all || []);
      setSummary({
        totalToday: todayTotal,
        totalMonth: monthTotal,
        profitToday: (stats?.kpis?.revenue || 0) - todayTotal
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

  // Form State
  const [newDate, setNewDate] = useState(new Date().toISOString().split('T')[0]);
  const [newCategory, setNewCategory] = useState<ExpenseCategory>("OTHER");
  const [newDesc, setNewDesc] = useState("");
  const [newAmount, setNewAmount] = useState("");

  const handleAddExpense = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAmount || !newDesc) return;
    
    try {
      const res = await window.electronAPI?.expenses?.create({
        date: newDate,
        category: newCategory,
        description: newDesc,
        amount: Number(newAmount),
        userId: "admin"
      });
      
      if (res?.success) {
        setNewDesc("");
        setNewAmount("");
        loadData();
      } else {
        alert("Failed to save expense: " + res?.error);
      }
    } catch (err) {
      alert("Error saving expense");
    }
  };

  const handleDeleteExpense = async (id: string) => {
    if (!confirm("Are you sure you want to delete this expense?")) return;
    try {
      const res = await window.electronAPI?.expenses?.remove(id);
      if (res?.success) {
        loadData();
      }
    } catch (err) {
      alert("Error deleting expense");
    }
  };

  const exportExpenses = async (format: "excel" | "pdf") => {
    const today = new Date().toISOString().split('T')[0];
    const startDate = filter === "MONTH" ? today.substring(0, 7) + "-01" : filter === "ALL" ? "2000-01-01" : today;
    const result = await window.electronAPI?.reports?.exportReport({ type: "expense-report", format, params: { startDate, endDate: today } });
    if (!result?.success && result?.reason !== "canceled") alert(result?.error || "Export failed");
  };

  const totalDisplay = summary.totalToday;
  const totalMonth = summary.totalMonth;
  const estimatedProfit = summary.profitToday;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Expenses</h1>
          <p className="text-text-secondary mt-1">Manage shop operations and purchases.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => exportExpenses("excel")} className="btn-secondary flex items-center gap-2"><FileText className="w-4 h-4" /> Excel</button>
          <button onClick={() => exportExpenses("pdf")} className="btn-secondary flex items-center gap-2"><FileText className="w-4 h-4" /> PDF</button>
        </div>
      </div>

      {/* TOP CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Today's Expenses</p>
          <div className="flex items-center gap-3">
            <TrendingDown className="w-8 h-8 text-danger opacity-50" />
            <p className="text-2xl font-bold text-danger font-mono">{toMoney(totalDisplay)}</p>
          </div>
        </div>
        <div className="card p-5">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">This Month</p>
          <div className="flex items-center gap-3">
            <Receipt className="w-8 h-8 text-warning opacity-50" />
            <p className="text-2xl font-bold text-warning font-mono">{toMoney(totalMonth)}</p>
          </div>
        </div>
        <div className="card p-5">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Estimated Profit Today</p>
          <div className="flex items-center gap-3">
            <Wallet className="w-8 h-8 text-success opacity-50" />
            <p className="text-2xl font-bold text-success font-mono">{toMoney(estimatedProfit)}</p>
          </div>
        </div>
      </div>

      {/* ADD EXPENSE FORM */}
      <form onSubmit={handleAddExpense} className="card p-4 flex flex-col md:flex-row gap-3 items-end bg-surface-2 border-primary/20 shadow-glow">
        <div className="w-full md:w-40">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Date</label>
          <input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} className="input py-2.5" required />
        </div>
        <div className="w-full md:w-48">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Category</label>
          <select value={newCategory} onChange={e => setNewCategory(e.target.value as ExpenseCategory)} className="input py-2.5">
            {Object.entries(CATEGORY_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>
        <div className="w-full flex-1">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Description</label>
          <input type="text" value={newDesc} onChange={e => setNewDesc(e.target.value)} placeholder="e.g., Bought 500kg milk from Ali" className="input py-2.5" required />
        </div>
        <div className="w-full md:w-40">
          <label className="text-[10px] font-bold text-text-secondary uppercase tracking-wider mb-1 block">Amount (Rs)</label>
          <input type="number" value={newAmount} onChange={e => setNewAmount(e.target.value)} placeholder="0" className="input py-2.5 font-mono" required />
        </div>
        <button type="submit" className="btn-primary w-full md:w-auto h-[42px] flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" /> Save
        </button>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* MAIN LIST */}
        <div className="lg:col-span-3 card overflow-hidden">
          <div className="flex border-b border-surface-4 bg-surface-2/50 overflow-x-auto">
            {["TODAY", "WEEK", "MONTH", "ALL"].map(tab => (
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
               <div className="p-12 flex justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>
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
                {expenses.map(exp => (
                  <tr key={exp.id} className="hover:bg-surface-3/50 transition-colors">
                    <td className="px-4 py-3 text-text-secondary text-xs">{new Date(exp.date).toLocaleDateString()}</td>
                    <td className="px-4 py-3">
                      <span className={cn("px-2 py-0.5 rounded text-[10px] font-bold border", CATEGORY_COLORS[exp.category])}>
                        {CATEGORY_LABELS[exp.category]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-text-primary font-medium">{exp.description}</td>
                    <td className="px-4 py-3 font-mono font-bold text-danger text-right">{toMoney(exp.amount)}</td>
                    <td className="px-4 py-3 text-text-secondary text-xs">{exp.addedBy || "Admin"}</td>
                    <td className="px-4 py-3 text-right space-x-2">
                      <button className="p-1.5 text-text-secondary hover:text-primary hover:bg-primary/10 rounded transition-colors" title="Edit">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button 
                        className="p-1.5 text-text-secondary hover:text-danger hover:bg-danger/10 rounded transition-colors" title="Delete"
                        onClick={() => handleDeleteExpense(exp.id)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
                {expenses.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">
                      <FileText className="w-12 h-12 mx-auto mb-2 opacity-50" />
                      <p>No expenses found</p>
                    </td>
                  </tr>
                )}
                {expenses.length > 0 && (
                  <tr className="bg-surface-3 font-bold">
                    <td colSpan={3} className="px-4 py-3 text-right">Total:</td>
                    <td className="px-4 py-3 font-mono text-danger text-right">{toMoney(expenses.reduce((s, e) => s + e.amount, 0))}</td>
                    <td colSpan={2}></td>
                  </tr>
                )}
              </tbody>
            </table>
            )}
          </div>
        </div>

        {/* SUMMARY BAR */}
        <div className="card p-5 h-max">
          <h3 className="font-semibold mb-4">Summary</h3>
          <div className="space-y-4">
            {Object.entries(CATEGORY_LABELS).map(([k, label]) => {
              const catAmount = expenses.filter(e => e.category === k).reduce((s, e) => s + e.amount, 0);
              if (catAmount === 0) return null;
              const visibleTotal = expenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
              const percent = visibleTotal > 0 ? Math.round((catAmount / visibleTotal) * 100) : 0;
              
              // Get the specific color for the progress bar based on category
              let bgClass = "bg-gray-500";
              if (k === "MILK_PURCHASE") bgClass = "bg-blue-500";
              if (k === "SALARY") bgClass = "bg-purple-500";
              if (k === "ELECTRICITY") bgClass = "bg-yellow-500";
              if (k === "FUEL") bgClass = "bg-orange-500";
              if (k === "RENT") bgClass = "bg-indigo-500";

              return (
                <div key={k}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="font-medium text-text-primary">{label}</span>
                    <span className="font-mono text-text-secondary">{toMoney(catAmount)} ({percent}%)</span>
                  </div>
                  <div className="w-full bg-surface-4 rounded-full h-2 overflow-hidden">
                    <div className={cn("h-full rounded-full", bgClass)} style={{ width: `${percent}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
