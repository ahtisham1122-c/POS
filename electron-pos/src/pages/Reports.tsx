import { useState, useEffect } from "react";
import { AlertTriangle, Calendar as CalendarIcon, Download, TrendingUp, TrendingDown, DollarSign, Package, Users, XCircle } from "lucide-react";
import { cn } from "../lib/utils";
import { format } from "date-fns";

type ReportTab = "DAILY" | "SALES" | "PRODUCTS" | "DUES" | "PNL";

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function Reports() {
  const [activeTab, setActiveTab] = useState<ReportTab>("DAILY");
  const [dateStr, setDateStr] = useState(new Date().toISOString().split('T')[0]);
  const [dailyData, setDailyData] = useState<any>(null);
  const [salesHistory, setSalesHistory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duesData, setDuesData] = useState<any[]>([]);
  const [profitLossData, setProfitLossData] = useState<any>(null);
  const [voidSale, setVoidSale] = useState<any>(null);
  const [voidReason, setVoidReason] = useState("");
  const [voidRestockItems, setVoidRestockItems] = useState(true);
  const [isVoiding, setIsVoiding] = useState(false);
  const [plStartDate, setPlStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [plEndDate, setPlEndDate] = useState(new Date().toISOString().split('T')[0]);

  useEffect(() => {
    window.electronAPI?.system?.getBusinessDate().then((day) => {
      if (day?.date) {
        setDateStr(day.date);
        setPlEndDate(day.date);
      }
    });
  }, []);

  useEffect(() => {
    if (activeTab === "DAILY") {
      fetchDailySummary();
    } else if (activeTab === "SALES") {
      fetchSalesHistory();
    } else if (activeTab === "DUES") {
      fetchDues();
    } else if (activeTab === "PNL") {
      fetchProfitLoss();
    }
  }, [activeTab, dateStr, plStartDate, plEndDate]);

  const fetchDailySummary = async () => {
    setIsLoading(true);
    try {
      const data = await window.electronAPI?.reports?.getEndOfDay(dateStr);
      setDailyData(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSalesHistory = async () => {
    setIsLoading(true);
    try {
      const data = await window.electronAPI?.sales?.getAll({ date: dateStr });
      setSalesHistory(data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchDues = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await window.electronAPI?.reports?.getCustomerDues();
      setDuesData(data || []);
    } catch (err) {
      console.error(err);
      setError('Failed to load customer dues');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchProfitLoss = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await window.electronAPI?.reports?.getProfitLoss(plStartDate, plEndDate);
      setProfitLossData(data);
    } catch (err) {
      console.error(err);
      setError('Failed to load profit & loss');
    } finally {
      setIsLoading(false);
    }
  };

  const exportReport = async (type: string, format: "excel" | "pdf", params: any = {}) => {
    const result = await window.electronAPI?.reports?.exportReport({ type, format, params });
    if (!result?.success && result?.reason !== "canceled") {
      alert(result?.error || "Export failed");
    }
  };

  const handleReprint = async (saleId: string) => {
    try {
      const receipt = await window.electronAPI?.sales?.getReceipt(saleId);
      if (receipt) {
        // Since we don't have a direct "print" IPC that doesn't show modal, 
        // we'll rely on the user seeing the receipt modal if we were in POS, 
        // but here we might need a dedicated print call or just alert.
        // For now, let's assume we want to trigger the printer directly if possible.
        await window.electronAPI?.printer?.printReceipt(receipt);
      }
    } catch (err) {
      alert("Failed to reprint receipt");
    }
  };

  const openVoidDialog = (sale: any) => {
    setVoidSale(sale);
    setVoidReason("");
    setVoidRestockItems(true);
  };

  const submitVoidSale = async () => {
    if (!voidSale || isVoiding) return;

    const cleanReason = voidReason.trim();
    if (cleanReason.length < 5) {
      alert("Please write a clear reason with at least 5 characters.");
      return;
    }

    setIsVoiding(true);
    try {
      const managerPin = window.prompt("Manager PIN required to void this sale.");
      if (!managerPin) {
        alert("Void blocked. Manager PIN is required.");
        return;
      }
      const result = await window.electronAPI?.sales?.void({
        saleId: voidSale.id,
        reason: cleanReason,
        restockItems: voidRestockItems,
        managerPin,
      });

      if (!result?.success) {
        alert("Void failed: " + (result?.error || "Unknown error"));
        return;
      }

      alert(`${result.billNumber} voided successfully.`);
      setVoidSale(null);
      setVoidReason("");
      await fetchSalesHistory();
      await fetchDailySummary();
    } finally {
      setIsVoiding(false);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Reports & Analytics</h1>
          <p className="text-text-secondary mt-1">Detailed insights into shop performance.</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex border-b border-surface-4 bg-surface-2/50 overflow-x-auto">
          {[
            { id: "DAILY", label: "Daily Summary" },
            { id: "SALES", label: "Sales History" },
            { id: "PRODUCTS", label: "Products" },
            { id: "DUES", label: "Customer Dues" },
            { id: "PNL", label: "Profit & Loss" },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as ReportTab)}
              className={cn(
                "px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                activeTab === tab.id ? "border-primary text-primary bg-primary/5" : "border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-3"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "DAILY" && (
          <div className="p-4 md:p-6 space-y-6 animate-slide-in-right">
            <div className="flex flex-col sm:flex-row items-center gap-4 bg-surface-3 p-4 rounded-lg border border-surface-4">
              <div className="relative">
                <CalendarIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                <input 
                  type="date" 
                  value={dateStr}
                  onChange={e => setDateStr(e.target.value)}
                  className="input pl-10 py-2 w-auto"
                />
              </div>
              <button onClick={() => exportReport("daily-sales", "excel", { date: dateStr })} className="btn-secondary flex items-center gap-2 sm:ml-auto">
                <Download className="w-4 h-4" /> Excel
              </button>
              <button onClick={() => exportReport("daily-sales", "pdf", { date: dateStr })} className="btn-secondary flex items-center gap-2">
                <Download className="w-4 h-4" /> PDF
              </button>
              <button onClick={() => exportReport("z-report", "pdf", { date: dateStr })} className="btn-primary flex items-center gap-2">
                <Download className="w-4 h-4" /> Z-Report PDF
              </button>
            </div>

            {isLoading ? (
              <div className="p-12 flex justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>
            ) : dailyData ? (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="card p-5 border-l-4 border-l-primary">
                  <p className="text-xs text-text-secondary font-bold uppercase mb-2">Total Sales</p>
                  <p className="text-2xl font-bold font-mono text-text-primary">{toMoney(dailyData.totalSales)}</p>
                </div>
                <div className="card p-5 border-l-4 border-l-success">
                  <p className="text-xs text-text-secondary font-bold uppercase mb-2">Cash Collected</p>
                  <p className="text-2xl font-bold font-mono text-success">{toMoney(dailyData.cashSales)}</p>
                </div>
                <div className="card p-5 border-l-4 border-l-danger">
                  <p className="text-xs text-text-secondary font-bold uppercase mb-2">Credit Sales</p>
                  <p className="text-2xl font-bold font-mono text-danger">{toMoney(dailyData.creditSales)}</p>
                </div>
                <div className="card p-5 border-l-4 border-l-info">
                  <p className="text-xs text-text-secondary font-bold uppercase mb-2">Total Bills</p>
                  <p className="text-2xl font-bold font-mono text-text-primary">{dailyData.bills}</p>
                </div>
                <div className="card p-5 border-l-4 border-l-warning">
                  <p className="text-xs text-text-secondary font-bold uppercase mb-2">Refunds</p>
                  <p className="text-xl font-bold font-mono text-warning">{toMoney(dailyData.refunds)}</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-text-secondary font-bold uppercase mb-2">Milk Sold</p>
                  <p className="text-xl font-bold font-mono text-text-primary">{dailyData.milkSold.toFixed(2)} kg</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-text-secondary font-bold uppercase mb-2">Yogurt Sold</p>
                  <p className="text-xl font-bold font-mono text-text-primary">{dailyData.yogurtSold.toFixed(2)} kg</p>
                </div>
                <div className="card p-5">
                  <p className="text-xs text-text-secondary font-bold uppercase mb-2">Expenses</p>
                  <p className="text-xl font-bold font-mono text-danger">{toMoney(dailyData.expenses)}</p>
                </div>
                <div className="card p-5 bg-primary/5 border-primary/20">
                  <p className="text-xs text-primary font-bold uppercase mb-2">Net Cash</p>
                  <p className="text-xl font-bold font-mono text-primary">{toMoney(dailyData.cashSales - dailyData.expenses)}</p>
                </div>
              </div>
            ) : (
              <div className="text-center p-12 text-text-secondary">No data found for this date.</div>
            )}
          </div>
        )}

        {activeTab === "SALES" && (
          <div className="p-4 md:p-6 animate-slide-in-right space-y-4">
            <div className="flex items-center gap-4 bg-surface-3 p-4 rounded-lg border border-surface-4">
              <input 
                type="date" 
                value={dateStr}
                onChange={e => setDateStr(e.target.value)}
                className="input py-2 w-auto"
              />
              <p className="text-sm text-text-secondary">Showing {salesHistory.length} transactions</p>
            </div>

            <div className="overflow-x-auto border border-surface-4 rounded-xl">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-3 border-b border-surface-4 text-text-secondary uppercase text-[10px] font-bold tracking-widest">
                  <tr>
                    <th className="px-4 py-3">Bill #</th>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">Customer</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-right">Paid</th>
                    <th className="px-4 py-3 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-4">
                  {salesHistory.map((sale) => (
                    <tr key={sale.id} className="hover:bg-surface-3/50 transition-colors">
                      <td className="px-4 py-3 font-bold text-text-primary">{sale.bill_number}</td>
                      <td className="px-4 py-3 text-text-secondary">{format(new Date(sale.sale_date), "hh:mm a")}</td>
                      <td className="px-4 py-3 text-text-primary">{sale.customer_name || "Walk-in"}</td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold",
                          sale.payment_type === "CASH" ? "bg-success/10 text-success" : 
                          sale.payment_type === "CREDIT" ? "bg-danger/10 text-danger" : "bg-info/10 text-info"
                        )}>
                          {sale.payment_type}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold",
                          sale.status === "CANCELLED" ? "bg-surface-4 text-text-secondary" :
                          sale.status === "REFUNDED" ? "bg-danger/10 text-danger" :
                          sale.status === "PARTIALLY_REFUNDED" ? "bg-warning/10 text-warning" : "bg-success/10 text-success"
                        )}>
                          {sale.status || "COMPLETED"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-text-primary">{toMoney(sale.grand_total)}</td>
                      <td className="px-4 py-3 text-right font-mono text-success">{toMoney(sale.amount_paid)}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button 
                            onClick={() => handleReprint(sale.id)}
                            className="p-1.5 hover:bg-surface-4 rounded text-primary transition-colors"
                            title="Reprint Receipt"
                          >
                            <Download className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => openVoidDialog(sale)}
                            disabled={sale.status !== "COMPLETED"}
                            className="p-1.5 hover:bg-danger/10 rounded text-danger transition-colors disabled:opacity-30 disabled:hover:bg-transparent"
                            title="Void / Cancel Bill"
                          >
                            <XCircle className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {salesHistory.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-4 py-12 text-center text-text-secondary">No sales found for this date.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === "PRODUCTS" && (
          <div className="p-4 md:p-6 animate-slide-in-right">
            <div className="text-center p-12 border border-dashed border-surface-4 rounded-lg text-text-secondary">
              Products Report implementation coming soon.
            </div>
          </div>
        )}

        {activeTab === "DUES" && (
          <div className="p-4 md:p-6 animate-slide-in-right">
            {error && <div className="text-center text-danger mb-4">{error}</div>}
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-bold">Customer Dues</h2>
              <button
                className="btn-primary flex items-center gap-2"
                onClick={() => {
                  const csv = ['Name,Phone,Balance']
                    .concat(duesData.map(d => `${d.name},${d.phone},${d.current_balance}`))
                    .join('\n');
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url;
                  a.download = 'customer_dues.csv';
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                disabled={isLoading || duesData.length === 0}
              >
                <Download className="w-4 h-4" /> Export CSV
              </button>
            </div>
            {isLoading ? (
              <div className="p-12 flex justify-center">
                <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
              </div>
            ) : duesData && duesData.length > 0 ? (
              <div className="overflow-x-auto border border-surface-4 rounded-xl">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface-3 border-b border-surface-4 text-text-secondary uppercase text-[10px] font-bold tracking-widest">
                    <tr>
                      <th className="px-4 py-3">Name</th>
                      <th className="px-4 py-3">Phone</th>
                      <th className="px-4 py-3 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-4">
                    {duesData.map((d) => (
                      <tr key={d.id} className="hover:bg-surface-3/50 transition-colors">
                        <td className="px-4 py-3 text-text-primary">{d.name}</td>
                        <td className="px-4 py-3 text-text-secondary">{d.phone}</td>
                        <td className="px-4 py-3 text-right font-mono text-danger">{toMoney(d.current_balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center p-12 text-text-secondary">No dues found.</div>
            )}
          </div>
        )}

          {activeTab === "PNL" && (
            <div className="p-4 md:p-6 max-w-3xl mx-auto animate-slide-in-right">
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-xl font-bold">Profit & Loss</h2>
                <div className="flex gap-2 items-center">
                  <input
                    type="date"
                    value={plStartDate}
                    onChange={e => setPlStartDate(e.target.value)}
                    className="input py-2 w-40"
                  />
                  <input
                    type="date"
                    value={plEndDate}
                    onChange={e => setPlEndDate(e.target.value)}
                    className="input py-2 w-40"
                  />
                  <button
                    className="btn-primary flex items-center gap-2"
                    onClick={fetchProfitLoss}
                    disabled={isLoading}
                  >
                    <Download className="w-4 h-4" /> Load
                  </button>
                </div>
              </div>
              {error && <div className="text-center text-danger mb-4">{error}</div>}
              {isLoading ? (
                <div className="p-12 flex justify-center">
                  <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
                </div>
              ) : profitLossData ? (
                <div className="space-y-4 font-mono text-sm">
                  <div className="flex justify-between text-success">
                    <span>Gross Revenue</span>
                    <span>{toMoney(profitLossData.grossRevenue ?? profitLossData.revenue)}</span>
                  </div>
                  <div className="flex justify-between text-warning">
                    <span>Returns / Refunds</span>
                    <span>- {toMoney(profitLossData.refunds)}</span>
                  </div>
                  <div className="flex justify-between text-success">
                    <span>Net Revenue</span>
                    <span>{toMoney(profitLossData.revenue)}</span>
                  </div>
                  <div className="flex justify-between text-danger pb-4 border-b border-surface-4">
                    <span>Cost of Goods Sold (COGS)</span>
                    <span>- {toMoney(profitLossData.cogs)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-lg pt-2">
                    <span>Gross Profit</span>
                    <span>{toMoney(profitLossData.grossProfit)}</span>
                  </div>
                  <div className="pt-6 pb-2 text-text-secondary font-sans font-medium uppercase text-xs tracking-wider">
                    Operating Expenses
                  </div>
                  <div className="flex justify-between text-danger">
                    <span>Expenses</span>
                    <span>- {toMoney(profitLossData.expenses)}</span>
                  </div>
                  <div className="flex justify-between text-success pt-4 text-lg font-bold">
                    <span>NET PROFIT</span>
                    <span>{toMoney(profitLossData.netProfit)}</span>
                  </div>
                </div>
              ) : (
                <div className="text-center p-12 text-text-secondary">No data for selected period.</div>
              )}
            </div>
          )}

      </div>

      {voidSale && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg card border-danger/40 shadow-2xl animate-slide-up">
            <div className="p-5 border-b border-surface-4 flex items-start gap-3">
              <div className="h-10 w-10 rounded-xl bg-danger/10 text-danger flex items-center justify-center shrink-0">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-text-primary">Void Bill {voidSale.bill_number}</h2>
                <p className="text-sm text-text-secondary mt-1">
                  This cancels the bill, restores stock, reverses cash/khata, and keeps an audit record.
                </p>
              </div>
            </div>

            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-surface-3 rounded-xl p-4 border border-surface-4">
                  <p className="text-xs text-text-secondary uppercase font-bold">Total</p>
                  <p className="font-mono text-xl font-bold text-text-primary mt-1">{toMoney(voidSale.grand_total)}</p>
                </div>
                <div className="bg-surface-3 rounded-xl p-4 border border-surface-4">
                  <p className="text-xs text-text-secondary uppercase font-bold">Paid</p>
                  <p className="font-mono text-xl font-bold text-success mt-1">{toMoney(voidSale.amount_paid)}</p>
                </div>
              </div>

              <label className="block">
                <span className="text-sm font-semibold text-text-primary">Reason for void</span>
                <textarea
                  value={voidReason}
                  onChange={(event) => setVoidReason(event.target.value)}
                  className="input mt-2 min-h-28 resize-none"
                  placeholder="Example: Wrong quantity entered, duplicate bill, cashier mistake..."
                />
              </label>

              <button
                onClick={() => setVoidRestockItems((current) => !current)}
                className={cn(
                  "w-full rounded-xl border px-4 py-3 text-left font-bold transition-all",
                  voidRestockItems ? "border-success/40 bg-success/10 text-success" : "border-warning/40 bg-warning/10 text-warning"
                )}
              >
                {voidRestockItems ? "Restore sold items back into stock" : "Do not restore stock"}
              </button>
            </div>

            <div className="p-5 border-t border-surface-4 flex gap-3 justify-end">
              <button
                onClick={() => setVoidSale(null)}
                disabled={isVoiding}
                className="btn-secondary min-w-28"
              >
                Cancel
              </button>
              <button
                onClick={submitVoidSale}
                disabled={isVoiding}
                className="bg-danger hover:bg-danger/90 text-white font-bold rounded-lg px-5 py-3 min-w-36 transition-all active:scale-95 disabled:opacity-50"
              >
                {isVoiding ? "Voiding..." : "Confirm Void"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
