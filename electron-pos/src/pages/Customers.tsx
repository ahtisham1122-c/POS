import { useState, useEffect, useMemo } from "react";
import { Users, Search, Plus, BookOpen, Edit2, DollarSign, UserCheck, AlertTriangle } from "lucide-react";
import { cn } from "../lib/utils";

type Customer = {
  id: string;
  name: string;
  phone?: string;
  card_number?: string;
  current_balance: number;
  last_sale_date?: Date | string;
};

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "WITH_DUES" | "CLEAR">("ALL");

  const [isCollectModalOpen, setCollectModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [collectAmount, setCollectAmount] = useState("");

  const loadCustomers = async () => {
    try {
      const data = await window.electronAPI?.customers?.getAll();
      setCustomers(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  useEffect(() => {
    loadCustomers();
  }, []);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchSearch = `${c.name} ${c.phone} ${c.card_number}`.toLowerCase().includes(search.toLowerCase());
      const balance = Number(c.current_balance || 0);
      const matchFilter = 
        filter === "ALL" ? true :
        filter === "WITH_DUES" ? balance > 0 :
        balance <= 0;
      return matchSearch && matchFilter;
    });
  }, [customers, search, filter]);

  const totalOutstanding = useMemo(() => customers.reduce((sum, c) => sum + Math.max(0, Number(c.current_balance || 0)), 0), [customers]);
  const customersWithDues = useMemo(() => customers.filter(c => Number(c.current_balance || 0) > 0).length, [customers]);

  const handleCollect = async () => {
    if (!selectedCustomer || !collectAmount) return;
    try {
      await window.electronAPI?.customers?.collectPayment(selectedCustomer.id, {
        amount: Number(collectAmount),
        cashierId: "admin",
      });
      setCollectModalOpen(false);
      setCollectAmount("");
      setSelectedCustomer(null);
      loadCustomers();
    } catch (err) {
      alert("Payment collection failed");
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Customers & Khata</h1>
          <p className="text-text-secondary mt-1">Manage customer ledgers, due balances, and khata statements.</p>
        </div>
        <button className="btn-primary flex items-center gap-2 self-start sm:self-auto">
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Total Customers</p>
          <div className="flex items-center gap-3">
            <Users className="w-8 h-8 text-primary opacity-50" />
            <p className="text-2xl font-bold text-text-primary">{customers.length}</p>
          </div>
        </div>
        <div className="card p-5">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Total Outstanding</p>
          <div className="flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-danger opacity-50" />
            <p className="text-2xl font-bold text-danger font-mono">{toMoney(totalOutstanding)}</p>
          </div>
        </div>
        <div className="card p-5">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Customers with Dues</p>
          <div className="flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-warning opacity-50" />
            <p className="text-2xl font-bold text-warning">{customersWithDues}</p>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-4 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by name, phone, or card number..."
              className="input pl-10"
            />
          </div>
          <select value={filter} onChange={e => setFilter(e.target.value as any)} className="input md:w-48 appearance-none">
            <option value="ALL">All Customers</option>
            <option value="WITH_DUES">With Dues Only</option>
            <option value="CLEAR">Account Clear</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-wider font-semibold border-b border-surface-4">
              <tr>
                <th className="px-4 py-3">Card No</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Last Sale</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {filteredCustomers.map(c => {
                const owes = Number(c.current_balance || 0) > 0;
                return (
                  <tr key={c.id} className={cn("hover:bg-surface-3/50 transition-colors", owes && "border-l-[3px] border-l-danger")}>
                    <td className="px-4 py-4 font-mono text-text-secondary">{c.card_number || "—"}</td>
                    <td className="px-4 py-4 font-medium text-text-primary">{c.name}</td>
                    <td className="px-4 py-4 text-text-secondary">{c.phone || "—"}</td>
                    <td className="px-4 py-4">
                      {owes ? (
                        <span className="text-danger font-bold font-mono">{toMoney(c.current_balance)} Due</span>
                      ) : (
                        <span className="text-success flex items-center gap-1 font-medium"><UserCheck className="w-4 h-4" /> Clear</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-text-secondary text-xs">
                      {c.last_sale_date ? new Date(c.last_sale_date).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-4 text-right space-x-2">
                      <button 
                        onClick={() => { setSelectedCustomer(c); setCollectModalOpen(true); }}
                        className="p-2 text-success hover:bg-success/10 rounded-md transition-colors font-medium border border-transparent hover:border-success/30 inline-flex items-center gap-1"
                        disabled={!owes}
                      >
                        <DollarSign className="w-4 h-4" /> Collect
                      </button>
                      <button className="p-2 text-primary hover:bg-primary/10 rounded-md transition-colors font-medium border border-transparent hover:border-primary/30 inline-flex items-center gap-1">
                        <BookOpen className="w-4 h-4" /> Khata
                      </button>
                      <button className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface-3 rounded-md transition-colors border border-transparent">
                        <Edit2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">
                    <Users className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No customers found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isCollectModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-sm overflow-hidden flex flex-col border border-surface-4">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center">
              <h3 className="font-semibold text-lg">Collect Payment</h3>
              <button onClick={() => setCollectModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-center mb-6">
                <p className="text-sm text-text-secondary">{selectedCustomer.name}</p>
                <p className="text-3xl font-mono font-bold text-danger mt-1">{toMoney(selectedCustomer.current_balance)}</p>
                <p className="text-xs text-text-secondary uppercase tracking-wider mt-1">Current Due</p>
              </div>
              
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Amount Paid (Rs)</label>
                <input
                  type="number"
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  className="input font-mono text-2xl py-4 text-center text-success"
                  placeholder="0"
                  autoFocus
                />
              </div>

              {collectAmount && Number(collectAmount) > 0 && (
                <div className="bg-success/10 border border-success/30 rounded-lg p-3 text-center">
                  <p className="text-xs text-text-secondary">New Balance Will Be</p>
                  <p className="font-mono font-bold text-success">
                    {toMoney(Math.max(0, selectedCustomer.current_balance - Number(collectAmount)))}
                  </p>
                </div>
              )}
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setCollectModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleCollect} className="btn-primary flex-1" disabled={!collectAmount || Number(collectAmount) <= 0}>Confirm Collection</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
