import { useState, useEffect, useMemo, useRef } from "react";
import { Users, Search, Plus, BookOpen, Edit2, DollarSign, UserCheck, AlertTriangle, Printer, FileText, Download } from "lucide-react";
import { cn } from "../lib/utils";
import { format } from "date-fns";

type Customer = {
  id: string;
  name: string;
  phone?: string;
  card_number?: string;
  address?: string;
  credit_limit?: number;
  current_balance: number;
  last_sale_date?: string;
};

type LedgerEntry = {
  id: string;
  entry_date: string;
  entry_type: 'SALE' | 'SALE_CREDIT' | 'PAYMENT' | 'PAYMENT_RECEIVED' | 'ADJUSTMENT';
  description: string;
  amount: number;
  balance_after: number;
  reference_id?: string;
};

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function Khata() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  
  // Modals
  const [isCollectModalOpen, setCollectModalOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [collectAmount, setCollectAmount] = useState("");
  
  const [isLedgerModalOpen, setLedgerModalOpen] = useState(false);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  
  const [isNewCustomerModalOpen, setNewCustomerModalOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: "", phone: "", address: "", card_number: "", opening_balance: "0" });
  const [shopInfo, setShopInfo] = useState<any>({});
  const [ledgerStartDate, setLedgerStartDate] = useState(() => {
    const d = new Date();
    d.setDate(1);
    return d.toISOString().split('T')[0];
  });
  const [ledgerEndDate, setLedgerEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [openingBalance, setOpeningBalance] = useState(0);

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
    const loadSettings = async () => {
      try {
        const settings = await window.electronAPI?.settings?.getAll();
        const info: any = {};
        settings?.forEach((s: any) => info[s.key] = s.value);
        setShopInfo(info);
      } catch (e) {
        console.error("Failed to load shop settings", e);
      }
    };
    loadSettings();
  }, []);

  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      const matchSearch = `${c.name} ${c.phone} ${c.card_number}`.toLowerCase().includes(search.toLowerCase());
      return matchSearch;
    });
  }, [customers, search]);

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
  
  const openLedger = async (customer: Customer, start = ledgerStartDate, end = ledgerEndDate) => {
    setSelectedCustomer(customer);
    try {
      const stmts = await window.electronAPI?.customers?.getStatement(customer.id, start, end) as
        | { ledger?: LedgerEntry[]; openingBalance?: number }
        | undefined;
      if (stmts) {
        setLedgerEntries(stmts.ledger || []);
        setOpeningBalance(stmts.openingBalance || 0);
        setLedgerModalOpen(true);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to load ledger");
    }
  };

  const handleExportLedger = () => {
    if (!selectedCustomer) return;
    const csvRows = [
      `Statement for ${selectedCustomer.name}`,
      `Period: ${ledgerStartDate} to ${ledgerEndDate}`,
      "",
      "Date,Type,Description,Debit,Credit,Balance"
    ];
    
    csvRows.push(`${ledgerStartDate},OPENING,Opening Balance,,,${openingBalance}`);
    
    ledgerEntries.forEach(entry => {
      const isSale = entry.entry_type === 'SALE' || entry.entry_type === 'SALE_CREDIT' || entry.entry_type === 'ADJUSTMENT';
      const isPayment = entry.entry_type === 'PAYMENT' || entry.entry_type === 'PAYMENT_RECEIVED';
      const debit = isSale ? entry.amount : "";
      const credit = isPayment ? entry.amount : "";
      csvRows.push(`${format(new Date(entry.entry_date), "yyyy-MM-dd")},${entry.entry_type},${entry.description},${debit},${credit},${entry.balance_after}`);
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `khata_${selectedCustomer.name}_${ledgerStartDate}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleSaveCustomer = async () => {
    if (!newCustomer.name) {
      alert("Name is required");
      return;
    }
    try {
      await window.electronAPI?.customers?.create({
        name: newCustomer.name,
        phone: newCustomer.phone,
        address: newCustomer.address,
        cardNumber: newCustomer.card_number || `C-${Math.floor(Math.random()*10000)}`,
        openingBalance: Number(newCustomer.opening_balance) || 0,
        creditLimit: 50000
      });
      setNewCustomerModalOpen(false);
      setNewCustomer({ name: "", phone: "", address: "", card_number: "", opening_balance: "0" });
      loadCustomers();
    } catch (err) {
      alert("Failed to create customer");
    }
  };

  const exportKhata = async (formatType: "excel" | "pdf") => {
    const result = await window.electronAPI?.reports?.exportReport({
      type: "khata-ledger",
      format: formatType,
      params: { customerId: selectedCustomer?.id, startDate: ledgerStartDate, endDate: ledgerEndDate }
    });
    if (!result?.success && result?.reason !== "canceled") alert(result?.error || "Export failed");
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Khata Ledger</h1>
          <p className="text-text-secondary mt-1">Manage credit customers and track payments</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <button onClick={() => exportKhata("excel")} className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" /> Excel
          </button>
          <button onClick={() => exportKhata("pdf")} className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" /> PDF
          </button>
          <button onClick={() => setNewCustomerModalOpen(true)} className="btn-primary flex items-center gap-2 shadow-glow">
            <Plus className="w-4 h-4" /> New Customer
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="card p-5 border-l-4 border-l-info">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Khata Accounts</p>
          <div className="flex items-center gap-3">
            <BookOpen className="w-8 h-8 text-info opacity-50" />
            <p className="text-2xl font-bold text-text-primary">{customers.length}</p>
          </div>
        </div>
        <div className="card p-5 border-l-4 border-l-danger">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Total Outstanding</p>
          <div className="flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-danger opacity-50" />
            <p className="text-2xl font-bold text-danger font-mono">{toMoney(totalOutstanding)}</p>
          </div>
        </div>
        <div className="card p-5 border-l-4 border-l-success">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Collected Today</p>
          <div className="flex items-center gap-3">
            <FileText className="w-8 h-8 text-success opacity-50" />
            <p className="text-2xl font-bold text-success font-mono">Rs. 0</p>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-surface-4 flex gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search by Card No, Name, or Phone..."
              className="input pl-10"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm whitespace-nowrap">
            <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-wider font-semibold border-b border-surface-4">
              <tr>
                <th className="px-4 py-3">Card No</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Phone</th>
                <th className="px-4 py-3 text-right">Balance</th>
                <th className="px-4 py-3">Last Sale</th>
                <th className="px-4 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-4">
              {filteredCustomers.map(c => {
                const owes = Number(c.current_balance || 0) > 0;
                return (
                  <tr key={c.id} className={cn("hover:bg-surface-3/50 transition-colors", owes && "border-l-[3px] border-l-danger")}>
                    <td className="px-4 py-4 font-mono text-text-secondary font-bold">{c.card_number || "—"}</td>
                    <td className={cn("px-4 py-4 font-bold", owes ? "text-danger" : "text-text-primary")}>{c.name}</td>
                    <td className="px-4 py-4 text-text-secondary">{c.phone || "—"}</td>
                    <td className="px-4 py-4 text-right">
                      {owes ? (
                        <span className="text-danger font-bold font-mono text-lg">{toMoney(c.current_balance)}</span>
                      ) : (
                        <span className="text-success flex items-center justify-end gap-1 font-bold"><UserCheck className="w-4 h-4" /> Clear</span>
                      )}
                    </td>
                    <td className="px-4 py-4 text-text-secondary text-xs">
                      {c.last_sale_date ? new Date(c.last_sale_date).toLocaleDateString() : "Never"}
                    </td>
                    <td className="px-4 py-4 text-right space-x-2">
                      <button 
                        onClick={() => { setSelectedCustomer(c); setCollectModalOpen(true); }}
                        className={cn("px-3 py-1.5 rounded text-xs font-bold transition-colors", owes ? "bg-success hover:bg-success/90 text-white shadow" : "bg-surface-3 text-text-secondary cursor-not-allowed")}
                        disabled={!owes}
                      >
                        💰 Collect
                      </button>
                      <button 
                        onClick={() => openLedger(c)}
                        className="px-3 py-1.5 bg-info/10 text-info hover:bg-info/20 rounded text-xs font-bold transition-colors border border-info/30"
                      >
                        📖 Ledger
                      </button>
                      <button className="px-3 py-1.5 bg-surface-3 text-text-secondary hover:text-text-primary hover:bg-surface-4 rounded text-xs font-bold transition-colors border border-surface-4">
                        ✏️ Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
              {filteredCustomers.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">
                    <BookOpen className="w-12 h-12 mx-auto mb-2 opacity-50" />
                    <p>No khata customers found</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* COLLECT MODAL */}
      {isCollectModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-sm overflow-hidden flex flex-col border border-surface-4">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center bg-surface-3">
              <h3 className="font-semibold text-lg flex items-center gap-2"><DollarSign className="w-5 h-5 text-success" /> Collect Payment</h3>
              <button onClick={() => setCollectModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <div className="text-center mb-6">
                <p className="text-sm font-bold text-text-primary">{selectedCustomer.name} [{selectedCustomer.card_number}]</p>
                <p className="text-4xl font-mono font-black text-danger mt-2 drop-shadow-md">{toMoney(selectedCustomer.current_balance)}</p>
                <p className="text-xs text-text-secondary uppercase tracking-wider mt-2 font-bold">Current Due</p>
              </div>
              
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-2 block">Payment Amount (Rs)</label>
                <input
                  type="number"
                  value={collectAmount}
                  onChange={(e) => setCollectAmount(e.target.value)}
                  className="w-full bg-surface-1 border-2 border-surface-4 rounded-lg font-mono text-3xl py-4 text-center text-success outline-none focus:border-success transition-colors"
                  placeholder="0"
                  autoFocus
                />
              </div>

              {collectAmount && Number(collectAmount) > 0 && (
                <div className="bg-surface-3 border border-surface-4 rounded-lg p-4 text-center animate-slide-up">
                  <p className="text-sm text-text-secondary font-medium">Balance after this payment:</p>
                  <p className="font-mono font-bold text-xl text-text-primary mt-1">
                    {toMoney(Math.max(0, selectedCustomer.current_balance - Number(collectAmount)))}
                  </p>
                </div>
              )}
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setCollectModalOpen(false)} className="btn-secondary flex-1 h-12 font-bold">Cancel</button>
              <button onClick={handleCollect} className="btn-primary flex-1 h-12 font-bold text-lg bg-success hover:bg-success/90 shadow-glow" disabled={!collectAmount || Number(collectAmount) <= 0}>Confirm ✓</button>
            </div>
          </div>
        </div>
      )}

      {/* LEDGER MODAL */}
      {isLedgerModalOpen && selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-1 rounded-xl shadow-float w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col border border-surface-4 relative">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center bg-surface-2 shrink-0">
               <div>
                 <h3 className="font-bold text-lg text-white">Khata Ledger: {selectedCustomer.name}</h3>
                 <p className="text-xs text-text-secondary font-mono">{selectedCustomer.card_number} • {selectedCustomer.phone}</p>
               </div>
               <div className="flex gap-2">
                 <button onClick={handleExportLedger} className="btn-secondary flex items-center gap-2"><FileText className="w-4 h-4"/> CSV</button>
                 <button onClick={() => window.print()} className="btn-secondary flex items-center gap-2"><Printer className="w-4 h-4"/> Print</button>
                 <button onClick={() => setLedgerModalOpen(false)} className="w-10 h-10 flex items-center justify-center rounded bg-surface-3 hover:bg-surface-4 border border-surface-4">✕</button>
               </div>
            </div>

            <div className="p-4 bg-surface-2 flex flex-wrap gap-4 items-center shrink-0 border-b border-surface-4">
              <div className="flex gap-2 items-center">
                <label className="text-xs font-bold text-text-secondary uppercase">From:</label>
                <input type="date" value={ledgerStartDate} onChange={e => { setLedgerStartDate(e.target.value); openLedger(selectedCustomer, e.target.value, ledgerEndDate); }} className="input py-1.5 text-xs w-36" />
              </div>
              <div className="flex gap-2 items-center">
                <label className="text-xs font-bold text-text-secondary uppercase">To:</label>
                <input type="date" value={ledgerEndDate} onChange={e => { setLedgerEndDate(e.target.value); openLedger(selectedCustomer, ledgerStartDate, e.target.value); }} className="input py-1.5 text-xs w-36" />
              </div>
              <div className="flex-1"></div>
              <div className="text-right">
                <div className="text-[10px] text-text-secondary uppercase font-bold">Current Balance</div>
                <div className={cn("text-xl font-black font-mono", Number(selectedCustomer.current_balance) > 0 ? "text-danger" : "text-success")}>
                  {toMoney(selectedCustomer.current_balance)}
                </div>
              </div>
            </div>
            
            <div className="flex-1 overflow-auto p-4 print-statement bg-white md:bg-surface-1">
              {/* PRINT HEADER */}
              <div className="hidden print:block mb-8 text-black border-b-2 border-black pb-4">
                <div className="flex justify-between items-start">
                  <div>
          <h1 className="text-3xl font-black uppercase tracking-tighter">{shopInfo.shopName || "GUJJAR MILK SHOP"}</h1>
                    <p className="text-sm">{shopInfo.shopAddress || "Main Branch"}</p>
                    <p className="text-sm">Phone: {shopInfo.shopPhone || "0300-1234567"}</p>
                  </div>
                  <div className="text-right">
                    <h2 className="text-xl font-bold uppercase">Customer Statement</h2>
                    <p className="text-sm">Period: {format(new Date(ledgerStartDate), "dd-MMM-yy")} to {format(new Date(ledgerEndDate), "dd-MMM-yy")}</p>
                    <p className="text-sm font-mono">Date: {format(new Date(), "dd-MMM-yy hh:mm a")}</p>
                  </div>
                </div>
                <div className="mt-6 grid grid-cols-2 gap-4">
                  <div className="bg-gray-100 p-3 rounded">
                    <p className="text-[10px] uppercase font-bold text-gray-500">Customer Info</p>
                    <p className="font-bold text-lg">{selectedCustomer.name}</p>
                    <p className="text-sm">ID: {selectedCustomer.card_number}</p>
                    <p className="text-sm">Phone: {selectedCustomer.phone}</p>
                  </div>
                  <div className="bg-gray-100 p-3 rounded text-right">
                    <p className="text-[10px] uppercase font-bold text-gray-500">Account Summary</p>
                    <div className="flex justify-between text-sm mt-1"><span>Opening Balance:</span> <b>{toMoney(openingBalance)}</b></div>
                    <div className="flex justify-between text-sm"><span>Total Debits:</span> <b>{toMoney(ledgerEntries.filter(e => e.entry_type === 'SALE' || e.entry_type === 'SALE_CREDIT' || (e.entry_type === 'ADJUSTMENT' && e.amount > 0)).reduce((s, e) => s + e.amount, 0))}</b></div>
                    <div className="flex justify-between text-sm"><span>Total Credits:</span> <b>{toMoney(ledgerEntries.filter(e => e.entry_type === 'PAYMENT' || e.entry_type === 'PAYMENT_RECEIVED' || (e.entry_type === 'ADJUSTMENT' && e.amount < 0)).reduce((s, e) => s + e.amount, 0))}</b></div>
                    <div className="flex justify-between text-lg font-bold border-t border-gray-300 mt-1 pt-1"><span>Closing Balance:</span> <b>{toMoney(selectedCustomer.current_balance)}</b></div>
                  </div>
                </div>
              </div>

              <table className="w-full text-left text-sm print:text-black">
                <thead className="bg-surface-3 print:bg-gray-200 text-text-secondary print:text-gray-700 uppercase text-xs font-bold">
                  <tr>
                    <th className="p-3">Date</th>
                    <th className="p-3">Description</th>
                    <th className="p-3 text-right">Debit</th>
                    <th className="p-3 text-right">Credit</th>
                    <th className="p-3 text-right">Balance</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-4 print:divide-gray-300">
                   <tr className="bg-surface-3/30 italic print:bg-gray-50">
                     <td className="p-3 font-mono text-xs">{ledgerStartDate}</td>
                     <td className="p-3 font-bold">Opening Balance</td>
                     <td className="p-3 text-right">-</td>
                     <td className="p-3 text-right">-</td>
                     <td className="p-3 text-right font-mono font-bold">{openingBalance.toFixed(0)}</td>
                   </tr>
                   {ledgerEntries.map(entry => {
                     const isDebit = entry.entry_type === 'SALE' || entry.entry_type === 'SALE_CREDIT' || (entry.entry_type === 'ADJUSTMENT' && entry.amount > 0);
                     const isCredit = entry.entry_type === 'PAYMENT' || entry.entry_type === 'PAYMENT_RECEIVED' || (entry.entry_type === 'ADJUSTMENT' && entry.amount < 0);
                     return (
                       <tr key={entry.id} className="hover:bg-surface-2/50 transition-colors">
                         <td className="p-3 font-mono text-text-secondary print:text-gray-600 text-xs">{format(new Date(entry.entry_date), "dd-MMM-yy hh:mm a")}</td>
                         <td className="p-3">
                           <div className="font-medium">{entry.description}</div>
                           <div className="text-[10px] uppercase opacity-50 font-bold">{entry.entry_type}</div>
                         </td>
                         <td className="p-3 text-right font-mono text-danger print:text-red-600">{isDebit ? Math.abs(entry.amount).toFixed(0) : "-"}</td>
                         <td className="p-3 text-right font-mono text-success print:text-green-600">{isCredit ? Math.abs(entry.amount).toFixed(0) : "-"}</td>
                         <td className="p-3 text-right font-mono font-bold">{entry.balance_after.toFixed(0)}</td>
                       </tr>
                     );
                   })}
                   {ledgerEntries.length === 0 && (
                     <tr><td colSpan={5} className="text-center p-8 text-text-secondary print:text-gray-500">No transactions in this period.</td></tr>
                   )}
                </tbody>
              </table>
              <div className="hidden print:block mt-20">
                <div className="flex justify-between px-10">
                  <div className="border-t border-black w-48 text-center pt-2 text-xs font-bold uppercase">Customer Signature</div>
                  <div className="border-t border-black w-48 text-center pt-2 text-xs font-bold uppercase">Authorized Signatory</div>
                </div>
        <p className="text-[8px] text-center mt-10 text-gray-400">Gujjar Milk Shop POS</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* NEW CUSTOMER MODAL */}
      {isNewCustomerModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
           <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-md overflow-hidden flex flex-col border border-surface-4">
             <div className="p-4 border-b border-surface-4 flex justify-between items-center bg-surface-3">
                <h3 className="font-semibold text-lg flex items-center gap-2"><Plus className="w-5 h-5 text-primary" /> New Khata Account</h3>
                <button onClick={() => setNewCustomerModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
             </div>
             <div className="p-6 space-y-4">
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Full Name *</label>
                  <input autoFocus type="text" className="input" value={newCustomer.name} onChange={e => setNewCustomer({...newCustomer, name: e.target.value})} placeholder="Ali Ahmed" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Card Number</label>
                    <input type="text" className="input" value={newCustomer.card_number} onChange={e => setNewCustomer({...newCustomer, card_number: e.target.value})} placeholder="Auto-generated" />
                  </div>
                  <div>
                    <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Phone</label>
                    <input type="text" className="input" value={newCustomer.phone} onChange={e => setNewCustomer({...newCustomer, phone: e.target.value})} placeholder="0300..." />
                  </div>
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Address</label>
                  <input type="text" className="input" value={newCustomer.address} onChange={e => setNewCustomer({...newCustomer, address: e.target.value})} placeholder="House / Street" />
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Opening Balance (Rs)</label>
                  <input type="number" className="input font-mono bg-surface-1 border-danger/30 text-danger" value={newCustomer.opening_balance} onChange={e => setNewCustomer({...newCustomer, opening_balance: e.target.value})} placeholder="0" />
                  <p className="text-[10px] text-text-secondary mt-1">If customer already owes money from previous system</p>
                </div>
             </div>
             <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
               <button onClick={() => setNewCustomerModalOpen(false)} className="btn-secondary flex-1 h-12 font-bold">Cancel</button>
               <button onClick={handleSaveCustomer} className="btn-primary flex-1 h-12 font-bold" disabled={!newCustomer.name}>Save Account ✓</button>
             </div>
           </div>
        </div>
      )}
    </div>
  );
}
