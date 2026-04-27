import React, { useState, useEffect } from "react";
import { AlertCircle, CheckCircle2, Info, AlertTriangle, X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

// --- Toast ---
export function Toast({ type, message, onClose }: { type: 'success'|'error'|'warning'|'info', message: string, onClose: () => void }) {
  const Icon = type === 'success' ? CheckCircle2 : type === 'error' ? AlertCircle : type === 'warning' ? AlertTriangle : Info;
  return (
    <div className={cn(
      "fixed bottom-4 right-4 flex items-center gap-3 px-4 py-3 rounded-lg shadow-float animate-slide-in-right z-[100]",
      type === 'success' ? "bg-success/90 text-white" :
      type === 'error' ? "bg-danger/90 text-white" :
      type === 'warning' ? "bg-warning/90 text-white" :
      "bg-info/90 text-white"
    )}>
      <Icon className="w-5 h-5" />
      <span className="font-medium text-sm">{message}</span>
      <button onClick={onClose} className="ml-4 opacity-70 hover:opacity-100"><X className="w-4 h-4" /></button>
    </div>
  );
}

// --- ConfirmDialog ---
export function ConfirmDialog({ isOpen, title, description, onConfirm, onCancel, isDanger }: any) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
      <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-sm p-6 border border-surface-4 text-center">
        {isDanger ? <AlertTriangle className="w-12 h-12 text-danger mx-auto mb-4" /> : <Info className="w-12 h-12 text-primary mx-auto mb-4" />}
        <h3 className="text-xl font-bold mb-2 text-text-primary">{title}</h3>
        <p className="text-text-secondary text-sm mb-6">{description}</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
          <button onClick={onConfirm} className={cn("flex-1 text-white font-medium rounded-lg", isDanger ? "bg-danger hover:bg-danger/90" : "bg-primary hover:bg-primary-light")}>
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// --- LoadingSkeleton ---
export function LoadingSkeleton({ variant = "text" }: { variant?: "text" | "card" | "circle" | "table-row" }) {
  return (
    <div className={cn(
      "animate-shimmer bg-gradient-to-r from-surface-3 via-surface-4 to-surface-3 bg-[length:200%_100%]",
      variant === "text" && "h-4 w-3/4 rounded",
      variant === "card" && "h-32 w-full rounded-xl",
      variant === "circle" && "w-12 h-12 rounded-full",
      variant === "table-row" && "h-12 w-full rounded"
    )} />
  );
}

// --- EmptyState ---
export function EmptyState({ icon: Icon, title, description, action }: any) {
  return (
    <div className="flex flex-col items-center justify-center p-8 text-center text-text-secondary">
      <Icon className="w-16 h-16 opacity-30 mb-4" />
      <h3 className="text-lg font-bold text-text-primary mb-1">{title}</h3>
      <p className="text-sm mb-4 max-w-sm">{description}</p>
      {action && <button onClick={action.onClick} className="btn-primary">{action.label}</button>}
    </div>
  );
}

// --- StatCard ---
export function StatCard({ icon: Icon, label, value, trend, trendUp }: any) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-3 mb-2">
        <Icon className="w-5 h-5 text-primary opacity-70" />
        <p className="text-xs text-text-secondary font-medium uppercase tracking-wider">{label}</p>
      </div>
      <p className="text-2xl font-bold font-mono text-text-primary animate-count-up">{value}</p>
      {trend && (
        <p className={cn("text-xs mt-1 flex items-center gap-1", trendUp ? "text-success" : "text-danger")}>
          {trendUp ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />} {trend}
        </p>
      )}
    </div>
  );
}

// --- Modal ---
export function Modal({ isOpen, onClose, title, children, footer }: any) {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
      <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-lg overflow-hidden border border-surface-4">
        <div className="p-4 border-b border-surface-4 flex justify-between items-center bg-surface-3">
          <h3 className="font-semibold text-lg">{title}</h3>
          <button onClick={onClose} className="text-text-secondary hover:text-text-primary"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-6">{children}</div>
        {footer && <div className="p-4 bg-surface-3 border-t border-surface-4">{footer}</div>}
      </div>
    </div>
  );
}
