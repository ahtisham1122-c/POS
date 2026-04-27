"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Sidebar } from "@/components/layout/Sidebar";
import { Topbar } from "@/components/layout/Topbar";
import { MobileTabBar } from "@/components/layout/MobileTabBar";
import { useAuthStore } from "@/store/authStore";

const SIDEBAR_STORAGE_KEY = "nd-sidebar-collapsed";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const { isAuthenticated, hydrated } = useAuthStore((state) => ({
    isAuthenticated: state.isAuthenticated,
    hydrated: state.hydrated,
  }));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  useEffect(() => {
    const saved = window.localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (saved === "1") setSidebarCollapsed(true);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarCollapsed ? "1" : "0");
  }, [sidebarCollapsed]);

  useEffect(() => {
    if (!hydrated) return;
    if (!isAuthenticated) {
      document.cookie = "nd-session=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
      document.cookie = "nd-role=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;";
      router.replace("/login");
    }
  }, [hydrated, isAuthenticated, router]);

  if (!hydrated) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg text-text-secondary">
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) return null;

  return (
    <div className="min-h-screen bg-bg text-text">
      <Sidebar
        collapsed={sidebarCollapsed}
        onToggle={() => setSidebarCollapsed((prev) => !prev)}
      />

      <div className={sidebarCollapsed ? "md:ml-[72px]" : "md:ml-[240px]"}>
        <Topbar onSidebarToggle={() => setSidebarCollapsed((prev) => !prev)} />
        <main className="min-h-[calc(100vh-56px)] p-4 md:p-6 pb-20 md:pb-6 page-enter">
          {children}
        </main>
      </div>

      <MobileTabBar />
    </div>
  );
}
