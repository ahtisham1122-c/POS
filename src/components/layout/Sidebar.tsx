"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Menu, Milk } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { NAV_ITEMS } from "./nav-config";

type SidebarProps = {
  collapsed: boolean;
  onToggle: () => void;
};

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, logout } = useAuthStore((state) => ({
    user: state.user,
    logout: state.logout,
  }));

  if (!user) return null;

  const navItems = NAV_ITEMS.filter((item) => item.roles.includes(user.role));

  const handleLogout = () => {
    document.cookie = "nd-session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    document.cookie = "nd-role=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    logout();
    router.push("/login");
  };

  return (
    <aside
      className={cn(
        "hidden md:flex fixed left-0 top-0 z-50 h-screen flex-col border-r border-border bg-[var(--color-surface)] transition-[width] duration-200",
        collapsed ? "w-[72px]" : "w-[240px]"
      )}
    >
      <div className={cn("h-16 border-b border-border px-3 flex items-center", collapsed ? "justify-center" : "justify-between")}>
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn(
            "h-9 w-9 rounded-lg inline-flex items-center justify-center shadow-soft",
            collapsed ? "bg-primary text-white" : "bg-primary/15 text-primary"
          )}>
            {collapsed ? (
              <span className="text-[11px] font-extrabold tracking-[0.12em]">ND</span>
            ) : (
              <Milk className="h-5 w-5" />
            )}
          </div>
          {!collapsed && (
            <div className="leading-tight truncate">
              <p className="font-semibold text-sm text-text">Noon Dairy</p>
              <p className="text-[10px] uppercase tracking-widest text-text-secondary">Fresh. Fast. Trusted.</p>
            </div>
          )}
          {collapsed && <span className="sr-only">Noon Dairy</span>}
        </div>
        {!collapsed && (
          <button
            onClick={onToggle}
            className="h-9 w-9 rounded-md border border-border text-text-secondary hover:text-text hover:border-surface-3 transition-colors"
            aria-label="Collapse sidebar"
          >
            <Menu className="h-4 w-4 mx-auto" />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          onClick={onToggle}
          className="mx-auto mt-2 h-8 w-8 rounded-md border border-border text-text-secondary hover:text-text transition-colors"
          aria-label="Expand sidebar"
        >
          <Menu className="h-4 w-4 mx-auto" />
        </button>
      )}

      <nav className="mt-3 flex-1 space-y-1 px-2">
        {navItems.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex h-11 items-center rounded-lg border-l-2 px-3 text-sm transition-all duration-200",
                collapsed ? "justify-center border-transparent" : "gap-3 border-transparent",
                active
                  ? "bg-primary/15 text-text border-l-primary shadow-glow"
                  : "text-text-secondary hover:text-text hover:bg-surface-2"
              )}
              title={collapsed ? item.label : undefined}
            >
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && <span className="truncate">{item.label}</span>}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-border p-2">
        <div className={cn("rounded-lg border border-border bg-surface-2 p-2", collapsed ? "items-center" : "")}>
          <div className={cn("flex items-center", collapsed ? "justify-center" : "gap-2")}>
            <div className="h-8 w-8 rounded-full bg-accent text-black font-semibold inline-flex items-center justify-center">
              {user.name.charAt(0)}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-text">{user.name}</p>
                <p className="text-[10px] uppercase tracking-wider text-text-secondary">{user.role}</p>
              </div>
            )}
          </div>
          <button
            onClick={handleLogout}
            className={cn(
              "mt-2 inline-flex h-9 w-full items-center rounded-md border border-border text-xs text-text-secondary hover:text-danger hover:border-danger/40 transition-colors",
              collapsed ? "justify-center" : "justify-center gap-2"
            )}
            title="Logout"
          >
            <LogOut className="h-4 w-4" />
            {!collapsed && "Logout"}
          </button>
        </div>
      </div>
    </aside>
  );
}
