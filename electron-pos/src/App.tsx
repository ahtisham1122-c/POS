import { useState, Suspense, useEffect } from "react";
import { AppShell } from "./components/layout/AppShell";
import Login from "./pages/Login";
import SetupWizard from "./pages/SetupWizard";
import POS from "./pages/POS";
import Inventory from "./pages/Inventory";
import Customers from "./pages/Customers";
import Reports from "./pages/Reports";
import Settings from "./pages/Settings";
import Dashboard from "./pages/Dashboard";
import Expenses from "./pages/Expenses";
import Khata from "./pages/Khata";
import CashRegister from "./pages/CashRegister";
import Returns from "./pages/Returns";
import ReceiptAudit from "./pages/ReceiptAudit";
import Shifts from "./pages/Shifts";
import BackupRestore from "./pages/BackupRestore";
import Suppliers from "./pages/Suppliers";
import TestCenter from "./pages/TestCenter";
import Employees from "./pages/Employees";

export type PageId = "dashboard" | "pos" | "inventory" | "suppliers" | "customers" | "khata" | "returns" | "receipt-audit" | "shifts" | "backup" | "test-center" | "expenses" | "reports" | "settings" | "cash-register" | "employees";

export default function App() {
  const [page, setPage] = useState<PageId>("pos");
  const [user, setUser] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [setupCompleted, setSetupCompleted] = useState(true);

  useEffect(() => {
    const init = async () => {
      const u = await window.electronAPI?.auth?.getMe();
      setUser(u);

      const settings = await window.electronAPI?.settings?.getAll();
      const completedSetting = settings?.find((s: any) => s.key === "setup_completed");
      setSetupCompleted(completedSetting?.value === "true");

      setAuthChecking(false);
    };
    init();
  }, []);

  if (authChecking) {
    return <div className="h-screen flex items-center justify-center bg-surface-1"><div className="w-8 h-8 rounded-full bg-primary animate-pulse-dot" /></div>;
  }

  if (!setupCompleted) {
    return <SetupWizard />;
  }

  if (!user) {
    return <Login />;
  }

  return (
    <AppShell page={page} setPage={setPage}>
      <Suspense fallback={<div className="p-8 flex justify-center"><div className="w-8 h-8 rounded-full bg-primary animate-pulse-dot" /></div>}>
        {page === "dashboard" && <Dashboard setPage={setPage} />}
        {page === "pos" && <POS />}
        {page === "inventory" && <Inventory />}
        {page === "suppliers" && <Suppliers />}
        {page === "customers" && <Customers />}
        {page === "khata" && <Khata />}
        {page === "returns" && <Returns />}
        {page === "receipt-audit" && <ReceiptAudit />}
        {page === "shifts" && <Shifts setPage={setPage} />}
        {page === "backup" && <BackupRestore />}
        {page === "test-center" && <TestCenter setPage={setPage} />}
        {page === "cash-register" && <CashRegister setPage={setPage} />}
        {page === "expenses" && <Expenses />}
        {page === "reports" && <Reports />}
        {page === "settings" && <Settings />}
        {page === "employees" && <Employees />}
      </Suspense>
    </AppShell>
  );
}
