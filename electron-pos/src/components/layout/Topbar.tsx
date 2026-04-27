import { useState, useEffect } from "react";
import { Search, Bell } from "lucide-react";
import { SyncStatusBadge } from "./SyncStatusBadge";
import { format } from "date-fns";

type TopbarProps = {
  pageTitle: string;
};

export function Topbar({ pageTitle }: TopbarProps) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <header className="h-14 bg-surface-2 border-b border-surface-4 flex items-center justify-between px-4 shrink-0">
      <div className="flex items-center gap-4 w-1/3">
        <h2 className="text-lg font-semibold text-text-primary">{pageTitle}</h2>
      </div>

      <div className="flex-1 max-w-md mx-4">
        <div className="relative group">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary group-focus-within:text-primary transition-colors" />
          <input 
            type="text" 
            placeholder="Search anything... (Ctrl+K)" 
            className="w-full bg-surface-3 border border-surface-4 text-sm text-text-primary rounded-md pl-10 pr-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none transition-all"
          />
          <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
            <kbd className="hidden sm:inline-block bg-surface-4 border border-surface-4 rounded px-1.5 text-[10px] font-mono text-text-secondary">Ctrl</kbd>
            <kbd className="hidden sm:inline-block bg-surface-4 border border-surface-4 rounded px-1.5 text-[10px] font-mono text-text-secondary">K</kbd>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-4 w-1/3">
        <SyncStatusBadge />
        
        <div className="hidden lg:flex items-center gap-1 text-sm text-text-secondary font-mono border border-surface-4 bg-surface-3 rounded-full px-3 py-1.5">
          <span>{format(now, "dd MMM")}</span>
          <span className="opacity-50">·</span>
          <span>{format(now, "hh:mm a")}</span>
        </div>

        <button className="relative w-9 h-9 flex items-center justify-center rounded-full hover:bg-surface-3 transition-colors text-text-secondary hover:text-text-primary">
          <Bell className="w-5 h-5" />
          <span className="absolute top-2 right-2.5 w-2 h-2 bg-accent rounded-full border-2 border-surface-2" />
        </button>
      </div>
    </header>
  );
}
