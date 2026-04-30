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
import Employees from "./pages/Employees";
import Deliveries from "./pages/Deliveries";

export type PageId = "dashboard" | "pos" | "inventory" | "suppliers" | "customers" | "khata" | "returns" | "receipt-audit" | "shifts" | "backup" | "test-center" | "expenses" | "reports" | "settings" | "cash-register" | "employees" | "deliveries";

export type UserRole = "ADMIN" | "MANAGER" | "CASHIER";

// Pages each role is allowed to access. Unlisted = ADMIN-only.
export const PAGE_ACCESS: Record<PageId, UserRole[]> = {
  "dashboard":     ["ADMIN", "MANAGER"],
  "pos":           ["ADMIN", "MANAGER", "CASHIER"],
  "inventory":     ["ADMIN", "MANAGER"],
  "suppliers":     ["ADMIN", "MANAGER"],
  "customers":     ["ADMIN", "MANAGER", "CASHIER"],
  "khata":         ["ADMIN", "MANAGER", "CASHIER"],
  "returns":       ["ADMIN", "MANAGER", "CASHIER"],
  "receipt-audit": ["ADMIN", "MANAGER", "CASHIER"],
  "shifts":        ["ADMIN", "MANAGER", "CASHIER"],
  "cash-register": ["ADMIN", "MANAGER", "CASHIER"],
  "expenses":      ["ADMIN", "MANAGER"],
  "reports":       ["ADMIN", "MANAGER"],
  "deliveries":    ["ADMIN", "MANAGER"],
  "employees":     ["ADMIN"],
  "settings":      ["ADMIN"],
  "backup":        ["ADMIN"],
  "test-center":   [],
};

export function canAccessPage(role: string | undefined, page: PageId, isDev = false): boolean {
  if (!role) return false;
  // test-center is only accessible to ADMIN in dev/development mode
  if (page === 'test-center') return isDev && role === 'ADMIN';
  return PAGE_ACCESS[page]?.includes(role as UserRole) ?? false;
}

export default function App() {
  const [page, setPage] = useState<PageId>("pos");
  const [user, setUser] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [setupCompleted, setSetupCompleted] = useState(true);
  const [isDev, setIsDev] = useState(false);

  useEffect(() => {
    const init = async () => {
      const u = await window.electronAPI?.auth?.getMe();
      setUser(u);

      const settings = await window.electronAPI?.settings?.getAll();
      const completedSetting = settings?.find((s: any) => s.key === "setup_completed");
      setSetupCompleted(completedSetting?.value === "true");

      // Check if running in dev mode — only then allow test-center for ADMIN
      const paths = await window.electronAPI?.system?.getPaths?.();
      setIsDev(Boolean(paths?.isDev));

      setAuthChecking(false);
    };
    init();
  }, []);

  // If a user is logged in and the current page is not allowed for their role,
  // bounce them to a landing page their role can access (POS for cashiers, dashboard otherwise).
  useEffect(() => {
    if (!user) return;
    if (!canAccessPage(user.role, page, isDev)) {
      const fallback: PageId = user.role === "CASHIER" ? "pos" : "dashboard";
      setPage(fallback);
    }
  }, [user, page, isDev]);

  const guardedSetPage = (next: PageId) => {
    if (user && !canAccessPage(user.role, next, isDev)) return;
    setPage(next);
  };

  if (authChecking) {
    return <div className="h-screen flex items-center justify-center bg-surface-1"><div className="w-8 h-8 rounded-full bg-primary animate-pulse-dot" /></div>;
  }

  if (!setupCompleted) {
    return <SetupWizard />;
  }

  if (!user) {
    return <Login />;
  }

  const allowed = (p: PageId) => canAccessPage(user.role, p, isDev);

  return (
    <AppShell page={page} setPage={guardedSetPage} userRole={user.role}>
      <Suspense fallback={<div className="p-8 flex justify-center"><div className="w-8 h-8 rounded-full bg-primary animate-pulse-dot" /></div>}>
        {page === "dashboard" && allowed("dashboard") && <Dashboard setPage={guardedSetPage} />}
        {page === "pos" && allowed("pos") && <POS />}
        {page === "inventory" && allowed("inventory") && <Inventory />}
        {page === "suppliers" && allowed("suppliers") && <Suppliers />}
        {page === "customers" && allowed("customers") && <Customers />}
        {page === "khata" && allowed("khata") && <Khata />}
        {page === "returns" && allowed("returns") && <Returns />}
        {page === "receipt-audit" && allowed("receipt-audit") && <ReceiptAudit />}
        {page === "shifts" && allowed("shifts") && <Shifts setPage={guardedSetPage} />}
        {page === "backup" && allowed("backup") && <BackupRestore />}
        {page === "cash-register" && allowed("cash-register") && <CashRegister setPage={guardedSetPage} />}
        {page === "expenses" && allowed("expenses") && <Expenses />}
        {page === "reports" && allowed("reports") && <Reports />}
        {page === "settings" && allowed("settings") && <Settings />}
        {page === "employees" && allowed("employees") && <Employees />}
        {page === "deliveries" && allowed("deliveries") && <Deliveries />}
      </Suspense>
    </AppShell>
  );
}
