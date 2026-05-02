import { useState, Suspense, useEffect, useCallback } from "react";
import { AppShell } from "./components/layout/AppShell";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OpenShiftPrompt } from "./components/OpenShiftPrompt";
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

function AppInner() {
  const [page, setPage] = useState<PageId>("pos");
  const [user, setUser] = useState<any>(null);
  const [authChecking, setAuthChecking] = useState(true);
  const [setupCompleted, setSetupCompleted] = useState(true);
  const [isDev, setIsDev] = useState(false);
  const [hasOpenShift, setHasOpenShift] = useState<boolean | null>(null);
  const [shiftPromptDismissed, setShiftPromptDismissed] = useState(false);

  // Check if a shift is currently open. Cashiers can't sell anything until
  // one is open, so we surface a prompt as soon as the app boots.
  const refreshShiftStatus = useCallback(async () => {
    try {
      const current = await window.electronAPI?.shifts?.getCurrent?.();
      setHasOpenShift(Boolean(current));
    } catch (err) {
      console.error("Failed to check shift status:", err);
      // Don't block the app on a transient IPC failure — assume a shift
      // exists so the user isn't locked out, and let the sales IPC enforce
      // the real check at sale time.
      setHasOpenShift(true);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      try {
        const u = await window.electronAPI?.auth?.getMe();
        setUser(u);

        const settings = await window.electronAPI?.settings?.getAll();
        const completedSetting = Array.isArray(settings)
          ? settings.find((s: any) => s?.key === "setup_completed")
          : null;
        setSetupCompleted(completedSetting?.value === "true");

        const paths = await window.electronAPI?.system?.getPaths?.();
        setIsDev(Boolean(paths?.isDev));

        if (u) {
          await refreshShiftStatus();
        }
      } catch (err) {
        console.error("App init failed:", err);
      } finally {
        setAuthChecking(false);
      }
    };
    init();
  }, [refreshShiftStatus]);

  // Re-check shift status whenever the user navigates back to POS — the
  // shift could have been closed in another tab/page while we weren't
  // watching, and we don't want a stale "all good" state to let a cashier
  // try to ring up a sale that the IPC will then reject.
  useEffect(() => {
    if (!user) return;
    if (page === "pos" || page === "shifts" || page === "cash-register") {
      refreshShiftStatus();
    }
  }, [user, page, refreshShiftStatus]);

  // If the user logs out and back in, reset the dismissed flag so the prompt
  // re-appears for the new session.
  useEffect(() => {
    if (!user) setShiftPromptDismissed(false);
  }, [user]);

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

  // Show the open-shift prompt when:
  //   - the shift status query has finished and returned no open shift
  //   - the user hasn't explicitly skipped it this session
  // Cashiers can't dismiss it (the component itself enforces this — its Skip
  // button only renders for non-CASHIER roles).
  const showShiftPrompt =
    hasOpenShift === false && !shiftPromptDismissed;

  return (
    <>
      {showShiftPrompt && (
        <OpenShiftPrompt
          userRole={user.role}
          onOpened={async () => {
            await refreshShiftStatus();
            setShiftPromptDismissed(false);
          }}
          onSkip={() => setShiftPromptDismissed(true)}
        />
      )}
    <AppShell page={page} setPage={guardedSetPage} userRole={user.role}>
      <Suspense fallback={<div className="p-8 flex justify-center"><div className="w-8 h-8 rounded-full bg-primary animate-pulse-dot" /></div>}>
        <ErrorBoundary key={page}>
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
        </ErrorBoundary>
      </Suspense>
    </AppShell>
    </>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}
