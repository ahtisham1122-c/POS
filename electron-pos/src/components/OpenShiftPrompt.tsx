import { useEffect, useState } from "react";
import { PlayCircle, Sun, X } from "lucide-react";

interface Props {
  // Called after the shift is successfully opened so the parent can refresh
  // its current-shift state and dismiss the prompt.
  onOpened: () => void;
  // Called when the user dismisses the prompt without opening a shift.
  // Admins/managers may need to access Reports/Settings/Backup without opening
  // a shift first, so we always allow skipping.
  onSkip: () => void;
  // The role of the currently-logged-in user. Cashiers only get to skip if
  // they really insist — we show a strong recommendation.
  userRole?: string;
}

export function OpenShiftPrompt({ onOpened, onSkip, userRole }: Props) {
  const [openingCash, setOpeningCash] = useState("0");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Focus the opening cash field as soon as the prompt mounts so the
    // cashier can just type the number and hit Enter.
    const t = setTimeout(() => {
      const el = document.getElementById("open-shift-prompt-cash") as HTMLInputElement | null;
      el?.focus();
      el?.select();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  async function handleOpen(confirmAfterMidnightOpen = false) {
    setError(null);
    const cash = Number(openingCash || 0);
    if (!Number.isFinite(cash) || cash < 0) {
      setError("Opening cash must be zero or more.");
      return;
    }
    setSubmitting(true);
    try {
      const result = await window.electronAPI?.shifts?.open({
        openingCash: cash,
        notes,
        confirmAfterMidnightOpen,
      });
      if (!result?.success) {
        if (result?.requiresPreviousShiftConfirmation) {
          const proceed = window.confirm(
            (result?.error || "A previous shift may still need attention.") +
            "\n\nClick OK to open a new shift now."
          );
          if (proceed) {
            await handleOpen(true);
            return;
          }
          setError("Open shift cancelled.");
          return;
        }
        setError(result?.error || "Failed to open shift.");
        return;
      }
      onOpened();
    } catch (err: any) {
      setError(err?.message || "Failed to open shift.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleOpen();
    }
  }

  const isCashier = (userRole || "").toUpperCase() === "CASHIER";

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-surface-1 border border-surface-4 rounded-2xl shadow-float w-full max-w-md overflow-hidden">
        <div className="bg-gradient-to-br from-primary/20 to-primary/5 px-6 py-5 border-b border-surface-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center">
              <Sun className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-text-primary">Good morning — open today's shift</h2>
              <p className="text-sm text-text-secondary mt-0.5">No shift is open. Open one to start ringing up sales.</p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="text-sm font-semibold text-text-primary">Opening Cash in Drawer</label>
            <input
              id="open-shift-prompt-cash"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              onKeyDown={handleKeyDown}
              type="number"
              inputMode="decimal"
              min={0}
              className="input mt-2 text-3xl font-mono text-center"
              disabled={submitting}
            />
            <p className="text-xs text-text-secondary mt-1.5">Count the cash currently in the drawer. This is the starting balance.</p>
          </div>

          <div>
            <label className="text-sm font-semibold text-text-primary">Notes (optional)</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="input mt-2 min-h-16 resize-none"
              placeholder="Example: Morning shift opened by Ahmed."
              disabled={submitting}
            />
          </div>

          {error && (
            <div className="rounded-xl border border-danger/30 bg-danger/10 text-danger px-4 py-3 text-sm font-medium">
              {error}
            </div>
          )}

          <button
            onClick={() => handleOpen()}
            disabled={submitting}
            className="btn-primary w-full h-14 flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <PlayCircle className="w-5 h-5" />
            {submitting ? "Opening Shift..." : "Open Shift Now"}
          </button>

          {!isCashier && (
            <button
              onClick={onSkip}
              disabled={submitting}
              className="w-full h-10 flex items-center justify-center gap-2 text-sm text-text-secondary hover:text-text-primary transition-colors"
            >
              <X className="w-4 h-4" />
              Skip for now (admin / reports access only)
            </button>
          )}

          {isCashier && (
            <p className="text-center text-xs text-text-secondary">
              You must open a shift before you can make any sales.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
