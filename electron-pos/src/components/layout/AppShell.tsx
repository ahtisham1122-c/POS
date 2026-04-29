import { useState } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { MobileNav } from "./MobileNav";
import type { PageId } from "../../App";

type AppShellProps = {
  page: PageId;
  setPage: (p: PageId) => void;
  children: React.ReactNode;
  userRole?: string;
};

const pageTitles: Record<PageId, string> = {
  dashboard: "Dashboard",
  pos: "Point of Sale",
  inventory: "Inventory",
  suppliers: "Suppliers & Milk Purchase",
  customers: "Customers",
  khata: "Khata — Credit Ledger",
  returns: "Returns & Refunds",
  "receipt-audit": "Receipt Audit",
  shifts: "Shift Management",
  backup: "Backup & Restore",
  "test-center": "System Health / Test Center",
  expenses: "Expenses",
  reports: "Reports",
  settings: "Settings",
  "cash-register": "Cash Register",
  employees: "Employees & Payroll",
  deliveries: "Milk Deliveries",
};

export function AppShell({ page, setPage, children, userRole }: AppShellProps) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Sidebar and topbar visibility
  const isPos = false; // Allow sidebar/topbar everywhere for navigation

  return (
    <div className="flex h-screen overflow-hidden bg-surface-1">
      {!isPos && (
        <Sidebar
          page={page}
          setPage={setPage}
          collapsed={sidebarCollapsed}
          setCollapsed={setSidebarCollapsed}
          userRole={userRole}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
        {!isPos && <Topbar pageTitle={pageTitles[page]} />}

        <main className={`flex-1 overflow-auto bg-surface-1 relative ${!isPos ? 'pb-16 md:pb-0' : ''}`}>
          {children}
        </main>
      </div>

      {!isPos && <MobileNav page={page} setPage={setPage} userRole={userRole} />}
    </div>
  );
}
