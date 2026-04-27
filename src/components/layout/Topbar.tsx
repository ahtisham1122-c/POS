"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useIsFetching } from "@tanstack/react-query";
import { Bell, Menu, RefreshCw, Search, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuthStore } from "@/store/authStore";
import { resolvePageMeta } from "./nav-config";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type TopbarProps = {
  onSidebarToggle: () => void;
};

function formatDateTime(now: Date) {
  return now.toLocaleString("en-PK", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function Topbar({ onSidebarToggle }: TopbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const isFetching = useIsFetching();
  const { user, logout } = useAuthStore((state) => ({
    user: state.user,
    logout: state.logout,
  }));
  const [now, setNow] = useState(new Date());
  const [isOnline, setIsOnline] = useState(true);
  const queuedCount = 0;

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const intervalId = window.setInterval(() => setNow(new Date()), 30_000);
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const meta = resolvePageMeta(pathname);

  const sync = useMemo(() => {
    if (!isOnline) {
      return {
        label: "Offline",
        detail: `Offline — ${queuedCount} queued`,
        dot: "bg-danger",
        text: "text-danger",
        icon: WifiOff,
      };
    }
    if (isFetching > 0) {
      return {
        label: "Syncing",
        detail: `Syncing ${isFetching} item${isFetching > 1 ? "s" : ""}...`,
        dot: "bg-warning animate-pulse-dot",
        text: "text-warning",
        icon: RefreshCw,
      };
    }
      return {
        label: "Live",
        detail: "All Synced",
      dot: "bg-success animate-pulse-dot",
      text: "text-success",
      icon: Wifi,
    };
  }, [isOnline, isFetching]);

  const handleLogout = () => {
    document.cookie = "nd-session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    document.cookie = "nd-role=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
    logout();
    router.push("/login");
  };

  if (!user) return null;

  const SyncIcon = sync.icon;

  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-surface/95 backdrop-blur">
      <div className="grid h-full grid-cols-[auto_1fr_auto] items-center gap-3 px-3 md:px-5">
        <div className="flex items-center gap-2 min-w-0">
          <button
            onClick={onSidebarToggle}
            className="hidden md:inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-secondary hover:text-text hover:bg-surface-2 transition-colors"
            aria-label="Toggle sidebar"
          >
            <Menu className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h1 className="truncate text-sm font-semibold text-text">{meta.title}</h1>
            <p className="truncate text-[10px] text-text-secondary">{meta.breadcrumb}</p>
          </div>
        </div>

        <div className="hidden lg:flex items-center justify-center px-3">
          <label className="flex h-10 w-full max-w-xl items-center gap-2 rounded-lg border border-border bg-surface-2 px-3">
            <Search className="h-4 w-4 text-text-secondary" />
            <input
              type="text"
              placeholder="Search products, customers, bills"
              className="h-full w-full bg-transparent text-sm text-text outline-none placeholder:text-text-secondary"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-9 items-center gap-2 rounded-full border border-border px-3 text-xs">
                <span className={cn("h-2 w-2 rounded-full", sync.dot)} />
                <span className={cn("font-semibold", sync.text)}>{sync.label}</span>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64 border-border bg-surface-2 text-text">
              <DropdownMenuLabel className="text-xs uppercase tracking-wider text-text-secondary">Sync Status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <div className="px-2 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <SyncIcon className={cn("h-4 w-4", sync.text, sync.label === "Syncing" && "animate-spin")} />
                  <span className="font-medium">{sync.detail}</span>
                </div>
                <p className="mt-2 text-xs text-text-secondary">
                  Queued items sync automatically when connection is stable.
                </p>
              </div>
            </DropdownMenuContent>
          </DropdownMenu>

          <button className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-border text-text-secondary hover:text-text hover:bg-surface-2 transition-colors">
            <Bell className="h-4 w-4" />
          </button>

          <span className="hidden md:inline text-xs font-medium text-text-secondary">{formatDateTime(now)}</span>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="inline-flex h-9 items-center rounded-md border border-border px-3 text-xs font-semibold text-text hover:bg-surface-2">
                {user.name}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 border-border bg-surface-2 text-text">
              <DropdownMenuLabel>Account</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-text-secondary">{user.role}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-danger focus:text-danger">
                Logout
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  );
}
