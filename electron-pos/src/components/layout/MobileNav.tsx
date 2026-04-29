import { LayoutDashboard, ShoppingCart, Package, CreditCard, MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/utils";
import { canAccessPage } from "../../App";
import type { PageId } from "../../App";

type MobileNavProps = {
  page: string;
  setPage: (page: PageId) => void;
  userRole?: string;
};

export function MobileNav({ page, setPage, userRole }: MobileNavProps) {
  const allItems: Array<{ id: PageId | "more"; icon: any; label: string }> = [
    { id: "dashboard", icon: LayoutDashboard, label: "Dash" },
    { id: "pos", icon: ShoppingCart, label: "POS" },
    { id: "inventory", icon: Package, label: "Stock" },
    { id: "khata", icon: CreditCard, label: "Khata" },
    { id: "more", icon: MoreHorizontal, label: "More" },
  ];
  const items = userRole
    ? allItems.filter(item => item.id === "more" || canAccessPage(userRole, item.id as PageId))
    : allItems;
  // Pick a "More" target the user can reach
  const moreTarget: PageId = userRole && !canAccessPage(userRole, "settings")
    ? (canAccessPage(userRole, "shifts") ? "shifts" : "customers")
    : "settings";

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface-2 border-t border-surface-4 h-16 flex items-center justify-around px-2 z-50">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = page === item.id || (item.id === "more" && ["suppliers", "customers", "returns", "receipt-audit", "shifts", "backup", "test-center", "reports", "expenses", "settings"].includes(page));
        return (
          <button
            key={item.id}
            onClick={() => {
              if (item.id === "more") setPage(moreTarget);
              else setPage(item.id as PageId);
            }}
            className={cn(
              "flex flex-col items-center justify-center w-16 h-14 rounded-lg transition-colors",
              isActive ? "text-primary" : "text-text-secondary hover:bg-surface-3 hover:text-text-primary"
            )}
          >
            <Icon className="w-6 h-6 mb-1" />
            <span className="text-[10px] font-medium">{item.label}</span>
          </button>
        );
      })}
    </nav>
  );
}
