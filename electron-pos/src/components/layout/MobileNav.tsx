import { LayoutDashboard, ShoppingCart, Package, CreditCard, MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/utils";
import type { PageId } from "../../App";

type MobileNavProps = {
  page: string;
  setPage: (page: PageId) => void;
};

export function MobileNav({ page, setPage }: MobileNavProps) {
  const items = [
    { id: "dashboard", icon: LayoutDashboard, label: "Dash" },
    { id: "pos", icon: ShoppingCart, label: "POS" },
    { id: "inventory", icon: Package, label: "Stock" },
    { id: "khata", icon: CreditCard, label: "Khata" },
    { id: "more", icon: MoreHorizontal, label: "More" },
  ];

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface-2 border-t border-surface-4 h-16 flex items-center justify-around px-2 z-50">
      {items.map((item) => {
        const Icon = item.icon;
        const isActive = page === item.id || (item.id === "more" && ["suppliers", "customers", "returns", "receipt-audit", "shifts", "backup", "reports", "expenses", "settings"].includes(page));
        return (
          <button
            key={item.id}
            onClick={() => {
              if (item.id === "more") setPage("settings");
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
