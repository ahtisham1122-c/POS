import {
  LayoutDashboard, ShoppingCart, Package, Users, Receipt,
  BarChart3, Settings, LogOut, ChevronLeft, ChevronRight, CreditCard, RotateCcw, ClipboardCheck, Clock, DatabaseBackup, Truck, Stethoscope
} from "lucide-react";
import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import type { PageId } from "../../App";

type SidebarProps = {
  page: PageId;
  setPage: (p: PageId) => void;
  collapsed: boolean;
  setCollapsed: (c: boolean) => void;
};

export function Sidebar({ page, setPage, collapsed, setCollapsed }: SidebarProps) {
  const [user, setUser] = useState<any>(null);

  useEffect(() => {
    window.electronAPI?.auth?.getMe().then(u => setUser(u));
  }, []);
  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
    { id: "pos", label: "Point of Sale", icon: ShoppingCart },
    { id: "inventory", label: "Inventory", icon: Package },
    { id: "suppliers", label: "Suppliers", icon: Truck },
    { id: "customers", label: "Customers", icon: Users },
    { id: "khata", label: "Khata / Ledger", icon: CreditCard },
    { id: "returns", label: "Returns", icon: RotateCcw },
    { id: "receipt-audit", label: "Receipt Audit", icon: ClipboardCheck },
    { id: "shifts", label: "Shifts", icon: Clock },
    { id: "cash-register", label: "Cash Register", icon: Receipt },
    { id: "backup", label: "Backup", icon: DatabaseBackup },
    { id: "test-center", label: "Test Center", icon: Stethoscope },
    { id: "expenses", label: "Expenses", icon: Receipt },
    { id: "reports", label: "Reports", icon: BarChart3 },
    { id: "settings", label: "Settings", icon: Settings },
  ];

  return (
    <aside
      className={cn(
        "hidden md:flex flex-col bg-surface-2 border-r border-surface-4 transition-all duration-300 shrink-0",
        collapsed ? "w-[72px]" : "w-60"
      )}
    >
      <div className="flex items-center gap-3 p-4 border-b border-surface-4 h-16 shrink-0">
        <img
          src="./brand/gujjar-logo-square.png"
          alt="Gujjar Milk Shop"
          className="w-10 h-10 rounded-full bg-white object-cover shrink-0 shadow-glow border border-white/20"
        />
        <div className="hidden">
          <span className="text-white font-bold text-lg">🐄</span>
        </div>
        {!collapsed && (
          <div className="flex-1 overflow-hidden">
            <h1 className="font-bold text-lg whitespace-nowrap text-text-primary">Gujjar Milk</h1>
          </div>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto py-4 px-2 flex flex-col gap-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = page === item.id;

          return (
            <button
              key={item.id}
              onClick={() => setPage(item.id as PageId)}
              title={collapsed ? item.label : undefined}
              className={cn(
                "flex items-center gap-3 px-3 py-3 rounded-md transition-colors",
                isActive
                  ? "bg-primary/20 text-primary border-l-2 border-primary"
                  : "text-text-secondary hover:bg-surface-3 hover:text-text-primary border-l-2 border-transparent",
                item.id === "pos" && !isActive && "hover:border-accent hover:text-accent",
                item.id === "khata" && !isActive && "hover:border-info hover:text-info"
              )}
            >
              <Icon className="w-5 h-5 shrink-0" />
              {!collapsed && <span className="font-medium whitespace-nowrap">{item.label}</span>}
            </button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-surface-4 flex flex-col gap-4">
        {user && (
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-surface-3 flex items-center justify-center shrink-0 border border-surface-4 font-bold">
              {user.name?.charAt(0).toUpperCase()}
            </div>
            {!collapsed && (
              <div className="flex-1 overflow-hidden">
                <p className="text-sm font-semibold text-text-primary truncate">{user.name}</p>
                <span className="badge badge-info mt-1 uppercase">{user.role}</span>
              </div>
            )}
          </div>
        )}

        <div className="flex items-center justify-between">
          <button
            onClick={() => setCollapsed(!collapsed)}
            className="w-10 h-10 rounded-md flex items-center justify-center text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors"
          >
            {collapsed ? <ChevronRight className="w-5 h-5" /> : <ChevronLeft className="w-5 h-5" />}
          </button>

          {!collapsed && (
            <button onClick={() => window.location.reload()} className="flex items-center gap-2 text-sm text-danger hover:bg-danger/10 px-3 py-2 rounded-md transition-colors font-medium">
              <LogOut className="w-4 h-4" />
              Log Out
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
