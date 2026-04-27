"use client";

import {
  CircleCheck,
  Info,
  LoaderCircle,
  OctagonX,
  TriangleAlert,
} from "lucide-react";
import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

export function Toaster(props: ToasterProps) {
  return (
    <Sonner
      position="bottom-right"
      expand
      richColors
      visibleToasts={4}
      className="toaster group"
      icons={{
        success: <CircleCheck className="h-4 w-4" />,
        info: <Info className="h-4 w-4" />,
        warning: <TriangleAlert className="h-4 w-4" />,
        error: <OctagonX className="h-4 w-4" />,
        loading: <LoaderCircle className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        duration: 3000,
        classNames: {
          toast:
            "group toast rounded-lg border border-border bg-surface text-text shadow-card",
          title: "text-sm font-semibold",
          description: "text-xs text-text-secondary",
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-white h-8 rounded-md",
          cancelButton:
            "group-[.toast]:bg-surface-3 group-[.toast]:text-text h-8 rounded-md",
          success: "border-success/40",
          info: "border-info/40",
          warning: "border-warning/40",
          error: "border-danger/40",
        },
      }}
      {...props}
    />
  );
}
