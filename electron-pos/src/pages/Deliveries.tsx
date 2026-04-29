import { useEffect, useState, useCallback } from "react";
import {
  Bike, Plus, ArrowUpFromLine, ArrowDownToLine, CheckCircle2,
  AlertTriangle, X, Milk, MapPin, RefreshCw, History, ChevronRight
} from "lucide-react";
import { cn } from "../lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toKg(v: number) {
  return `${Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 2 })} kg`;
}

function formatTime(iso: string) {
  if (!iso) return "-";
  return new Date(iso).toLocaleTimeString("en-PK", { hour: "2-digit", minute: "2-digit" });
}

function formatDate(d: string) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

type Msg = { type: "success" | "error"; text: string } | null;

// ─── Summary bar card ─────────────────────────────────────────────────────────

function SumCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className={cn("rounded-lg p-4 flex flex-col gap-1 border", color)}>
      <span className="text-xs uppercase tracking-wide opacity-70">{label}</span>
      <span className="text-2xl font-bold">{value}</span>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Deliveries() {
  const [tab, setTab] = useState<"today" | "riders" | "history">("today");
  const [riders, setRiders] = useState<any[]>([]);
  const [overview, setOverview] = useState<any>({ sessions: [], totalPickup: 0, totalReturn: 0, totalDelivered: 0, activeCount: 0, completedCount: 0 });
  const [milkStock, setMilkStock] = useState<{ stock: number; unit: string }>({ stock: 0, unit: "kg" });
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<Msg>(null);

  // Selected rider session (today tab)
  const [activeSession, setActiveSession] = useState<any>(null);
  const [selectedRiderId, setSelectedRiderId] = useState<string | null>(null);

  // Entry forms
  const [pickupQty, setPickupQty] = useState("");
  const [pickupNotes, setPickupNotes] = useState("");
  const [returnQty, setReturnQty] = useState("");
  const [returnNotes, setReturnNotes] = useState("");
  const [completeNotes, setCompleteNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Rider management
  const [showAddRider, setShowAddRider] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [riderForm, setRiderForm] = useState({ name: "", phone: "", area: "", notes: "" });
  const [editingRider, setEditingRider] = useState<any>(null);

  const flash = (type: "success" | "error", text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3500);
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [riderData, overviewData, stockData] = await Promise.all([
      window.electronAPI?.riders?.getAll(showInactive),
      window.electronAPI?.deliveries?.getTodayOverview(),
      window.electronAPI?.deliveries?.getMilkStock(),
    ]);
    setRiders(riderData || []);
    setOverview(overviewData || { sessions: [], totalPickup: 0, totalReturn: 0, totalDelivered: 0, activeCount: 0, completedCount: 0 });
    setMilkStock(stockData || { stock: 0, unit: "kg" });
    setLoading(false);
  }, [showInactive]);

  const loadHistory = useCallback(async () => {
    const data = await window.electronAPI?.deliveries?.getAllHistory(60);
    setHistory(data || []);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);
  useEffect(() => { if (tab === "history") loadHistory(); }, [tab, loadHistory]);

  // ── Open a rider's session ───────────────────────────────────────────────

  async function openRiderSession(riderId: string) {
    setSelectedRiderId(riderId);
    const res = await window.electronAPI?.deliveries?.getOrCreateSession(riderId);
    if (res?.success) {
      setActiveSession(res.session);
      setPickupQty(""); setReturnQty("");
    } else {
      flash("error", res?.error || "Failed to load session");
    }
  }

  async function refreshSession() {
    if (!activeSession?.id) return;
    const updated = await window.electronAPI?.deliveries?.getSession(activeSession.id);
    if (updated) setActiveSession(updated);
    const stockData = await window.electronAPI?.deliveries?.getMilkStock();
    if (stockData) setMilkStock(stockData);
    loadAll();
  }

  // ── Add Pickup ───────────────────────────────────────────────────────────

  async function handlePickup() {
    if (!activeSession || !pickupQty || Number(pickupQty) <= 0) return flash("error", "Enter a valid quantity");
    setSubmitting(true);
    const res = await window.electronAPI?.deliveries?.addPickup({
      sessionId: activeSession.id,
      riderId: activeSession.rider_id,
      quantity: Number(pickupQty),
      notes: pickupNotes,
    });
    setSubmitting(false);
    if (res?.success) {
      flash("success", `Pickup recorded — ${toKg(Number(pickupQty))} deducted from milk stock`);
      setPickupQty(""); setPickupNotes("");
      await refreshSession();
    } else {
      flash("error", res?.error || "Failed to record pickup");
    }
  }

  // ── Add Return ───────────────────────────────────────────────────────────

  async function handleReturn() {
    if (!activeSession || !returnQty || Number(returnQty) <= 0) return flash("error", "Enter a valid quantity");
    setSubmitting(true);
    const res = await window.electronAPI?.deliveries?.addReturn({
      sessionId: activeSession.id,
      riderId: activeSession.rider_id,
      quantity: Number(returnQty),
      notes: returnNotes,
    });
    setSubmitting(false);
    if (res?.success) {
      flash("success", `Return recorded — ${toKg(Number(returnQty))} added back to milk stock`);
      setReturnQty(""); setReturnNotes("");
      await refreshSession();
    } else {
      flash("error", res?.error || "Failed to record return");
    }
  }

  // ── Complete Session ─────────────────────────────────────────────────────

  async function handleComplete() {
    if (!activeSession) return;
    setSubmitting(true);
    const res = await window.electronAPI?.deliveries?.completeSession(activeSession.id, completeNotes);
    setSubmitting(false);
    if (res?.success) {
      flash("success", `Delivery completed — ${toKg(res.totals.totalDelivered)} delivered today`);
      setCompleteNotes("");
      await refreshSession();
      await loadAll();
    } else {
      flash("error", res?.error || "Failed to complete session");
    }
  }

  // ── Add Rider ────────────────────────────────────────────────────────────

  async function handleAddRider() {
    if (!riderForm.name.trim()) return flash("error", "Rider name is required");
    const res = editingRider
      ? await window.electronAPI?.riders?.update(editingRider.id, riderForm)
      : await window.electronAPI?.riders?.create(riderForm);
    if (res?.success) {
      flash("success", editingRider ? "Rider updated" : "Rider added");
      setShowAddRider(false);
      setEditingRider(null);
      setRiderForm({ name: "", phone: "", area: "", notes: "" });
      loadAll();
    } else {
      flash("error", res?.error || "Failed");
    }
  }

  // ─────────────────────────────────────────────────────────────────────────────

  // Find selected rider name
  const selectedRider = riders.find(r => r.id === selectedRiderId);

  return (
    <div className="flex flex-col h-full bg-surface-1 overflow-hidden">

      {/* ── Top Summary Bar ───────────────────────────────────────────────── */}
      <div className="bg-surface-2 border-b border-surface-4 px-6 py-4">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-text-primary flex items-center gap-2">
            <Bike className="w-6 h-6 text-primary" /> Milk Deliveries
          </h1>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 bg-surface-3 rounded-lg px-3 py-2 text-sm">
              <Milk className="w-4 h-4 text-info" />
              <span className="text-text-secondary">Milk in stock:</span>
              <span className="font-bold text-text-primary">{toKg(milkStock.stock)}</span>
            </div>
            <button onClick={loadAll} className="btn btn-ghost btn-sm">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-4 gap-3">
          <SumCard label="Total Dispatched Today" value={toKg(overview.totalPickup)} color="bg-info/10 border-info/30 text-info" />
          <SumCard label="Total Returned" value={toKg(overview.totalReturn)} color="bg-warning/10 border-warning/30 text-warning" />
          <SumCard label="Total Delivered" value={toKg(overview.totalDelivered)} color="bg-success/10 border-success/30 text-success" />
          <SumCard label="Active / Completed" value={`${overview.activeCount} / ${overview.completedCount}`} color="bg-surface-3 border-surface-4 text-text-primary" />
        </div>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────────────── */}
      <div className="flex border-b border-surface-4 bg-surface-2 px-6 gap-1">
        {(["today", "riders", "history"] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              "px-5 py-3 text-sm font-medium capitalize border-b-2 -mb-px transition-colors",
              tab === t ? "border-primary text-primary" : "border-transparent text-text-secondary hover:text-text-primary"
            )}
          >
            {t === "today" ? "Today's Deliveries" : t === "riders" ? "Manage Riders" : "History"}
          </button>
        ))}
      </div>

      {/* ── Tab Content ──────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* ═══════════════════════════ TODAY TAB ═══════════════════════════ */}
        {tab === "today" && (
          <>
            {/* Rider list panel */}
            <div className="w-64 shrink-0 border-r border-surface-4 bg-surface-2 overflow-y-auto">
              <div className="p-3 border-b border-surface-4 text-xs text-text-secondary uppercase tracking-wide font-semibold">
                Select Rider
              </div>
              {riders.length === 0 ? (
                <div className="p-6 text-center text-text-secondary text-sm">No riders yet — add one in the Riders tab</div>
              ) : (
                riders.map(rider => {
                  const session = overview.sessions.find((s: any) => s.rider_id === rider.id);
                  return (
                    <button
                      key={rider.id}
                      onClick={() => openRiderSession(rider.id)}
                      className={cn(
                        "w-full text-left px-4 py-3 border-b border-surface-4 hover:bg-surface-3 transition-colors flex items-center justify-between",
                        selectedRiderId === rider.id && "bg-primary/10 border-l-2 border-l-primary"
                      )}
                    >
                      <div>
                        <p className="font-semibold text-text-primary text-sm">{rider.name}</p>
                        {rider.area && <p className="text-xs text-text-secondary flex items-center gap-1"><MapPin className="w-3 h-3" />{rider.area}</p>}
                        {session && (
                          <span className={cn("text-xs font-medium mt-1 block", session.status === "COMPLETED" ? "text-success" : "text-warning")}>
                            {session.status === "COMPLETED"
                              ? `Done — ${toKg(session.total_delivered)}`
                              : `Active — ${toKg(session.total_pickup)} out`}
                          </span>
                        )}
                      </div>
                      <ChevronRight className="w-4 h-4 text-text-secondary shrink-0" />
                    </button>
                  );
                })
              )}
            </div>

            {/* Session panel */}
            <div className="flex-1 overflow-y-auto p-6">
              {!activeSession ? (
                <div className="h-full flex items-center justify-center text-text-secondary flex-col gap-3">
                  <Bike className="w-12 h-12 opacity-30" />
                  <p>Select a rider to manage their delivery</p>
                </div>
              ) : (
                <div className="max-w-2xl mx-auto space-y-5">

                  {/* Session header */}
                  <div className="flex items-center justify-between">
                    <div>
                      <h2 className="text-xl font-bold text-text-primary">{selectedRider?.name}</h2>
                      <p className="text-sm text-text-secondary">
                        {selectedRider?.area && <><MapPin className="w-3 h-3 inline mr-1" />{selectedRider.area} · </>}
                        {activeSession.status === "COMPLETED"
                          ? <span className="text-success font-medium">Deliveries Completed</span>
                          : <span className="text-warning font-medium">In Progress</span>
                        }
                      </p>
                    </div>
                    <button onClick={refreshSession} className="btn btn-ghost btn-sm"><RefreshCw className="w-4 h-4" /></button>
                  </div>

                  {/* Live summary */}
                  <div className="grid grid-cols-3 gap-3">
                    <div className="bg-info/10 border border-info/30 rounded-lg p-4 text-center">
                      <p className="text-xs text-info/70 uppercase mb-1">Picked Up</p>
                      <p className="text-2xl font-bold text-info">{toKg(activeSession.total_pickup)}</p>
                    </div>
                    <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 text-center">
                      <p className="text-xs text-warning/70 uppercase mb-1">Returned</p>
                      <p className="text-2xl font-bold text-warning">{toKg(activeSession.total_return)}</p>
                    </div>
                    <div className="bg-success/10 border border-success/30 rounded-lg p-4 text-center">
                      <p className="text-xs text-success/70 uppercase mb-1">Delivered</p>
                      <p className="text-2xl font-bold text-success">{toKg(activeSession.total_delivered)}</p>
                    </div>
                  </div>

                  {/* Entry forms — only if session is open */}
                  {activeSession.status === "OPEN" && (
                    <div className="grid grid-cols-2 gap-4">
                      {/* Pickup form */}
                      <div className="bg-surface-2 rounded-lg p-4 border border-surface-4">
                        <h3 className="font-semibold text-info flex items-center gap-2 mb-3">
                          <ArrowUpFromLine className="w-4 h-4" /> Add Pickup
                        </h3>
                        <p className="text-xs text-text-secondary mb-3">Milk taken from store — deducted from inventory</p>
                        <div className="space-y-3">
                          <div>
                            <label className="label">Quantity (kg)</label>
                            <input
                              type="number"
                              className="input"
                              value={pickupQty}
                              onChange={e => setPickupQty(e.target.value)}
                              placeholder="e.g. 20"
                              min="0"
                              step="0.5"
                            />
                          </div>
                          <div>
                            <label className="label">Notes (optional)</label>
                            <input className="input" value={pickupNotes} onChange={e => setPickupNotes(e.target.value)} placeholder="Route, area..." />
                          </div>
                          <button
                            onClick={handlePickup}
                            disabled={submitting || !pickupQty}
                            className="btn btn-info w-full flex items-center justify-center gap-2"
                          >
                            <ArrowUpFromLine className="w-4 h-4" /> Record Pickup
                          </button>
                        </div>
                      </div>

                      {/* Return form */}
                      <div className="bg-surface-2 rounded-lg p-4 border border-surface-4">
                        <h3 className="font-semibold text-warning flex items-center gap-2 mb-3">
                          <ArrowDownToLine className="w-4 h-4" /> Add Return
                        </h3>
                        <p className="text-xs text-text-secondary mb-3">Unsold milk brought back — added to inventory</p>
                        <div className="space-y-3">
                          <div>
                            <label className="label">Quantity (kg)</label>
                            <input
                              type="number"
                              className="input"
                              value={returnQty}
                              onChange={e => setReturnQty(e.target.value)}
                              placeholder="e.g. 5"
                              min="0"
                              step="0.5"
                            />
                          </div>
                          <div>
                            <label className="label">Notes (optional)</label>
                            <input className="input" value={returnNotes} onChange={e => setReturnNotes(e.target.value)} placeholder="Reason..." />
                          </div>
                          <button
                            onClick={handleReturn}
                            disabled={submitting || !returnQty || activeSession.total_pickup === 0}
                            className="btn btn-warning w-full flex items-center justify-center gap-2"
                          >
                            <ArrowDownToLine className="w-4 h-4" /> Record Return
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Entry log */}
                  <div className="bg-surface-2 rounded-lg border border-surface-4 overflow-hidden">
                    <div className="px-4 py-3 border-b border-surface-4 flex items-center justify-between">
                      <h3 className="font-semibold text-text-primary">Today's Entries</h3>
                      <span className="text-xs text-text-secondary">{(activeSession.entries || []).length} entries</span>
                    </div>
                    {!(activeSession.entries || []).length ? (
                      <div className="p-6 text-center text-text-secondary text-sm">No entries yet — record first pickup above</div>
                    ) : (
                      <div className="divide-y divide-surface-4">
                        {(activeSession.entries || []).map((entry: any) => (
                          <div key={entry.id} className="flex items-center justify-between px-4 py-3">
                            <div className="flex items-center gap-3">
                              <div className={cn(
                                "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                                entry.entry_type === "PICKUP" ? "bg-info/20 text-info" : "bg-warning/20 text-warning"
                              )}>
                                {entry.entry_type === "PICKUP"
                                  ? <ArrowUpFromLine className="w-4 h-4" />
                                  : <ArrowDownToLine className="w-4 h-4" />
                                }
                              </div>
                              <div>
                                <p className={cn("font-semibold text-sm", entry.entry_type === "PICKUP" ? "text-info" : "text-warning")}>
                                  {entry.entry_type === "PICKUP" ? "Pickup" : "Return"}
                                </p>
                                {entry.notes && <p className="text-xs text-text-secondary">{entry.notes}</p>}
                              </div>
                            </div>
                            <div className="text-right">
                              <p className="font-bold text-text-primary">{toKg(entry.quantity)}</p>
                              <p className="text-xs text-text-secondary">{formatTime(entry.created_at)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Complete button */}
                  {activeSession.status === "OPEN" && (
                    <div className="bg-surface-2 rounded-lg p-5 border border-success/30">
                      <h3 className="font-semibold text-text-primary mb-2 flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-success" /> Complete Today's Deliveries
                      </h3>
                      <p className="text-sm text-text-secondary mb-4">
                        This will lock all entries for today. Final result: <strong className="text-success">{toKg(activeSession.total_delivered)} delivered</strong>.
                        No more pickups or returns can be added after this.
                      </p>
                      <div className="flex gap-3">
                        <input
                          className="input flex-1"
                          placeholder="Notes (optional)"
                          value={completeNotes}
                          onChange={e => setCompleteNotes(e.target.value)}
                        />
                        <button
                          onClick={handleComplete}
                          disabled={submitting || activeSession.total_pickup === 0}
                          className="btn btn-success flex items-center gap-2 px-6"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Deliveries Completed
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Completed state summary */}
                  {activeSession.status === "COMPLETED" && (
                    <div className="bg-success/10 border border-success/30 rounded-lg p-5">
                      <div className="flex items-center gap-2 mb-3">
                        <CheckCircle2 className="w-5 h-5 text-success" />
                        <h3 className="font-semibold text-success">Deliveries Completed</h3>
                        <span className="text-xs text-text-secondary ml-auto">{formatTime(activeSession.completed_at)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-3 text-sm">
                        <div><span className="text-text-secondary">Dispatched:</span> <strong className="text-text-primary ml-1">{toKg(activeSession.total_pickup)}</strong></div>
                        <div><span className="text-text-secondary">Returned:</span> <strong className="text-warning ml-1">{toKg(activeSession.total_return)}</strong></div>
                        <div><span className="text-text-secondary">Delivered:</span> <strong className="text-success ml-1">{toKg(activeSession.total_delivered)}</strong></div>
                      </div>
                      {activeSession.notes && <p className="text-xs text-text-secondary mt-2">{activeSession.notes}</p>}
                    </div>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {/* ═══════════════════════════ RIDERS TAB ══════════════════════════ */}
        {tab === "riders" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-2xl mx-auto space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-bold text-text-primary">Manage Riders</h2>
                <div className="flex gap-3">
                  <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
                    <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} className="rounded" />
                    Show inactive
                  </label>
                  <button onClick={() => { setShowAddRider(true); setEditingRider(null); setRiderForm({ name: "", phone: "", area: "", notes: "" }); }} className="btn btn-primary btn-sm flex items-center gap-1">
                    <Plus className="w-4 h-4" /> Add Rider
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="text-center text-text-secondary py-8">Loading...</div>
              ) : riders.length === 0 ? (
                <div className="text-center text-text-secondary py-12 bg-surface-2 rounded-lg border border-surface-4">
                  <Bike className="w-10 h-10 opacity-30 mx-auto mb-3" />
                  <p>No riders yet. Add your first delivery rider.</p>
                </div>
              ) : (
                <div className="bg-surface-2 rounded-lg border border-surface-4 overflow-hidden">
                  {riders.map((rider, i) => (
                    <div key={rider.id} className={cn("flex items-center justify-between px-5 py-4", i > 0 && "border-t border-surface-4")}>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="font-semibold text-text-primary">{rider.name}</p>
                          <span className="text-xs text-text-secondary">{rider.code}</span>
                          {!rider.is_active && <span className="badge badge-danger text-xs">Inactive</span>}
                        </div>
                        <div className="flex gap-4 mt-1 text-xs text-text-secondary">
                          {rider.phone && <span>{rider.phone}</span>}
                          {rider.area && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{rider.area}</span>}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setEditingRider(rider); setRiderForm({ name: rider.name, phone: rider.phone || "", area: rider.area || "", notes: rider.notes || "" }); setShowAddRider(true); }}
                          className="btn btn-ghost btn-sm"
                        >
                          Edit
                        </button>
                        {rider.is_active && (
                          <button
                            onClick={async () => { await window.electronAPI?.riders?.deactivate(rider.id); loadAll(); }}
                            className="btn btn-ghost btn-sm text-danger"
                          >
                            Deactivate
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════ HISTORY TAB ══════════════════════════ */}
        {tab === "history" && (
          <div className="flex-1 overflow-y-auto p-6">
            <div className="max-w-3xl mx-auto">
              <h2 className="text-lg font-bold text-text-primary mb-5 flex items-center gap-2">
                <History className="w-5 h-5" /> Delivery History
              </h2>
              {history.length === 0 ? (
                <div className="text-center text-text-secondary py-12 bg-surface-2 rounded-lg border border-surface-4">
                  <History className="w-10 h-10 opacity-30 mx-auto mb-3" />
                  <p>No completed deliveries yet</p>
                </div>
              ) : (
                <div className="bg-surface-2 rounded-lg border border-surface-4 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-3">
                      <tr>
                        <th className="text-left px-4 py-3 text-text-secondary font-medium">Date</th>
                        <th className="text-left px-4 py-3 text-text-secondary font-medium">Rider</th>
                        <th className="text-left px-4 py-3 text-text-secondary font-medium">Area</th>
                        <th className="text-right px-4 py-3 text-text-secondary font-medium">Dispatched</th>
                        <th className="text-right px-4 py-3 text-text-secondary font-medium">Returned</th>
                        <th className="text-right px-4 py-3 text-text-secondary font-medium text-success">Delivered</th>
                      </tr>
                    </thead>
                    <tbody>
                      {history.map((s: any) => (
                        <tr key={s.id} className="border-t border-surface-4 hover:bg-surface-3 transition-colors">
                          <td className="px-4 py-3 text-text-secondary">{formatDate(s.session_date)}</td>
                          <td className="px-4 py-3 font-medium text-text-primary">{s.rider_name}</td>
                          <td className="px-4 py-3 text-text-secondary">{s.rider_area || "-"}</td>
                          <td className="px-4 py-3 text-right text-info">{toKg(s.total_pickup)}</td>
                          <td className="px-4 py-3 text-right text-warning">{toKg(s.total_return)}</td>
                          <td className="px-4 py-3 text-right font-bold text-success">{toKg(s.total_delivered)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Add/Edit Rider Modal ─────────────────────────────────────────────── */}
      {showAddRider && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-2 rounded-xl shadow-xl w-full max-w-md border border-surface-4">
            <div className="flex items-center justify-between p-5 border-b border-surface-4">
              <h2 className="text-lg font-bold text-text-primary">{editingRider ? "Edit Rider" : "Add New Rider"}</h2>
              <button onClick={() => setShowAddRider(false)} className="text-text-secondary hover:text-text-primary"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div>
                <label className="label">Full Name *</label>
                <input className="input" value={riderForm.name} onChange={e => setRiderForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Ahmad Ali" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={riderForm.phone} onChange={e => setRiderForm(f => ({ ...f, phone: e.target.value }))} placeholder="03XX-XXXXXXX" />
                </div>
                <div>
                  <label className="label">Delivery Area</label>
                  <input className="input" value={riderForm.area} onChange={e => setRiderForm(f => ({ ...f, area: e.target.value }))} placeholder="e.g. Gulshan Block 5" />
                </div>
              </div>
              <div>
                <label className="label">Notes</label>
                <input className="input" value={riderForm.notes} onChange={e => setRiderForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional" />
              </div>
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-surface-4">
              <button onClick={() => setShowAddRider(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleAddRider} className="btn btn-primary">{editingRider ? "Save Changes" : "Add Rider"}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ────────────────────────────────────────────────────────────── */}
      {msg && (
        <div className={cn(
          "fixed bottom-6 right-6 px-5 py-3 rounded-lg shadow-xl text-white font-medium z-50 flex items-center gap-2 max-w-sm",
          msg.type === "success" ? "bg-success" : "bg-danger"
        )}>
          {msg.type === "success" ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          {msg.text}
        </div>
      )}
    </div>
  );
}
