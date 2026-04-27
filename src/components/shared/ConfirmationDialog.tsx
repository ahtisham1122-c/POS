"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AppModal } from "./AppModal";

type ConfirmationDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: "danger" | "warning";
  onConfirm: () => void;
  loading?: boolean;
};

export function ConfirmationDialog({
  open,
  onOpenChange,
  title,
  message,
  confirmText = "Confirm",
  cancelText = "Cancel",
  variant = "danger",
  onConfirm,
  loading = false,
}: ConfirmationDialogProps) {
  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={message}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} className="h-11">
            {cancelText}
          </Button>
          <Button
            type="button"
            onClick={onConfirm}
            className="h-11"
            variant={variant === "danger" ? "destructive" : "default"}
            disabled={loading}
          >
            {loading ? "Please wait..." : confirmText}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-3 rounded-lg border border-border bg-surface-2 p-3">
        <span
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full ${
            variant === "danger" ? "bg-danger/15 text-danger" : "bg-warning/15 text-warning"
          }`}
        >
          <AlertTriangle className="h-5 w-5" />
        </span>
        <div>
          <p className="text-sm font-medium text-text">{title}</p>
          <p className="text-xs text-text-secondary">{message}</p>
        </div>
      </div>
    </AppModal>
  );
}
