import { useState } from "react";
import { CheckCircle2, ChevronRight, Store, Tag, Lock, Sparkles } from "lucide-react";
import { cn } from "../lib/utils";

const STEPS = [
  { id: 1, label: "Shop Info", icon: Store },
  { id: 2, label: "Daily Rates", icon: Tag },
  { id: 3, label: "Secure PIN", icon: Lock },
];

export default function SetupWizard() {
  const [step, setStep] = useState(1);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  const [shopName, setShopName] = useState("Gujjar Milk Shop");
  const [shopAddress, setShopAddress] = useState("");
  const [shopPhone, setShopPhone] = useState("");

  const [milkRate, setMilkRate] = useState("180");
  const [yogurtRate, setYogurtRate] = useState("220");

  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");

  const saveShopInfo = async () => {
    if (!shopName.trim()) { setError("Shop name is required."); return; }
    setError("");
    setIsSaving(true);
    try {
      await window.electronAPI?.settings?.update({
        shop_name: shopName.trim(),
        shop_address: shopAddress.trim(),
        shop_phone: shopPhone.trim(),
      });
      setStep(2);
    } catch {
      setError("Failed to save shop info.");
    } finally {
      setIsSaving(false);
    }
  };

  const saveRates = async () => {
    const milk = Number(milkRate);
    const yogurt = Number(yogurtRate);
    if (!milk || milk <= 0 || !yogurt || yogurt <= 0) {
      setError("Both rates must be greater than zero.");
      return;
    }
    setError("");
    setIsSaving(true);
    try {
      // Store rates as settings (IPC update) — rates IPC requires manager PIN which we skip during setup
      await window.electronAPI?.settings?.update({ milk_rate: milkRate, yogurt_rate: yogurtRate });
      setStep(3);
    } catch {
      setError("Failed to save rates.");
    } finally {
      setIsSaving(false);
    }
  };

  const completSetup = async () => {
    if (newPin.length < 4) { setError("PIN must be at least 4 characters."); return; }
    if (newPin !== confirmPin) { setError("PINs do not match."); return; }
    setError("");
    setIsSaving(true);
    try {
      const adminUsers = await window.electronAPI?.auth?.getUsers();
      const admin = adminUsers?.find((u: any) => u.role === "ADMIN");
      if (!admin) { setError("No admin user found."); return; }

      const result = await window.electronAPI?.auth?.setManagerPin({
        userId: admin.id,
        currentPassword: "1234",
        newPin,
      });

      if (result?.success === false) {
        setError(result?.error || "Failed to change PIN. If you already changed the PIN, proceed by entering the current PIN as both new and confirm.");
        return;
      }

      await window.electronAPI?.settings?.update({ setup_completed: "true" });
      window.location.reload();
    } catch {
      setError("Failed to complete setup.");
    } finally {
      setIsSaving(false);
    }
  };

  const skipSetup = async () => {
    await window.electronAPI?.settings?.update({ setup_completed: "true" });
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-surface-1 flex items-center justify-center p-6">
      <div className="w-full max-w-lg animate-slide-up">
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-primary/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-8 h-8 text-primary" />
          </div>
          <h1 className="text-3xl font-bold text-text-primary">First-Time Setup</h1>
          <p className="text-text-secondary mt-2">Let's get your POS ready in 3 quick steps.</p>
        </div>

        {/* Step indicators */}
        <div className="flex items-center justify-center gap-2 mb-8">
          {STEPS.map((s, i) => {
            const Icon = s.icon;
            const done = step > s.id;
            const active = step === s.id;
            return (
              <div key={s.id} className="flex items-center">
                <div className={cn(
                  "flex flex-col items-center gap-1",
                )}>
                  <div className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center transition-all",
                    done ? "bg-success text-white" :
                    active ? "bg-primary text-white shadow-glow" :
                    "bg-surface-3 text-text-secondary"
                  )}>
                    {done ? <CheckCircle2 className="w-5 h-5" /> : <Icon className="w-5 h-5" />}
                  </div>
                  <span className={cn("text-xs font-medium", active ? "text-primary" : "text-text-secondary")}>{s.label}</span>
                </div>
                {i < STEPS.length - 1 && (
                  <ChevronRight className="w-4 h-4 text-text-secondary mx-2 mt-[-14px]" />
                )}
              </div>
            );
          })}
        </div>

        <div className="card p-6 space-y-4">
          {error && (
            <div className="bg-danger/10 border border-danger/30 rounded-lg px-4 py-3 text-sm text-danger font-medium">
              {error}
            </div>
          )}

          {step === 1 && (
            <>
              <h2 className="text-xl font-bold text-text-primary">Shop Information</h2>
              <p className="text-sm text-text-secondary">This name and contact will print on every receipt.</p>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Shop Name *</label>
                <input type="text" value={shopName} onChange={e => setShopName(e.target.value)} className="input" placeholder="e.g. Gujjar Milk Shop" autoFocus />
              </div>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Address</label>
                <input type="text" value={shopAddress} onChange={e => setShopAddress(e.target.value)} className="input" placeholder="e.g. Main Market, Faisalabad" />
              </div>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Phone</label>
                <input type="text" value={shopPhone} onChange={e => setShopPhone(e.target.value)} className="input" placeholder="03XX-XXXXXXX" />
              </div>
              <button onClick={saveShopInfo} disabled={isSaving} className="btn-primary w-full h-12 text-base mt-2">
                {isSaving ? "Saving…" : "Next: Set Rates →"}
              </button>
            </>
          )}

          {step === 2 && (
            <>
              <h2 className="text-xl font-bold text-text-primary">Today's Rates</h2>
              <p className="text-sm text-text-secondary">Set today's milk and yogurt prices. You can change these daily from Settings.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-sm font-bold text-text-primary mb-1 flex items-center gap-2">
                    <span>🥛</span> Milk (Rs/kg)
                  </label>
                  <input type="number" value={milkRate} onChange={e => setMilkRate(e.target.value)} className="input text-2xl font-mono font-bold text-center py-4" min="1" autoFocus />
                </div>
                <div>
                  <label className="text-sm font-bold text-text-primary mb-1 flex items-center gap-2">
                    <span>🫙</span> Yogurt (Rs/kg)
                  </label>
                  <input type="number" value={yogurtRate} onChange={e => setYogurtRate(e.target.value)} className="input text-2xl font-mono font-bold text-center py-4" min="1" />
                </div>
              </div>
              <button onClick={saveRates} disabled={isSaving} className="btn-primary w-full h-12 text-base mt-2">
                {isSaving ? "Saving…" : "Next: Secure PIN →"}
              </button>
            </>
          )}

          {step === 3 && (
            <>
              <h2 className="text-xl font-bold text-text-primary">Set Manager PIN</h2>
              <p className="text-sm text-text-secondary">The default PIN is <strong>1234</strong>. Change it now to something only you know. This PIN approves voids, refunds, and daily rate changes.</p>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">New PIN (4+ digits)</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={newPin}
                  onChange={e => setNewPin(e.target.value)}
                  className="input font-mono text-2xl text-center tracking-widest py-4"
                  placeholder="••••"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-bold text-text-secondary uppercase mb-1 block">Confirm PIN</label>
                <input
                  type="password"
                  inputMode="numeric"
                  value={confirmPin}
                  onChange={e => setConfirmPin(e.target.value)}
                  className="input font-mono text-2xl text-center tracking-widest py-4"
                  placeholder="••••"
                />
              </div>
              <button onClick={completSetup} disabled={isSaving} className="btn-primary w-full h-12 text-base mt-2">
                {isSaving ? "Setting up…" : "Finish Setup ✓"}
              </button>
              <button onClick={skipSetup} className="w-full text-sm text-text-secondary hover:text-text-primary text-center py-2 transition-colors">
                Skip for now (keep PIN as 1234)
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
