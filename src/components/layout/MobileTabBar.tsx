"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { NAV_ITEMS } from "./nav-config";

export function MobileTabBar() {
  const pathname = usePathname();
  const user = useAuthStore((state) => state.user);

  if (!user) return null;

  const tabs = NAV_ITEMS.filter((item) => item.mobile && item.roles.includes(user.role)).slice(0, 5);

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-surface px-2 py-2">
      <div className="grid grid-cols-5 gap-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={cn(
                "flex h-[52px] flex-col items-center justify-center rounded-lg text-[10px] transition-colors",
                active ? "bg-primary/20 text-text" : "text-text-secondary"
              )}
            >
              <tab.icon className={cn("mb-1 h-4 w-4", active ? "text-primary" : "text-text-secondary")} />
              <span className="truncate max-w-full px-1">{tab.label.replace("Point of Sale", "POS")}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
