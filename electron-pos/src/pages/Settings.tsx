import { useState, useEffect } from "react";
import { Store, Tag, Users, RefreshCw, Database, Save, CheckCircle2, Monitor, ShieldCheck, Printer } from "lucide-react";
import { cn } from "../lib/utils";

type SettingsTab = "SHOP" | "POS" | "RATES" | "USERS" | "AUDIT" | "SYNC" | "BACKUP";

type PosConfigState = {
  autoPrint: string;
  receiptDelay: string;
  defaultPayment: string;
  printerType: string;
  printerName: string;
  paperWidth: string;
  lowStockThreshold: string;
  maxHeldBills: string;
  showChangeCalc: string;
  saleSound: string;
  cashierPinReq: string;
  taxEnabled: string;
  taxRate: string;
  taxLabel: string;
  shopDayStartHour: string;
  ramadan24Hour: string;
  "24_hour_mode"?: string;
  APP_API_URL?: string;
  SYNC_DEVICE_SECRET?: string;
};

export default function Settings() {
  const [activeTab, setActiveTab] = useState<SettingsTab>("RATES");
  const [milkRate, setMilkRate] = useState("220");
  const [yogurtRate, setYogurtRate] = useState("180");
  const [users, setUsers] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [printers, setPrinters] = useState<Array<{ name: string; displayName: string; isDefault?: boolean }>>([]);
  const [saved, setSaved] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pinUserId, setPinUserId] = useState("");
  const [pinAdminPassword, setPinAdminPassword] = useState("");
  const [newManagerPin, setNewManagerPin] = useState("");
  const [confirmManagerPin, setConfirmManagerPin] = useState("");
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUser, setNewUser] = useState({
    name: "",
    username: "",
    pin: "",
    confirmPin: "",
    role: "CASHIER" as "ADMIN" | "MANAGER" | "CASHIER"
  });
  const [auditIntegrity, setAuditIntegrity] = useState<{ valid: boolean; checked: number; error?: string } | null>(null);
  const [shopConfig, setShopConfig] = useState({
    shop_name: "Gujjar Milk Shop",
    shop_address: "Main Market, Faisalabad",
    shop_phone: "0300-1234567",
    receipt_footer: "Thank you! Come again"
  });

  const [ratesPinModal, setRatesPinModal] = useState(false);
  const [ratesPin, setRatesPin] = useState("");
  const [rateHistory, setRateHistory] = useState<any[]>([]);
  const [backups, setBackups] = useState<any[]>([]);
  const [backupDir, setBackupDir] = useState("");
  const [isBackingUp, setIsBackingUp] = useState(false);

  const [syncStatus, setSyncStatus] = useState<{
    status: string;
    pendingCount: number;
    failedCount: number;
    stuckCount: number;
    oldestStuckCreatedAt: string | null;
    latestError: string | null;
    latestErrorTable: string | null;
    lastSyncedAt: string | null;
  } | null>(null);

  const loadSyncStatus = async () => {
    try {
      const status = await window.electronAPI?.sync?.getStatus();
      setSyncStatus(status);
    } catch (err) {
      console.error(err);
    }
  };

  const handleSyncNow = async () => {
    try {
      setIsLoading(true);
      const result = await window.electronAPI?.sync?.syncNow();
      if (result?.success) {
        alert(`Sync complete! ${result.pendingCount} pending, ${result.failedCount} failed.`);
      } else {
        alert(result?.error || 'Sync failed');
      }
      await loadSyncStatus();
    } catch (err) {
      alert('Failed to trigger sync');
    } finally {
      setIsLoading(false);
    }
  };

  // POS Config State
  const [posConfig, setPosConfig] = useState<PosConfigState>({
    autoPrint: "true",
    receiptDelay: "3",
    defaultPayment: "CASH",
    printerType: "Browser Print",
    printerName: "",
    paperWidth: "80mm",
    lowStockThreshold: "5",
    maxHeldBills: "5",
    showChangeCalc: "true",
    saleSound: "true",
    cashierPinReq: "false",
    taxEnabled: "false",
    taxRate: "0",
    taxLabel: "GST",
    shopDayStartHour: "5",
    ramadan24Hour: "false",
    "24_hour_mode": "false",
    APP_API_URL: "",
    SYNC_DEVICE_SECRET: ""
  });

  useEffect(() => {
    loadSettings();
    loadPrinters();
    loadUsers();
    loadAuditLogs();
    loadSyncStatus();
    loadRateHistory();
    loadBackupList();
  }, []);

  const loadRateHistory = async () => {
    try {
      const data = await window.electronAPI?.dailyRates?.getHistory();
      setRateHistory(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadBackupList = async () => {
    try {
      const result = await window.electronAPI?.system?.listBackups();
      if (result?.success) {
        setBackups(result.backups || []);
        setBackupDir(result.backupDir || "");
      }
    } catch (err) {
      console.error(err);
    }
  };

  const handleBackupNow = async () => {
    setIsBackingUp(true);
    try {
      const result = await window.electronAPI?.system?.backup();
      if (result?.success) {
        setBackups(result.backups || []);
      } else {
        alert(result?.error || "Backup failed");
      }
    } catch (err) {
      alert("Backup failed");
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreFromFile = async () => {
    const ok = window.confirm(
      "Restore will close the app and replace the current database.\n\nA safety backup is created automatically first.\n\nContinue?"
    );
    if (!ok) return;
    const result = await window.electronAPI?.system?.restore();
    if (result?.success === false && result?.reason !== "canceled") {
      alert(result?.error || "Restore failed");
    }
  };

  const handleOpenBackupFolder = async () => {
    await window.electronAPI?.system?.openBackupFolder();
  };

  const loadSettings = async () => {
    try {
      const rates = await window.electronAPI?.dailyRates?.getToday();
      if (rates) {
        setMilkRate(String(rates.milk_rate));
        setYogurtRate(String(rates.yogurt_rate));
      }

      const settings = await window.electronAPI?.settings?.getAll();
      if (settings && settings.length > 0) {
        const config: any = {};
        settings.forEach((s: any) => config[s.key] = s.value);
        if (config["24_hour_mode"] && !config.ramadan24Hour) {
          config.ramadan24Hour = config["24_hour_mode"];
        }
        setPosConfig(prev => ({ ...prev, ...config }));
        setShopConfig(prev => ({
          ...prev,
          shop_name: config.shop_name || prev.shop_name,
          shop_address: config.shop_address || prev.shop_address,
          shop_phone: config.shop_phone || prev.shop_phone,
          receipt_footer: config.receipt_footer || prev.receipt_footer
        }));
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadUsers = async () => {
    try {
      const data = await window.electronAPI?.auth?.getUsers();
      setUsers(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const loadPrinters = async () => {
    try {
      const result = await window.electronAPI?.printer?.getPrinters();
      if (result?.success) {
        setPrinters(result.printers || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadAuditLogs = async () => {
    try {
      const data = await window.electronAPI?.audit?.getAll(500);
      setAuditLogs(data || []);
    } catch (err) {
      console.error(err);
    }
  };

  const verifyAuditIntegrity = async () => {
    const result = await window.electronAPI?.audit?.verifyIntegrity();
    if (!result) return;
    setAuditIntegrity({
      valid: Boolean(result.valid),
      checked: Number(result.checked || 0),
      error: result.error
    });
  };

  const sealLegacyAuditLogs = async () => {
    const ok = window.confirm("This will seal existing audit logs with tamper-check hashes. Do this before production use. Continue?");
    if (!ok) return;
    const result = await window.electronAPI?.audit?.sealLegacy();
    if (!result?.success) {
      alert(result?.error || "Failed to seal legacy audit logs");
      return;
    }
    alert(`Audit logs sealed. ${result.sealedCount || 0} entries updated.`);
    await verifyAuditIntegrity();
    await loadAuditLogs();
  };

  const handleSaveRates = () => {
    if (!milkRate || Number(milkRate) <= 0 || !yogurtRate || Number(yogurtRate) <= 0) {
      alert("Both rates must be greater than zero.");
      return;
    }
    setRatesPin("");
    setRatesPinModal(true);
  };

  const submitRatesWithPin = async () => {
    if (!ratesPin) return;
    try {
      setIsLoading(true);
      const result = await window.electronAPI?.dailyRates?.update({
        milkRate: Number(milkRate),
        yogurtRate: Number(yogurtRate),
        managerPin: ratesPin
      });
      if (result?.success === false) {
        alert(result?.error || "Wrong PIN or failed to update rates");
        return;
      }
      setRatesPinModal(false);
      await loadRateHistory();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert("Failed to update rates");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSavePosConfig = async () => {
    try {
      setIsLoading(true);
      await window.electronAPI?.settings?.update({
        ...posConfig,
        "24_hour_mode": posConfig.ramadan24Hour
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert("Failed to save configuration");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveShopInfo = async () => {
    try {
      if (!shopConfig.shop_name.trim()) {
        alert("Shop name is required");
        return;
      }
      setIsLoading(true);
      const result = await window.electronAPI?.settings?.update(shopConfig);
      if (!result?.success) {
        alert(result?.error || "Failed to save shop information");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err: any) {
      alert(err?.message || "Failed to save shop information");
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpdateUser = async (userId: string, data: any) => {
    // Basic user update logic - could be expanded to a modal
    try {
      // In a real app, we'd open a modal here
      console.log("Updating user", userId, data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCreateUser = async () => {
    if (!newUser.name.trim()) {
      alert("User name is required.");
      return;
    }
    if (!newUser.username.trim()) {
      alert("Username is required.");
      return;
    }
    if (!newUser.pin || newUser.pin !== newUser.confirmPin) {
      alert("PIN and confirm PIN must match.");
      return;
    }

    const result = await window.electronAPI?.auth?.createUser({
      name: newUser.name.trim(),
      username: newUser.username.trim(),
      pin: newUser.pin,
      role: newUser.role
    });

    if (!result?.success) {
      alert(result?.error || "Failed to add user");
      return;
    }

    setShowAddUser(false);
    setNewUser({ name: "", username: "", pin: "", confirmPin: "", role: "CASHIER" });
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await loadUsers();
    await loadAuditLogs();
  };

  const handleSetManagerPin = async () => {
    if (!newManagerPin || newManagerPin !== confirmManagerPin) {
      alert("New PIN and confirm PIN must match.");
      return;
    }

    const result = await window.electronAPI?.auth?.setManagerPin({
      userId: pinUserId || users.find((u) => u.role === "ADMIN")?.id,
      currentPassword: pinAdminPassword,
      newPin: newManagerPin
    });

    if (!result?.success) {
      alert(result?.error || "Failed to change manager PIN");
      return;
    }

    setPinAdminPassword("");
    setNewManagerPin("");
    setConfirmManagerPin("");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    await loadAuditLogs();
  };

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
        <p className="text-text-secondary mt-1">Configure shop preferences, daily rates, and system sync.</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        <div className="md:w-64 shrink-0 space-y-1">
          {[
            { id: "RATES", label: "Daily Rates", icon: Tag },
            { id: "SHOP", label: "Shop Info", icon: Store },
            { id: "POS", label: "POS Config", icon: Monitor },
            { id: "USERS", label: "Users & Roles", icon: Users },
            { id: "AUDIT", label: "Audit Log", icon: ShieldCheck },
            { id: "SYNC", label: "Sync Configuration", icon: RefreshCw },
            { id: "BACKUP", label: "Local Backup", icon: Database },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as SettingsTab)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors",
                activeTab === tab.id 
                  ? "bg-primary text-white shadow-md shadow-primary/20" 
                  : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
              )}
            >
              <tab.icon className="w-5 h-5" />
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex-1 card min-h-[500px]">
          {activeTab === "SHOP" && (
            <div className="p-6 space-y-6 animate-slide-in-right">
              <h2 className="text-xl font-bold border-b border-surface-4 pb-4">Shop Information</h2>
              <div className="grid gap-4 max-w-md">
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 block">Shop Name</label>
                  <input type="text" value={shopConfig.shop_name} onChange={e => setShopConfig(prev => ({ ...prev, shop_name: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 block">Address</label>
                  <input type="text" value={shopConfig.shop_address} onChange={e => setShopConfig(prev => ({ ...prev, shop_address: e.target.value }))} className="input" />
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 block">Phone Number</label>
                  <input type="text" value={shopConfig.shop_phone} onChange={e => setShopConfig(prev => ({ ...prev, shop_phone: e.target.value }))} className="input" />
                </div>
                <div className="[&>input:last-child]:hidden">
                  <label className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 block">Receipt Footer Message</label>
                  <input type="text" value={shopConfig.receipt_footer} onChange={e => setShopConfig(prev => ({ ...prev, receipt_footer: e.target.value }))} className="input" />
                  <input type="text" defaultValue="Thank you! Come again 🙏" className="input" />
                </div>
                <button onClick={handleSaveShopInfo} disabled={isLoading} className={cn("btn-primary mt-4 flex items-center justify-center gap-2", saved ? "bg-success hover:bg-success" : "")}>
                  {saved ? <CheckCircle2 className="w-4 h-4"/> : <Save className="w-4 h-4"/>}
                  {saved ? "Saved" : "Save Changes"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "POS" && (
            <div className="p-6 space-y-6 animate-slide-in-right">
              <h2 className="text-xl font-bold border-b border-surface-4 pb-4">POS Configuration</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-4">
                <div className="flex justify-between items-center bg-surface-3 p-3 rounded border border-surface-4">
                  <label className="text-sm font-bold text-text-primary">Auto-print receipt</label>
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 accent-primary" 
                    checked={posConfig.autoPrint === "true"}
                    onChange={e => setPosConfig(prev => ({ ...prev, autoPrint: String(e.target.checked) }))}
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Receipt auto-close delay</label>
                  <select 
                    value={posConfig.receiptDelay}
                    onChange={e => setPosConfig(prev => ({ ...prev, receiptDelay: e.target.value }))}
                    className="input bg-surface-3"
                  >
                    <option value="2">2 seconds</option>
                    <option value="3">3 seconds</option>
                    <option value="5">5 seconds</option>
                    <option value="manual">Manual close</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Default payment method</label>
                  <select 
                    value={posConfig.defaultPayment}
                    onChange={e => setPosConfig(prev => ({ ...prev, defaultPayment: e.target.value }))}
                    className="input bg-surface-3"
                  >
                    <option value="CASH">CASH</option>
                    <option value="ASK">Ask every time</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Printer Type</label>
                  <select 
                    value={posConfig.printerType}
                    onChange={e => setPosConfig(prev => ({ ...prev, printerType: e.target.value }))}
                    className="input bg-surface-3"
                  >
                    <option value="USB Thermal">USB Thermal</option>
                    <option value="Network IP">Network IP</option>
                    <option value="Browser Print">Browser Print</option>
                  </select>
                </div>
                <div className="md:col-span-2 rounded-xl border border-surface-4 bg-surface-3/80 p-4">
                  <div className="flex items-center justify-between gap-3 mb-3">
                    <div>
                      <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Receipt Printer</label>
                      <p className="text-xs text-text-secondary">Choose the actual Windows printer used for thermal receipts.</p>
                    </div>
                    <button type="button" onClick={loadPrinters} className="btn-secondary text-xs flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5" />
                      Refresh
                    </button>
                  </div>
                  <div className="grid md:grid-cols-[1fr_auto] gap-3">
                    <select
                      value={posConfig.printerName}
                      onChange={e => setPosConfig(prev => ({ ...prev, printerName: e.target.value }))}
                      className="input bg-surface-3"
                    >
                      <option value="">Use default Windows printer</option>
                      {printers.map((printer) => (
                        <option key={printer.name} value={printer.name}>
                          {printer.displayName || printer.name}{printer.isDefault ? " (Default)" : ""}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={async () => {
                        const res = await window.electronAPI?.printer?.printReceipt({
                          billNumber: "TEST-PRINT",
                          date: new Date(),
                          customer: "Printer Test",
                          items: [{ id: "test", name: "Test Receipt", quantity: 1, price: 0, lineTotal: 0 }],
                          subtotal: 0,
                          discount: 0,
                          taxAmount: 0,
                          grandTotal: 0,
                          amountPaid: 0,
                          balanceDue: 0,
                          cashPaid: 0,
                          onlinePaid: 0,
                          changeToReturn: 0,
                          paymentType: "CASH"
                        });
                        alert(res?.success ? "Test receipt sent to printer." : res?.error || "Printer test failed.");
                      }}
                      className="btn-secondary flex items-center justify-center gap-2"
                    >
                      <Printer className="w-4 h-4" />
                      Test
                    </button>
                  </div>
                  {printers.length === 0 && (
                    <p className="text-xs text-warning mt-3">No printers found yet. Install your thermal printer driver, then click Refresh.</p>
                  )}
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Paper Width</label>
                  <select 
                    value={posConfig.paperWidth}
                    onChange={e => setPosConfig(prev => ({ ...prev, paperWidth: e.target.value }))}
                    className="input bg-surface-3"
                  >
                    <option value="80mm">80mm</option>
                    <option value="58mm">58mm</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Low Stock Threshold (Units)</label>
                  <input 
                    type="number" 
                    value={posConfig.lowStockThreshold}
                    onChange={e => setPosConfig(prev => ({ ...prev, lowStockThreshold: e.target.value }))}
                    className="input bg-surface-3" 
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Max Held Bills</label>
                  <input 
                    type="number" 
                    value={posConfig.maxHeldBills}
                    onChange={e => setPosConfig(prev => ({ ...prev, maxHeldBills: e.target.value }))}
                    min="1" max="10" className="input bg-surface-3" 
                  />
                </div>
                <div className="flex justify-between items-center bg-surface-3 p-3 rounded border border-surface-4 mt-2">
                  <label className="text-sm font-bold text-text-primary">Show Change Calculator</label>
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 accent-primary" 
                    checked={posConfig.showChangeCalc === "true"}
                    onChange={e => setPosConfig(prev => ({ ...prev, showChangeCalc: String(e.target.checked) }))}
                  />
                </div>
                <div className="flex justify-between items-center bg-surface-3 p-3 rounded border border-surface-4 mt-2">
                  <label className="text-sm font-bold text-text-primary">Sound on sale complete</label>
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 accent-primary" 
                    checked={posConfig.saleSound === "true"}
                    onChange={e => setPosConfig(prev => ({ ...prev, saleSound: String(e.target.checked) }))}
                  />
                </div>
                <div className="flex justify-between items-center bg-surface-3 p-3 rounded border border-surface-4 mt-2">
                  <label className="text-sm font-bold text-text-primary">Cashier PIN required</label>
                  <input 
                    type="checkbox" 
                    className="w-5 h-5 accent-primary" 
                    checked={posConfig.cashierPinReq === "true"}
                    onChange={e => setPosConfig(prev => ({ ...prev, cashierPinReq: String(e.target.checked) }))}
                  />
                </div>
                <div className="md:col-span-2 rounded-xl border border-surface-4 bg-surface-3/80 p-4 space-y-4">
                  <div>
                    <h3 className="font-bold text-text-primary">Shop Timing & Business Day</h3>
                    <p className="text-xs text-text-secondary mt-1">Reports follow the open shift. Late-night sales stay with the shift that was opened for that business day.</p>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Normal Day Starts At</label>
                      <select
                        value={posConfig.shopDayStartHour}
                        onChange={e => setPosConfig(prev => ({ ...prev, shopDayStartHour: e.target.value }))}
                        className="input bg-surface-3"
                      >
                        <option value="4">4:00 AM</option>
                        <option value="5">5:00 AM</option>
                        <option value="6">6:00 AM</option>
                      </select>
                    </div>
                    <div className="flex justify-between items-center bg-surface-2 p-3 rounded border border-surface-4">
                      <div>
                        <label className="text-sm font-bold text-text-primary">24 Hour Mode</label>
                        <p className="text-xs text-text-secondary mt-1">For Ramadan: keep the open shift running until owner or manager closes it.</p>
                      </div>
                      <input
                        type="checkbox"
                        className="w-5 h-5 accent-primary"
                        checked={posConfig.ramadan24Hour === "true"}
                        onChange={e => setPosConfig(prev => ({ ...prev, ramadan24Hour: String(e.target.checked), "24_hour_mode": String(e.target.checked) }))}
                      />
                    </div>
                  </div>
                </div>

                <div className="md:col-span-2 rounded-xl border border-surface-4 bg-surface-3/80 p-4 space-y-4">
                  <div className="flex justify-between items-center">
                    <div>
                      <label className="text-sm font-bold text-text-primary">Enable Sales Tax</label>
                      <p className="text-xs text-text-secondary mt-1">Only products not marked tax exempt will be charged tax during checkout.</p>
                    </div>
                    <input
                      type="checkbox"
                      className="w-5 h-5 accent-primary"
                      checked={posConfig.taxEnabled === "true"}
                      onChange={e => setPosConfig(prev => ({ ...prev, taxEnabled: String(e.target.checked) }))}
                    />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Tax Label</label>
                      <input
                        type="text"
                        value={posConfig.taxLabel}
                        onChange={e => setPosConfig(prev => ({ ...prev, taxLabel: e.target.value }))}
                        className="input bg-surface-3"
                        placeholder="GST"
                      />
                    </div>
                    <div>
                      <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Tax Rate (%)</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={posConfig.taxRate}
                        onChange={e => setPosConfig(prev => ({ ...prev, taxRate: e.target.value }))}
                        className="input bg-surface-3"
                        placeholder="0"
                      />
                    </div>
                  </div>
                </div>
                <div className="md:col-span-2 mt-4">
                  <button 
                    onClick={handleSavePosConfig}
                    className={cn("btn-primary flex items-center justify-center gap-2 h-12 w-full md:w-auto px-8 transition-all", saved ? "bg-success hover:bg-success" : "")}
                  >
                    {saved ? <CheckCircle2 className="w-5 h-5"/> : <Save className="w-4 h-4"/>}
                    {saved ? "Configuration Saved" : "Save Configuration"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === "RATES" && (
            <div className="p-6 space-y-6 animate-slide-in-right">
              <h2 className="text-xl font-bold border-b border-surface-4 pb-4">Daily Rates Configuration</h2>
              
              <div className="bg-surface-3 border border-surface-4 rounded-xl p-6 grid md:grid-cols-2 gap-8 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 blur-3xl rounded-full translate-x-1/2 -translate-y-1/2" />
                
                <div>
                  <label className="text-sm font-bold text-text-primary mb-2 flex items-center gap-2">
                    <span className="text-2xl">🥛</span> Milk Rate (Rs/kg)
                  </label>
                  <input 
                    type="number" 
                    value={milkRate} 
                    onChange={e => setMilkRate(e.target.value)}
                    className="input text-3xl font-bold font-mono py-4 text-accent border-accent/30 focus:border-accent focus:ring-accent" 
                  />
                </div>
                <div>
                  <label className="text-sm font-bold text-text-primary mb-2 flex items-center gap-2">
                    <span className="text-2xl">🫙</span> Yogurt Rate (Rs/kg)
                  </label>
                  <input 
                    type="number" 
                    value={yogurtRate} 
                    onChange={e => setYogurtRate(e.target.value)}
                    className="input text-3xl font-bold font-mono py-4 text-accent border-accent/30 focus:border-accent focus:ring-accent" 
                  />
                </div>
                <div className="md:col-span-2 pt-4 flex items-center justify-between">
                  <p className="text-sm text-text-secondary">
                    {rateHistory.length > 0
                      ? `Last updated: ${new Date(rateHistory[0].date).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })} by ${rateHistory[0].updated_by_name || "Unknown"}`
                      : "No rate history found"}
                  </p>
                  <button
                    onClick={handleSaveRates}
                    className={cn("btn-primary text-lg h-12 px-8 flex items-center gap-2 transition-all", saved ? "bg-success hover:bg-success" : "bg-accent hover:bg-accent-light")}
                  >
                    {saved ? <><CheckCircle2 className="w-5 h-5"/> Updated</> : "Update Rates"}
                  </button>
                </div>
              </div>

              <div className="mt-8">
                <h3 className="font-semibold mb-4 text-text-secondary">Rate History</h3>
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-text-secondary uppercase bg-surface-3 border-b border-surface-4">
                    <tr>
                      <th className="px-4 py-2">Date & Time</th>
                      <th className="px-4 py-2">Milk Rate</th>
                      <th className="px-4 py-2">Yogurt Rate</th>
                      <th className="px-4 py-2">Updated By</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-4">
                    {rateHistory.map(r => (
                      <tr key={r.id} className="hover:bg-surface-3/30">
                        <td className="px-4 py-2">{new Date(r.date).toLocaleDateString("en-PK", { day: "numeric", month: "short", year: "numeric" })}</td>
                        <td className="px-4 py-2 font-mono">{r.milk_rate}</td>
                        <td className="px-4 py-2 font-mono">{r.yogurt_rate}</td>
                        <td className="px-4 py-2">{r.updated_by_name || "—"}</td>
                      </tr>
                    ))}
                    {rateHistory.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-6 text-center text-text-secondary">No rate history found.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "USERS" && (
            <div className="p-6 space-y-6 animate-slide-in-right">
              <div className="flex justify-between items-center border-b border-surface-4 pb-4">
                <h2 className="text-xl font-bold">Users & Roles</h2>
                <button onClick={() => setShowAddUser(true)} className="btn-primary text-sm px-3 py-1.5">+ Add User</button>
              </div>
              {showAddUser && (
                <div className="rounded-xl border border-surface-4 bg-surface-2 p-4 space-y-4">
                  <div>
                    <h3 className="font-bold text-text-primary">Add Login User</h3>
                    <p className="text-sm text-text-secondary mt-1">This creates a real POS login for cashier, manager, or admin.</p>
                  </div>
                  <div className="grid md:grid-cols-2 gap-3">
                    <div>
                      <label className="label">Full Name</label>
                      <input
                        className="input"
                        value={newUser.name}
                        onChange={(e) => setNewUser((u) => ({ ...u, name: e.target.value }))}
                        placeholder="e.g. Ali Cashier"
                      />
                    </div>
                    <div>
                      <label className="label">Username</label>
                      <input
                        className="input"
                        value={newUser.username}
                        onChange={(e) => setNewUser((u) => ({ ...u, username: e.target.value.toLowerCase() }))}
                        placeholder="e.g. ali"
                      />
                    </div>
                    <div>
                      <label className="label">Role</label>
                      <select
                        className="input"
                        value={newUser.role}
                        onChange={(e) => setNewUser((u) => ({ ...u, role: e.target.value as "ADMIN" | "MANAGER" | "CASHIER" }))}
                      >
                        <option value="CASHIER">Cashier - POS only</option>
                        <option value="MANAGER">Manager - reports and approvals</option>
                        <option value="ADMIN">Admin - full access</option>
                      </select>
                    </div>
                    <div className="rounded-lg border border-info/20 bg-info/5 p-3 text-xs text-text-secondary">
                      <p className="font-bold text-text-primary">Role access</p>
                      <p className="mt-1">Cashier can sell, return, khata, shift, and cash register. Manager gets reports, inventory, suppliers, expenses, and deliveries. Admin gets everything.</p>
                    </div>
                    <div>
                      <label className="label">Login PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        className="input"
                        value={newUser.pin}
                        onChange={(e) => setNewUser((u) => ({ ...u, pin: e.target.value }))}
                        placeholder="4 to 8 digit private PIN"
                      />
                    </div>
                    <div>
                      <label className="label">Confirm PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        className="input"
                        value={newUser.confirmPin}
                        onChange={(e) => setNewUser((u) => ({ ...u, confirmPin: e.target.value }))}
                        placeholder="Repeat PIN"
                      />
                    </div>
                  </div>
                  <div className="flex justify-end gap-3">
                    <button
                      onClick={() => {
                        setShowAddUser(false);
                        setNewUser({ name: "", username: "", pin: "", confirmPin: "", role: "CASHIER" });
                      }}
                      className="btn-secondary"
                    >
                      Cancel
                    </button>
                    <button onClick={handleCreateUser} className="btn-primary">
                      Save User
                    </button>
                  </div>
                </div>
              )}
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
                <h3 className="font-bold text-text-primary">Manager PIN</h3>
                <p className="text-sm text-text-secondary mt-1">This PIN approves refunds, voids, high discounts, stock adjustments, and daily rate changes.</p>
                <div className="grid md:grid-cols-4 gap-3 mt-4">
                  <select value={pinUserId} onChange={(e) => setPinUserId(e.target.value)} className="input">
                    <option value="">Default admin/manager</option>
                    {users.filter((u) => u.role === "ADMIN" || u.role === "MANAGER").map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.role})</option>
                    ))}
                  </select>
                  <input
                    type="password"
                    value={pinAdminPassword}
                    onChange={(e) => setPinAdminPassword(e.target.value)}
                    placeholder="Admin password"
                    className="input"
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    value={newManagerPin}
                    onChange={(e) => setNewManagerPin(e.target.value)}
                    placeholder="New PIN"
                    className="input"
                  />
                  <input
                    type="password"
                    inputMode="numeric"
                    value={confirmManagerPin}
                    onChange={(e) => setConfirmManagerPin(e.target.value)}
                    placeholder="Confirm PIN"
                    className="input"
                  />
                </div>
                <button onClick={handleSetManagerPin} className="btn-primary mt-4">
                  Save Manager PIN
                </button>
              </div>
              <table className="w-full text-sm text-left">
                  <thead className="text-[10px] text-text-secondary uppercase bg-surface-3 border-b border-surface-4 tracking-wider">
                    <tr>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Role</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-4">
                    {users.map(u => (
                      <tr key={u.id} className="hover:bg-surface-3/50">
                        <td className="px-4 py-3 flex items-center gap-3">
                          <div className={cn("w-8 h-8 rounded-full flex items-center justify-center font-bold", u.role === "ADMIN" ? "bg-primary/20 text-primary" : "bg-blue-500/20 text-blue-400")}>
                            {u.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-semibold text-text-primary">{u.name}</p>
                            <p className="text-xs text-text-secondary">@{u.username}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "badge",
                            u.role === "ADMIN" ? "bg-red-500/15 text-red-400" : "bg-green-500/15 text-green-400"
                          )}>
                            {u.role}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="badge badge-success">Active</span>
                        </td>
                      </tr>
                    ))}
                    {users.length === 0 && (
                      <tr><td colSpan={3} className="p-8 text-center text-text-secondary">No users found.</td></tr>
                    )}
                  </tbody>
              </table>
            </div>
          )}

          {activeTab === "AUDIT" && (
            <div className="p-6 space-y-6 animate-slide-in-right">
              <div className="flex justify-between items-center border-b border-surface-4 pb-4">
                <div>
                  <h2 className="text-xl font-bold">Audit Log</h2>
                  <p className="text-sm text-text-secondary mt-1">Permanent record of discounts, refunds, voids, rates, stock, settings, login, and logout.</p>
                </div>
                <button onClick={loadAuditLogs} className="btn-secondary text-sm px-3 py-1.5 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" />
                  Refresh
                </button>
                <button onClick={verifyAuditIntegrity} className="btn-primary text-sm px-3 py-1.5 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  Verify Integrity
                </button>
                <button onClick={sealLegacyAuditLogs} className="btn-secondary text-sm px-3 py-1.5 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" />
                  Seal Legacy
                </button>
              </div>

              {auditIntegrity && (
                <div className={cn(
                  "rounded-xl border px-4 py-3 text-sm font-medium",
                  auditIntegrity.valid ? "border-success/30 bg-success/10 text-success" : "border-danger/30 bg-danger/10 text-danger"
                )}>
                  {auditIntegrity.valid
                    ? `Audit trail verified. ${auditIntegrity.checked} entries checked.`
                    : `Audit trail problem found: ${auditIntegrity.error || "Unknown issue"}`}
                </div>
              )}

              <div className="overflow-x-auto rounded-xl border border-surface-4">
                <table className="w-full text-sm text-left whitespace-nowrap">
                  <thead className="text-[10px] text-text-secondary uppercase bg-surface-3 border-b border-surface-4 tracking-wider">
                    <tr>
                      <th className="px-4 py-3">Time</th>
                      <th className="px-4 py-3">Action</th>
                      <th className="px-4 py-3">User</th>
                      <th className="px-4 py-3">Approved By</th>
                      <th className="px-4 py-3">Entity</th>
                      <th className="px-4 py-3">Reason</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-4">
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="hover:bg-surface-3/50">
                        <td className="px-4 py-3 font-mono text-xs">{new Date(log.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3 font-bold text-primary">{log.action_type}</td>
                        <td className="px-4 py-3">{log.actor_name || "-"}</td>
                        <td className="px-4 py-3">{log.approved_by_name || "-"}</td>
                        <td className="px-4 py-3 font-mono text-xs">{log.entity_type || "-"} {log.entity_id ? `#${String(log.entity_id).slice(0, 8)}` : ""}</td>
                        <td className="px-4 py-3 max-w-xs truncate text-text-secondary">{log.reason || "-"}</td>
                      </tr>
                    ))}
                    {auditLogs.length === 0 && (
                      <tr><td colSpan={6} className="p-8 text-center text-text-secondary">No audit logs found yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === "SYNC" && (
            <div className="p-6 space-y-6 animate-slide-in-right">
              <div className="flex justify-between items-center border-b border-surface-4 pb-4">
                <div>
                  <h2 className="text-xl font-bold">Sync Configuration</h2>
                  <p className="text-sm text-text-secondary mt-1">Configure cloud synchronization and check status.</p>
                </div>
                <button 
                  onClick={handleSyncNow} 
                  disabled={isLoading}
                  className="btn-primary text-sm px-4 py-2 flex items-center gap-2"
                >
                  <RefreshCw className={cn("w-4 h-4", isLoading ? "animate-spin" : "")} />
                  Sync Now
                </button>
              </div>

              {syncStatus && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-surface-3 p-4 rounded-xl border border-surface-4 flex flex-col justify-between">
                    <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Status</span>
                    <span className={cn(
                      "text-xl font-bold mt-2",
                      syncStatus.status === 'online' ? "text-success" : syncStatus.status === 'error' ? "text-danger" : "text-text-secondary"
                    )}>
                      {syncStatus.status.toUpperCase()}
                    </span>
                  </div>
                  <div className="bg-surface-3 p-4 rounded-xl border border-surface-4 flex flex-col justify-between">
                    <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Pending Items</span>
                    <span className="text-xl font-bold mt-2 font-mono">{syncStatus.pendingCount}</span>
                  </div>
                  <div className="bg-surface-3 p-4 rounded-xl border border-surface-4 flex flex-col justify-between">
                    <span className="text-xs font-bold text-text-secondary uppercase tracking-wider">Failed Items</span>
                    <span className={cn("text-xl font-bold mt-2 font-mono", syncStatus.failedCount > 0 ? "text-danger" : "text-text-primary")}>
                      {syncStatus.failedCount}
                    </span>
                  </div>
                </div>
              )}

              {syncStatus?.latestError && (
                <div className="rounded-xl border border-danger/30 bg-danger/10 p-4 text-sm text-danger">
                  <p className="font-bold">Latest Sync Error:</p>
                  <p className="mt-1 font-mono">{syncStatus.latestError}</p>
                  <p className="text-xs mt-1 text-text-secondary">
                    Table: {syncStatus.latestErrorTable} | Last Attempt: {syncStatus.lastSyncedAt ? new Date(syncStatus.lastSyncedAt).toLocaleString() : 'Never'}
                  </p>
                </div>
              )}

              <div className="grid gap-4 max-w-xl">
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 block">Cloud API URL</label>
                  <input 
                    type="text" 
                    value={posConfig.APP_API_URL || ""} 
                    onChange={e => setPosConfig(prev => ({ ...prev, APP_API_URL: e.target.value }))} 
                    className="input font-mono text-sm" 
                    placeholder="https://api.example.com/api"
                  />
                  <span className="text-xs text-text-secondary mt-1 block">The base URL for the central cloud server.</span>
                </div>
                <div>
                  <label className="text-xs font-bold text-text-secondary uppercase tracking-wider mb-1 block">Sync Device Secret</label>
                  <input 
                    type="password" 
                    value={posConfig.SYNC_DEVICE_SECRET || ""} 
                    onChange={e => setPosConfig(prev => ({ ...prev, SYNC_DEVICE_SECRET: e.target.value }))} 
                    className="input font-mono text-sm" 
                    placeholder="••••••••••••••••"
                  />
                  <span className="text-xs text-text-secondary mt-1 block">Authentication token assigned to this terminal.</span>
                </div>
                <button 
                  onClick={handleSavePosConfig} 
                  disabled={isLoading} 
                  className={cn("btn-primary mt-4 flex items-center justify-center gap-2", saved ? "bg-success hover:bg-success" : "")}
                >
                  {saved ? <CheckCircle2 className="w-4 h-4"/> : <Save className="w-4 h-4"/>}
                  {saved ? "Saved" : "Save Sync Settings"}
                </button>
              </div>
            </div>
          )}

          {activeTab === "BACKUP" && (
            <div className="p-6 space-y-6 animate-slide-in-right">
              <div className="flex justify-between items-center border-b border-surface-4 pb-4">
                <div>
                  <h2 className="text-xl font-bold">Backup & Restore</h2>
                  <p className="text-sm text-text-secondary mt-1">Create local backups of your database. Auto-backup runs nightly at 2:00 AM.</p>
                </div>
                <button onClick={loadBackupList} className="btn-secondary text-sm px-3 py-1.5 flex items-center gap-2">
                  <RefreshCw className="w-4 h-4" /> Refresh
                </button>
              </div>

              <div className="grid md:grid-cols-3 gap-4">
                <button
                  onClick={handleBackupNow}
                  disabled={isBackingUp}
                  className="btn-primary h-14 flex items-center justify-center gap-2 text-base"
                >
                  <Database className={cn("w-5 h-5", isBackingUp ? "animate-pulse" : "")} />
                  {isBackingUp ? "Backing up…" : "Backup Now"}
                </button>
                <button
                  onClick={handleRestoreFromFile}
                  className="btn-secondary h-14 flex items-center justify-center gap-2 text-base border-warning/40 text-warning hover:bg-warning/10"
                >
                  <RefreshCw className="w-5 h-5" />
                  Restore from File
                </button>
                <button
                  onClick={handleOpenBackupFolder}
                  className="btn-secondary h-14 flex items-center justify-center gap-2 text-base"
                >
                  <Database className="w-5 h-5" />
                  Open Backup Folder
                </button>
              </div>

              {backupDir && (
                <div className="rounded-lg border border-surface-4 bg-surface-3/50 px-4 py-2 text-xs text-text-secondary font-mono">
                  Backup folder: {backupDir}
                </div>
              )}

              <div className="rounded-xl border border-surface-4 overflow-hidden">
                <table className="w-full text-sm text-left">
                  <thead className="text-[10px] text-text-secondary uppercase bg-surface-3 border-b border-surface-4 tracking-wider">
                    <tr>
                      <th className="px-4 py-3">File</th>
                      <th className="px-4 py-3">Size</th>
                      <th className="px-4 py-3">Created</th>
                      <th className="px-4 py-3">Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-4">
                    {backups.map(b => (
                      <tr key={b.fileName} className="hover:bg-surface-3/50">
                        <td className="px-4 py-3 font-mono text-xs">{b.fileName}</td>
                        <td className="px-4 py-3">{(b.sizeBytes / 1024).toFixed(0)} KB</td>
                        <td className="px-4 py-3">{new Date(b.createdAt).toLocaleString()}</td>
                        <td className="px-4 py-3">
                          <span className={cn(
                            "badge text-xs",
                            b.fileName.startsWith("manual") ? "bg-primary/15 text-primary" : "bg-surface-4 text-text-secondary"
                          )}>
                            {b.fileName.startsWith("manual") ? "Manual" : "Auto"}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {backups.length === 0 && (
                      <tr><td colSpan={4} className="px-4 py-8 text-center text-text-secondary">No backups found. Click "Backup Now" to create the first one.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* MANAGER PIN MODAL FOR RATES */}
      {ratesPinModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-xs overflow-hidden flex flex-col border border-surface-4 animate-slide-up">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center">
              <h3 className="font-semibold text-lg">Manager PIN Required</h3>
              <button onClick={() => setRatesPinModal(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-text-secondary text-center">
                Updating rates to Milk <strong>Rs. {milkRate}</strong> and Yogurt <strong>Rs. {yogurtRate}</strong>
              </p>
              <input
                type="password"
                inputMode="numeric"
                value={ratesPin}
                onChange={e => setRatesPin(e.target.value)}
                onKeyDown={e => e.key === "Enter" && submitRatesWithPin()}
                className="input font-mono text-2xl text-center tracking-widest py-4"
                placeholder="••••"
                autoFocus
              />
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setRatesPinModal(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={submitRatesWithPin} disabled={!ratesPin || isLoading} className="btn-primary flex-1">
                {isLoading ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
