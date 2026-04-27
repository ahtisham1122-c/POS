import {
  LayoutDashboard,
  ShoppingCart,
  Package,
  Users,
  Wallet,
  FileText,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type UserRole = "ADMIN" | "MANAGER" | "CASHIER" | "STAFF";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
  mobile?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["ADMIN", "MANAGER", "CASHIER", "STAFF"], mobile: true },
  { label: "Point of Sale", href: "/pos", icon: ShoppingCart, roles: ["ADMIN", "MANAGER", "CASHIER"], mobile: true },
  { label: "Inventory", href: "/inventory", icon: Package, roles: ["ADMIN", "MANAGER", "STAFF"], mobile: true },
  { label: "Customers", href: "/customers", icon: Users, roles: ["ADMIN", "MANAGER", "CASHIER"], mobile: true },
  { label: "Expenses", href: "/expenses", icon: Wallet, roles: ["ADMIN", "MANAGER"] },
  { label: "Reports", href: "/reports", icon: FileText, roles: ["ADMIN", "MANAGER"], mobile: true },
  { label: "Settings", href: "/settings", icon: Settings, roles: ["ADMIN", "MANAGER"] },
];

const PAGE_TITLE_MAP: Record<string, { title: string; breadcrumb: string }> = {
  "/dashboard": { title: "Dashboard", breadcrumb: "Home / Dashboard" },
  "/pos": { title: "Point of Sale", breadcrumb: "Home / Point of Sale" },
  "/inventory": { title: "Inventory", breadcrumb: "Home / Inventory" },
  "/customers": { title: "Customers", breadcrumb: "Home / Customers" },
  "/expenses": { title: "Expenses", breadcrumb: "Home / Expenses" },
  "/reports": { title: "Reports", breadcrumb: "Home / Reports" },
  "/settings": { title: "Settings", breadcrumb: "Home / Settings" },
  "/cash-register": { title: "Cash Register", breadcrumb: "Home / Cash Register" },
};

export function resolvePageMeta(pathname: string) {
  const direct = PAGE_TITLE_MAP[pathname];
  if (direct) return direct;

  const match = Object.keys(PAGE_TITLE_MAP).find((key) => pathname.startsWith(`${key}/`));
  if (match) return PAGE_TITLE_MAP[match];

  return { title: "Noon Dairy POS", breadcrumb: "Home" };
}
