"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

type AppModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
};

export function AppModal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  className,
}: AppModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("modal-enter max-h-[85vh] overflow-hidden rounded-lg border-border bg-surface p-0 text-text", className)}>
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription className="text-text-secondary">{description}</DialogDescription>}
        </DialogHeader>
        <div className="hide-scrollbar overflow-y-auto px-5 py-4">{children}</div>
        {footer && <DialogFooter className="border-t border-border px-5 py-4">{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
