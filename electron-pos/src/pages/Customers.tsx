import { useState, useEffect, useMemo } from "react";
import { Users, Search, Plus, BookOpen, Edit2, DollarSign, UserCheck, AlertTriangle, Trash2 } from "lucide-react";
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

const emptyForm = { name: "", phone: "", card_number: "", opening_balance: "0" };

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"ALL" | "WITH_DUES" | "CLEAR">("ALL");

  const [isCollectModalOpen, setCollectModalOpen] = useState(false);
  const [isAddModalOpen, setAddModalOpen] = useState(false);
  const [isEditModalOpen, setEditModalOpen] = useState(false);
  const [isKhataModalOpen, setKhataModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [collectAmount, setCollectAmount] = useState("");
  const [addForm, setAddForm] = useState(emptyForm);
  const [editForm, setEditForm] = useState(emptyForm);
  const [ledger, setLedger] = useState<any[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [deletePin, setDeletePin] = useState("");
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

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
      const result = await window.electronAPI?.customers?.collectPayment(selectedCustomer.id, {
        amount: Number(collectAmount),
      });
      if (result?.success === false) {
        alert(result?.error || "Payment collection failed");
        return;
      }
      setCollectModalOpen(false);
      setCollectAmount("");
      setSelectedCustomer(null);
      loadCustomers();
    } catch (err) {
      alert("Payment collection failed");
    }
  };

  const handleAddCustomer = async () => {
    if (!addForm.name.trim()) { alert("Customer name is required"); return; }
    setIsSaving(true);
    try {
      const result = await window.electronAPI?.customers?.create({
        name: addForm.name.trim(),
        phone: addForm.phone.trim() || undefined,
        cardNumber: addForm.card_number.trim() || undefined,
        openingBalance: Number(addForm.opening_balance) || 0,
      });
      if (result?.success === false) {
        alert(result?.error || "Failed to add customer");
        return;
      }
      setAddModalOpen(false);
      setAddForm(emptyForm);
      loadCustomers();
    } catch (err) {
      alert("Failed to add customer");
    } finally {
      setIsSaving(false);
    }
  };

  const openEdit = (c: Customer) => {
    setSelectedCustomer(c);
    setEditForm({ name: c.name, phone: c.phone || "", card_number: c.card_number || "", opening_balance: "0" });
    setShowDeleteConfirm(false);
    setDeletePin("");
    setEditModalOpen(true);
  };

  const handleDeleteCustomer = async () => {
    if (!selectedCustomer) return;
    if (!deletePin) { alert("Manager PIN is required to delete a customer."); return; }
    setIsSaving(true);
    try {
      const result = await window.electronAPI?.customers?.remove(selectedCustomer.id, { managerPin: deletePin });
      if (result?.success === false) {
        alert(result?.error || "Failed to delete customer");
        return;
      }
      setEditModalOpen(false);
      setShowDeleteConfirm(false);
      setDeletePin("");
      setSelectedCustomer(null);
      loadCustomers();
    } catch (err: any) {
      alert(err?.message || "Failed to delete customer");
    } finally {
      setIsSaving(false);
    }
  };

  const handleUpdateCustomer = async () => {
    if (!selectedCustomer || !editForm.name.trim()) { alert("Customer name is required"); return; }
    setIsSaving(true);
    try {
      const result = await window.electronAPI?.customers?.update(selectedCustomer.id, {
        name: editForm.name.trim(),
        phone: editForm.phone.trim() || undefined,
        cardNumber: editForm.card_number.trim() || undefined,
      });
      if (result?.success === false) {
        alert(result?.error || "Failed to update customer");
        return;
      }
      setEditModalOpen(false);
      setSelectedCustomer(null);
      loadCustomers();
    } catch (err) {
      alert("Failed to update customer");
    } finally {
      setIsSaving(false);
    }
  };

  const openKhata = async (c: Customer) => {
    setSelectedCustomer(c);
    setLedger([]);
    setKhataModalOpen(true);
    try {
      const data = await window.electronAPI?.customers?.getLedger(c.id);
      setLedger(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Customers & Khata</h1>
          <p className="text-text-secondary mt-1">Manage customer ledgers, due balances, and khata statements.</p>
        </div>
        <button onClick={() => { setAddForm(emptyForm); setAddModalOpen(true); }} className="btn-primary flex items-center gap-2 self-start sm:self-auto">
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </div>

      {/* KPI CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5 relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-primary/5"></div>
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Users className="w-5 h-5 text-primary" />
              </div>
              <p className="text-xs text-text-secondary font-bold uppercase tracking-wider">Total Customers</p>
            </div>
            <p className="text-3xl font-bold text-text-primary">{customers.length}</p>
          </div>
        </div>
        <div className="card p-5 relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-danger/5"></div>
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center">
                <DollarSign className="w-5 h-5 text-danger" />
              </div>
              <p className="text-xs text-text-secondary font-bold uppercase tracking-wider">Total Outstanding</p>
            </div>
            <p className="text-3xl font-bold text-danger font-mono">{toMoney(totalOutstanding)}</p>
          </div>
        </div>
        <div className="card p-5 relative overflow-hidden">
          <div className="absolute -right-4 -top-4 w-24 h-24 rounded-full bg-warning/5"></div>
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-10 h-10 rounded-xl bg-warning/10 flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-warning" />
              </div>
              <p className="text-xs text-text-secondary font-bold uppercase tracking-wider">With Dues</p>
            </div>
            <p className="text-3xl font-bold text-warning">{customersWithDues}</p>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        {/* Search + Filter Chips */}
        <div className="p-4 border-b border-surface-4 bg-surface-2/50">
          <div className="flex flex-col md:flex-row gap-3">
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
            <div className="flex gap-2">
              {(["ALL", "WITH_DUES", "CLEAR"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-3 py-2 rounded-lg text-xs font-bold border transition-all",
                    filter === f
                      ? f === "WITH_DUES" ? "bg-danger/10 border-danger/30 text-danger" : f === "CLEAR" ? "bg-success/10 border-success/30 text-success" : "bg-primary/10 border-primary/30 text-primary"
                      : "border-surface-4 text-text-secondary hover:bg-surface-3"
                  )}
                >
                  {f === "ALL" ? "All" : f === "WITH_DUES" ? `Dues (${customersWithDues})` : "Clear"}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-wider font-semibold border-b border-surface-4">
              <tr>
                <th className="px-4 py-3">Customer</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3">Card</th>
                <th className="px-4 py-3">Balance</th>
                <th className="px-4 py-3">Last Sale</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {filteredCustomers.map(c => {
                const owes = Number(c.current_balance || 0) > 0;
                const initials = c.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
                return (
                  <tr key={c.id} className={cn("hover:bg-surface-3/50 transition-colors group", owes && "border-l-[3px] border-l-danger")}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                          owes ? "bg-danger/10 text-danger" : "bg-primary/10 text-primary"
                        )}>
                          {initials}
                        </div>
                        <span className="font-semibold text-text-primary">{c.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-text-secondary font-mono text-xs">{c.phone || "—"}</td>
                    <td className="px-4 py-3 font-mono text-text-secondary text-xs">{c.card_number || "—"}</td>
                    <td className="px-4 py-3">
                      {owes ? (
                        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-danger/10 text-danger text-xs font-bold font-mono">
                          {toMoney(c.current_balance)}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-success/10 text-success text-xs font-bold">
                          <UserCheck className="w-3.5 h-3.5" /> Clear
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-text-secondary text-xs">
                      {c.last_sale_date ? new Date(c.last_sale_date).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1 opacity-70 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => { setSelectedCustomer(c); setCollectModalOpen(true); }}
                          className={cn("p-2 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-bold", owes ? "text-success hover:bg-success/10" : "text-text-secondary/40 cursor-not-allowed")}
                          disabled={!owes}
                        >
                          <DollarSign className="w-4 h-4" /> Collect
                        </button>
                        <button onClick={() => openKhata(c)} className="p-2 text-primary hover:bg-primary/10 rounded-lg transition-colors inline-flex items-center gap-1 text-xs font-bold">
                          <BookOpen className="w-4 h-4" /> Khata
                        </button>
                        <button onClick={() => openEdit(c)} className="p-2 text-text-secondary hover:text-text-primary hover:bg-surface-3 rounded-lg transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-text-secondary">
                    <Users className="w-14 h-14 mx-auto mb-3 opacity-20" />
                    <p className="font-bold text-text-primary">No customers found</p>
                    <p className="text-sm mt-1">Try adjusting your search or filters.</p>
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

      {/* ADD CUSTOMER MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-sm overflow-hidden flex flex-col border border-surface-4">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center">
              <h3 className="font-semibold text-lg flex items-center gap-2"><Plus className="w-4 h-4" /> New Customer</h3>
              <button onClick={() => setAddModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Full Name *</label>
                <input type="text" value={addForm.name} onChange={e => setAddForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="Customer name" autoFocus />
              </div>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Phone</label>
                <input type="text" value={addForm.phone} onChange={e => setAddForm(f => ({ ...f, phone: e.target.value }))} className="input" placeholder="03XX-XXXXXXX" />
              </div>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Card / Account No</label>
                <input type="text" value={addForm.card_number} onChange={e => setAddForm(f => ({ ...f, card_number: e.target.value }))} className="input" placeholder="Optional" />
              </div>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Opening Balance (Rs) — if they already owe</label>
                <input type="number" value={addForm.opening_balance} onChange={e => setAddForm(f => ({ ...f, opening_balance: e.target.value }))} className="input font-mono" placeholder="0" min="0" />
              </div>
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setAddModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleAddCustomer} disabled={isSaving || !addForm.name.trim()} className="btn-primary flex-1">
                {isSaving ? "Saving…" : "Add Customer"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* EDIT CUSTOMER MODAL */}
      {isEditModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-sm overflow-hidden flex flex-col border border-surface-4">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center">
              <h3 className="font-semibold text-lg flex items-center gap-2"><Edit2 className="w-4 h-4" /> Edit Customer</h3>
              <button onClick={() => setEditModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {Number(selectedCustomer.current_balance) > 0 && (
                <div className="bg-danger/10 border border-danger/30 rounded-lg p-3 flex items-center gap-2 text-sm text-danger">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>Outstanding balance: <strong>{toMoney(selectedCustomer.current_balance)}</strong>. Collect payment before removing this customer.</span>
                </div>
              )}
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Full Name *</label>
                <input type="text" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} className="input" autoFocus />
              </div>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Phone</label>
                <input type="text" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} className="input" placeholder="03XX-XXXXXXX" />
              </div>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Card / Account No</label>
                <input type="text" value={editForm.card_number} onChange={e => setEditForm(f => ({ ...f, card_number: e.target.value }))} className="input" placeholder="Optional" />
              </div>

              {/* Delete section — only for customers with zero balance */}
              {Number(selectedCustomer.current_balance) <= 0 && (
                <div className="border-t border-surface-4 pt-4">
                  {!showDeleteConfirm ? (
                    <button
                      onClick={() => setShowDeleteConfirm(true)}
                      className="text-xs text-danger hover:bg-danger/10 px-3 py-2 rounded-md transition-colors w-full text-left flex items-center gap-2"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Remove this customer…
                    </button>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-danger font-semibold">Enter manager PIN to confirm removal:</p>
                      <input
                        type="password"
                        inputMode="numeric"
                        value={deletePin}
                        onChange={e => setDeletePin(e.target.value)}
                        className="input font-mono text-center tracking-widest"
                        placeholder="Manager PIN"
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button onClick={() => { setShowDeleteConfirm(false); setDeletePin(""); }} className="btn-secondary flex-1 text-xs">Cancel</button>
                        <button onClick={handleDeleteCustomer} disabled={!deletePin || isSaving} className="flex-1 text-xs bg-danger hover:bg-danger/80 text-white font-semibold py-2 px-3 rounded-lg transition-colors disabled:opacity-40">
                          {isSaving ? "Removing…" : "Confirm Remove"}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setEditModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleUpdateCustomer} disabled={isSaving || !editForm.name.trim()} className="btn-primary flex-1">
                {isSaving ? "Saving…" : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* KHATA / LEDGER MODAL */}
      {isKhataModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-2xl overflow-hidden flex flex-col border border-surface-4 max-h-[85vh]">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-lg flex items-center gap-2"><BookOpen className="w-4 h-4" /> {selectedCustomer.name}'s Khata</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Current due: <span className={cn("font-mono font-bold", Number(selectedCustomer.current_balance) > 0 ? "text-danger" : "text-success")}>{toMoney(selectedCustomer.current_balance)}</span>
                </p>
              </div>
              <button onClick={() => setKhataModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-surface-3 border-b border-surface-4 text-[10px] text-text-secondary uppercase tracking-wider sticky top-0">
                  <tr>
                    <th className="px-4 py-2 text-left">Date</th>
                    <th className="px-4 py-2 text-left">Type</th>
                    <th className="px-4 py-2 text-left">Description</th>
                    <th className="px-4 py-2 text-right">Amount</th>
                    <th className="px-4 py-2 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-4">
                  {ledger.map((entry: any, i: number) => (
                    <tr key={entry.id || i} className="hover:bg-surface-3/50">
                      <td className="px-4 py-2 font-mono text-xs text-text-secondary">{new Date(entry.created_at).toLocaleDateString()}</td>
                      <td className="px-4 py-2">
                        <span className={cn("text-xs font-bold px-2 py-0.5 rounded", entry.type === "DEBIT" ? "bg-danger/15 text-danger" : "bg-success/15 text-success")}>
                          {entry.type === "DEBIT" ? "Sale" : "Payment"}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-text-secondary text-xs">{entry.description || "—"}</td>
                      <td className={cn("px-4 py-2 text-right font-mono font-bold", entry.type === "DEBIT" ? "text-danger" : "text-success")}>
                        {entry.type === "DEBIT" ? "+" : "-"}{toMoney(entry.amount)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono">{toMoney(entry.running_balance ?? 0)}</td>
                    </tr>
                  ))}
                  {ledger.length === 0 && (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-text-secondary">No ledger entries found.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex justify-end">
              <button onClick={() => setKhataModalOpen(false)} className="btn-secondary">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
