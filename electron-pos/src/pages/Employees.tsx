import { useEffect, useState } from "react";
import {
  UserRound, Plus, Banknote, CalendarDays, TrendingUp,
  AlertTriangle, CheckCircle2, ChevronRight, X, Save
} from "lucide-react";
import { cn } from "../lib/utils";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toMoney(v: number) {
  return `Rs. ${Number(v || 0).toLocaleString("en-PK", { maximumFractionDigits: 0 })}`;
}

function today() {
  return new Date().toISOString().split("T")[0];
}

function currentYearMonth() {
  return new Date().toISOString().slice(0, 7);
}

function formatDate(d: string) {
  if (!d) return "-";
  return new Date(d).toLocaleDateString("en-PK", { day: "2-digit", month: "short", year: "numeric" });
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Employee = {
  id: string;
  code: string;
  name: string;
  phone?: string;
  address?: string;
  start_date: string;
  salary: number;
  is_active: number;
  left_date?: string;
  notes?: string;
  salaryHistory?: any[];
  advances?: any[];
  leaves?: any[];
  payments?: any[];
};

type Msg = { type: "success" | "error"; text: string } | null;

// ─── Small reusable card ──────────────────────────────────────────────────────

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-surface-3 rounded-lg p-4 flex flex-col gap-1">
      <span className="text-xs text-text-secondary uppercase tracking-wide">{label}</span>
      <span className="text-xl font-bold text-text-primary">{value}</span>
      {sub && <span className="text-xs text-text-secondary">{sub}</span>}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selected, setSelected] = useState<Employee | null>(null);
  const [tab, setTab] = useState<"overview" | "advances" | "leaves" | "salary">("overview");
  const [showInactive, setShowInactive] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [loading, setLoading] = useState(true);

  // Add employee form
  const [showAddForm, setShowAddForm] = useState(false);
  const [empForm, setEmpForm] = useState({ name: "", phone: "", address: "", startDate: today(), salary: "", notes: "" });

  // Edit form
  const [editing, setEditing] = useState(false);
  const [editForm, setEditForm] = useState({ name: "", phone: "", address: "", notes: "" });

  // Salary update
  const [showSalaryUpdate, setShowSalaryUpdate] = useState(false);
  const [newSalary, setNewSalary] = useState("");
  const [salaryEffDate, setSalaryEffDate] = useState(today());
  const [salaryNote, setSalaryNote] = useState("");

  // Advance form
  const [advAmount, setAdvAmount] = useState("");
  const [advDate, setAdvDate] = useState(today());
  const [advDesc, setAdvDesc] = useState("");

  // Leave form
  const [leaveDate, setLeaveDate] = useState(today());
  const [leaveDays, setLeaveDays] = useState("1");
  const [leaveReason, setLeaveReason] = useState("");

  // Salary payment
  const [salaryMonth, setSalaryMonth] = useState(currentYearMonth());
  const [salaryCalc, setSalaryCalc] = useState<any>(null);
  const [salaryPayNote, setSalaryPayNote] = useState("");
  const [calcLoading, setCalcLoading] = useState(false);

  // Mark as left
  const [showMarkLeft, setShowMarkLeft] = useState(false);
  const [leftDate, setLeftDate] = useState(today());
  const [leavingPay, setLeavingPay] = useState<any>(null);

  useEffect(() => { loadEmployees(); }, [showInactive]);

  function flash(type: "success" | "error", text: string) {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 3500);
  }

  async function loadEmployees() {
    setLoading(true);
    const data = await window.electronAPI?.employees?.getAll(showInactive);
    setEmployees(data || []);
    setLoading(false);
  }

  async function selectEmployee(emp: Employee) {
    const full = await window.electronAPI?.employees?.getOne(emp.id);
    setSelected(full || emp);
    setTab("overview");
    setEditing(false);
    setSalaryCalc(null);
  }

  // ── Add Employee ────────────────────────────────────────────────────────────
  async function handleAddEmployee() {
    if (!empForm.name.trim()) return flash("error", "Name is required");
    if (!empForm.startDate) return flash("error", "Start date is required");
    if (!empForm.salary || Number(empForm.salary) < 0) return flash("error", "Enter a valid salary");

    const res = await window.electronAPI?.employees?.create({
      name: empForm.name.trim(),
      phone: empForm.phone,
      address: empForm.address,
      startDate: empForm.startDate,
      salary: Number(empForm.salary),
      notes: empForm.notes,
    });

    if (res?.success) {
      flash("success", "Employee added");
      setShowAddForm(false);
      setEmpForm({ name: "", phone: "", address: "", startDate: today(), salary: "", notes: "" });
      await loadEmployees();
    } else {
      flash("error", res?.error || "Failed to add employee");
    }
  }

  // ── Update Info ─────────────────────────────────────────────────────────────
  async function handleUpdateInfo() {
    if (!selected) return;
    const res = await window.electronAPI?.employees?.update(selected.id, editForm);
    if (res?.success) {
      flash("success", "Updated");
      setEditing(false);
      await selectEmployee(selected);
      await loadEmployees();
    } else {
      flash("error", res?.error || "Update failed");
    }
  }

  // ── Update Salary ───────────────────────────────────────────────────────────
  async function handleUpdateSalary() {
    if (!selected || !newSalary || Number(newSalary) < 0) return flash("error", "Enter valid salary");
    const res = await window.electronAPI?.employees?.updateSalary(selected.id, Number(newSalary), salaryEffDate, salaryNote);
    if (res?.success) {
      flash("success", "Salary updated");
      setShowSalaryUpdate(false);
      setNewSalary(""); setSalaryNote("");
      await selectEmployee(selected);
      await loadEmployees();
    } else {
      flash("error", res?.error || "Failed to update salary");
    }
  }

  // ── Add Advance ─────────────────────────────────────────────────────────────
  async function handleAddAdvance() {
    if (!selected) return;
    if (!advAmount || Number(advAmount) <= 0) return flash("error", "Enter advance amount");
    const res = await window.electronAPI?.employees?.addAdvance({
      employeeId: selected.id,
      amount: Number(advAmount),
      advanceDate: advDate,
      description: advDesc,
    });
    if (res?.success) {
      flash("success", "Advance recorded");
      setAdvAmount(""); setAdvDesc("");
      await selectEmployee(selected);
    } else {
      flash("error", res?.error || "Failed to record advance");
    }
  }

  // ── Add Leave ───────────────────────────────────────────────────────────────
  async function handleAddLeave() {
    if (!selected) return;
    if (!leaveDays || Number(leaveDays) <= 0) return flash("error", "Enter number of days");
    const res = await window.electronAPI?.employees?.addLeave({
      employeeId: selected.id,
      leaveDate,
      days: Number(leaveDays),
      reason: leaveReason,
    });
    if (res?.success) {
      flash("success", "Leave recorded");
      setLeaveDays("1"); setLeaveReason("");
      await selectEmployee(selected);
    } else {
      flash("error", res?.error || "Failed to record leave");
    }
  }

  // ── Calculate Salary ────────────────────────────────────────────────────────
  async function handleCalculateSalary() {
    if (!selected) return;
    setCalcLoading(true);
    const period = await window.electronAPI?.employees?.getDefaultPeriod(selected.start_date, salaryMonth);
    const res = await window.electronAPI?.employees?.calculateSalary(selected.id, period.start, period.end);
    setCalcLoading(false);
    if (res?.success) {
      setSalaryCalc({ ...res.data, period });
    } else {
      flash("error", res?.error || "Calculation failed");
    }
  }

  // ── Pay Salary ──────────────────────────────────────────────────────────────
  async function handlePaySalary() {
    if (!selected || !salaryCalc) return;
    const res = await window.electronAPI?.employees?.paySalary({
      employeeId: selected.id,
      periodStart: salaryCalc.period.start,
      periodEnd: salaryCalc.period.end,
      notes: salaryPayNote,
    });
    if (res?.success) {
      flash("success", `Salary paid — Net: ${toMoney(res.calc.netSalary)}`);
      setSalaryCalc(null); setSalaryPayNote("");
      await selectEmployee(selected);
    } else {
      flash("error", res?.error || "Payment failed");
    }
  }

  // ── Mark as Left ────────────────────────────────────────────────────────────
  async function handleMarkLeft() {
    if (!selected) return;
    const res = await window.electronAPI?.employees?.markLeft(selected.id, leftDate);
    if (res?.success) {
      flash("success", "Employee marked as left");
      setShowMarkLeft(false);
      setSelected(null);
      await loadEmployees();
    } else {
      flash("error", res?.error || "Failed");
    }
  }

  async function loadLeavingPay() {
    if (!selected) return;
    const res = await window.electronAPI?.employees?.calculateLeavingPay(selected.id);
    if (res?.success) setLeavingPay(res.data);
  }

  // ─────────────────────────────────────────────────────────────────────────────

  return (
    <div className="flex h-full bg-surface-1 overflow-hidden">

      {/* ── Left Panel: Employee List ─────────────────────────────────────────── */}
      <div className="w-72 shrink-0 border-r border-surface-4 flex flex-col bg-surface-2">
        <div className="p-4 border-b border-surface-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
              <UserRound className="w-5 h-5 text-primary" /> Employees
            </h2>
            <button
              onClick={() => setShowAddForm(true)}
              className="btn btn-primary btn-sm flex items-center gap-1"
            >
              <Plus className="w-4 h-4" /> Add
            </button>
          </div>
          <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={e => setShowInactive(e.target.checked)}
              className="rounded"
            />
            Show ex-employees
          </label>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="p-8 text-center text-text-secondary">Loading...</div>
          ) : employees.length === 0 ? (
            <div className="p-8 text-center text-text-secondary text-sm">No employees yet</div>
          ) : (
            employees.map(emp => (
              <button
                key={emp.id}
                onClick={() => selectEmployee(emp)}
                className={cn(
                  "w-full text-left px-4 py-3 border-b border-surface-4 hover:bg-surface-3 transition-colors flex items-center justify-between gap-2",
                  selected?.id === emp.id && "bg-primary/10 border-l-2 border-l-primary"
                )}
              >
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-text-primary truncate">{emp.name}</p>
                  <p className="text-xs text-text-secondary">{emp.code} · {toMoney(emp.salary)}/mo</p>
                  {!emp.is_active && (
                    <span className="text-xs text-danger font-medium">Left {formatDate(emp.left_date || "")}</span>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-text-secondary shrink-0" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* ── Right Panel ──────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto">
        {!selected ? (
          <div className="h-full flex items-center justify-center text-text-secondary flex-col gap-3">
            <UserRound className="w-12 h-12 opacity-30" />
            <p>Select an employee to view details</p>
          </div>
        ) : (
          <div className="p-6 max-w-4xl mx-auto">

            {/* Header */}
            <div className="flex items-start justify-between mb-6">
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold text-text-primary">{selected.name}</h1>
                  <span className={cn(
                    "badge",
                    selected.is_active ? "badge-success" : "badge-danger"
                  )}>
                    {selected.is_active ? "Active" : "Left"}
                  </span>
                </div>
                <p className="text-text-secondary text-sm mt-1">
                  {selected.code} · Joined {formatDate(selected.start_date)}
                  {selected.phone && ` · ${selected.phone}`}
                </p>
              </div>
              <div className="flex gap-2">
                {selected.is_active && (
                  <button
                    onClick={() => { setShowMarkLeft(true); loadLeavingPay(); }}
                    className="btn btn-danger btn-sm"
                  >
                    Mark as Left
                  </button>
                )}
              </div>
            </div>

            {/* Stat cards */}
            <div className="grid grid-cols-3 gap-4 mb-6">
              <StatCard label="Monthly Salary" value={toMoney(selected.salary)} sub="Current" />
              <StatCard label="Daily Rate" value={toMoney(selected.salary / 30)} sub="salary ÷ 30" />
              <StatCard
                label="Pending Advances"
                value={toMoney(selected.advances?.filter((a: any) => a.status === "PENDING").reduce((s: number, a: any) => s + Number(a.amount), 0) || 0)}
                sub="not yet deducted"
              />
            </div>

            {/* Tabs */}
            <div className="flex border-b border-surface-4 mb-6 gap-1">
              {(["overview", "advances", "leaves", "salary"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={cn(
                    "px-4 py-2 text-sm font-medium capitalize transition-colors border-b-2 -mb-px",
                    tab === t
                      ? "border-primary text-primary"
                      : "border-transparent text-text-secondary hover:text-text-primary"
                  )}
                >
                  {t}
                </button>
              ))}
            </div>

            {/* ── Overview Tab ─────────────────────────────────────────────── */}
            {tab === "overview" && (
              <div className="space-y-6">
                {/* Edit Info */}
                <div className="bg-surface-2 rounded-lg p-5 border border-surface-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-text-primary">Employee Info</h3>
                    {!editing ? (
                      <button onClick={() => { setEditing(true); setEditForm({ name: selected.name, phone: selected.phone || "", address: selected.address || "", notes: selected.notes || "" }); }} className="btn btn-ghost btn-sm">Edit</button>
                    ) : (
                      <div className="flex gap-2">
                        <button onClick={handleUpdateInfo} className="btn btn-primary btn-sm flex gap-1"><Save className="w-4 h-4" /> Save</button>
                        <button onClick={() => setEditing(false)} className="btn btn-ghost btn-sm"><X className="w-4 h-4" /></button>
                      </div>
                    )}
                  </div>
                  {editing ? (
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="label">Name</label>
                        <input className="input" value={editForm.name} onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))} />
                      </div>
                      <div>
                        <label className="label">Phone</label>
                        <input className="input" value={editForm.phone} onChange={e => setEditForm(f => ({ ...f, phone: e.target.value }))} />
                      </div>
                      <div className="col-span-2">
                        <label className="label">Address</label>
                        <input className="input" value={editForm.address} onChange={e => setEditForm(f => ({ ...f, address: e.target.value }))} />
                      </div>
                      <div className="col-span-2">
                        <label className="label">Notes</label>
                        <textarea className="input" rows={2} value={editForm.notes} onChange={e => setEditForm(f => ({ ...f, notes: e.target.value }))} />
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div><span className="text-text-secondary">Phone:</span> <span className="text-text-primary ml-2">{selected.phone || "-"}</span></div>
                      <div><span className="text-text-secondary">Address:</span> <span className="text-text-primary ml-2">{selected.address || "-"}</span></div>
                      <div><span className="text-text-secondary">Start Date:</span> <span className="text-text-primary ml-2">{formatDate(selected.start_date)}</span></div>
                      <div><span className="text-text-secondary">Notes:</span> <span className="text-text-primary ml-2">{selected.notes || "-"}</span></div>
                    </div>
                  )}
                </div>

                {/* Salary Update */}
                <div className="bg-surface-2 rounded-lg p-5 border border-surface-4">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-text-primary flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-success" /> Salary
                    </h3>
                    {selected.is_active && (
                      <button onClick={() => { setShowSalaryUpdate(!showSalaryUpdate); setNewSalary(String(selected.salary)); setSalaryEffDate(today()); }} className="btn btn-ghost btn-sm">
                        {showSalaryUpdate ? "Cancel" : "Update Salary"}
                      </button>
                    )}
                  </div>
                  {showSalaryUpdate && (
                    <div className="grid grid-cols-3 gap-3 mb-4">
                      <div>
                        <label className="label">New Salary (Rs.)</label>
                        <input type="number" className="input" value={newSalary} onChange={e => setNewSalary(e.target.value)} placeholder="0" />
                      </div>
                      <div>
                        <label className="label">Effective Date</label>
                        <input type="date" className="input" value={salaryEffDate} onChange={e => setSalaryEffDate(e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Reason (optional)</label>
                        <input className="input" value={salaryNote} onChange={e => setSalaryNote(e.target.value)} placeholder="e.g. Annual increment" />
                      </div>
                      <div className="col-span-3">
                        <button onClick={handleUpdateSalary} className="btn btn-success btn-sm">Save New Salary</button>
                      </div>
                    </div>
                  )}
                  {/* Salary history */}
                  <div className="space-y-2">
                    {(selected.salaryHistory || []).slice(0, 5).map((h: any) => (
                      <div key={h.id} className="flex items-center justify-between text-sm py-1 border-b border-surface-4 last:border-0">
                        <span className="text-text-secondary">{formatDate(h.effective_date)}</span>
                        <span className="font-semibold text-text-primary">{toMoney(h.salary)}</span>
                        <span className="text-text-secondary text-xs">{h.notes || ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* ── Advances Tab ─────────────────────────────────────────────── */}
            {tab === "advances" && (
              <div className="space-y-5">
                {selected.is_active && (
                  <div className="bg-surface-2 rounded-lg p-5 border border-surface-4">
                    <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                      <Banknote className="w-4 h-4 text-warning" /> Record Advance Payment
                    </h3>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="label">Amount (Rs.)</label>
                        <input type="number" className="input" value={advAmount} onChange={e => setAdvAmount(e.target.value)} placeholder="0" />
                      </div>
                      <div>
                        <label className="label">Date</label>
                        <input type="date" className="input" value={advDate} onChange={e => setAdvDate(e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Description (optional)</label>
                        <input className="input" value={advDesc} onChange={e => setAdvDesc(e.target.value)} placeholder="Reason..." />
                      </div>
                    </div>
                    <button onClick={handleAddAdvance} className="btn btn-warning btn-sm mt-3">Add Advance</button>
                  </div>
                )}

                <div className="bg-surface-2 rounded-lg border border-surface-4 overflow-hidden">
                  <div className="p-4 border-b border-surface-4 flex items-center justify-between">
                    <h3 className="font-semibold text-text-primary">Advance History</h3>
                    <span className="text-sm text-text-secondary">
                      Pending: {toMoney(selected.advances?.filter((a: any) => a.status === "PENDING").reduce((s: number, a: any) => s + Number(a.amount), 0) || 0)}
                    </span>
                  </div>
                  {!selected.advances?.length ? (
                    <div className="p-6 text-center text-text-secondary text-sm">No advances recorded</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-surface-3">
                        <tr>
                          <th className="text-left px-4 py-2 text-text-secondary font-medium">Date</th>
                          <th className="text-left px-4 py-2 text-text-secondary font-medium">Amount</th>
                          <th className="text-left px-4 py-2 text-text-secondary font-medium">Description</th>
                          <th className="text-left px-4 py-2 text-text-secondary font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.advances.map((a: any) => (
                          <tr key={a.id} className="border-t border-surface-4">
                            <td className="px-4 py-3 text-text-secondary">{formatDate(a.advance_date)}</td>
                            <td className="px-4 py-3 font-semibold text-text-primary">{toMoney(a.amount)}</td>
                            <td className="px-4 py-3 text-text-secondary">{a.description || "-"}</td>
                            <td className="px-4 py-3">
                              <span className={cn("badge text-xs", a.status === "PENDING" ? "badge-warning" : "badge-success")}>
                                {a.status}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* ── Leaves Tab ───────────────────────────────────────────────── */}
            {tab === "leaves" && (
              <div className="space-y-5">
                {selected.is_active && (
                  <div className="bg-surface-2 rounded-lg p-5 border border-surface-4">
                    <h3 className="font-semibold text-text-primary mb-4 flex items-center gap-2">
                      <CalendarDays className="w-4 h-4 text-info" /> Record Days Off
                    </h3>
                    <p className="text-xs text-text-secondary mb-3">
                      Each day off deducts <strong>{toMoney(selected.salary / 30)}</strong> (salary ÷ 30) from that month's salary.
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label className="label">From Date</label>
                        <input type="date" className="input" value={leaveDate} onChange={e => setLeaveDate(e.target.value)} />
                      </div>
                      <div>
                        <label className="label">Number of Days</label>
                        <input type="number" className="input" value={leaveDays} onChange={e => setLeaveDays(e.target.value)} min="0.5" step="0.5" />
                      </div>
                      <div>
                        <label className="label">Reason (optional)</label>
                        <input className="input" value={leaveReason} onChange={e => setLeaveReason(e.target.value)} placeholder="e.g. Sick leave" />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-4">
                      <button onClick={handleAddLeave} className="btn btn-info btn-sm">Record Leave</button>
                      {leaveDays && Number(leaveDays) > 0 && (
                        <span className="text-sm text-text-secondary">
                          Deduction: <strong className="text-danger">{toMoney((selected.salary / 30) * Number(leaveDays))}</strong>
                        </span>
                      )}
                    </div>
                  </div>
                )}

                <div className="bg-surface-2 rounded-lg border border-surface-4 overflow-hidden">
                  <div className="p-4 border-b border-surface-4">
                    <h3 className="font-semibold text-text-primary">Leave History</h3>
                  </div>
                  {!selected.leaves?.length ? (
                    <div className="p-6 text-center text-text-secondary text-sm">No leaves recorded</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-surface-3">
                        <tr>
                          <th className="text-left px-4 py-2 text-text-secondary font-medium">Date</th>
                          <th className="text-left px-4 py-2 text-text-secondary font-medium">Days</th>
                          <th className="text-left px-4 py-2 text-text-secondary font-medium">Deduction</th>
                          <th className="text-left px-4 py-2 text-text-secondary font-medium">Reason</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.leaves.map((l: any) => (
                          <tr key={l.id} className="border-t border-surface-4">
                            <td className="px-4 py-3 text-text-secondary">{formatDate(l.leave_date)}</td>
                            <td className="px-4 py-3 font-semibold text-text-primary">{l.days} day{l.days !== 1 ? "s" : ""}</td>
                            <td className="px-4 py-3 text-danger font-medium">{toMoney((selected.salary / 30) * Number(l.days))}</td>
                            <td className="px-4 py-3 text-text-secondary">{l.reason || "-"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}

            {/* ── Salary Tab ───────────────────────────────────────────────── */}
            {tab === "salary" && (
              <div className="space-y-5">
                {selected.is_active && (
                  <div className="bg-surface-2 rounded-lg p-5 border border-surface-4">
                    <h3 className="font-semibold text-text-primary mb-1">Calculate Monthly Salary</h3>
                    <p className="text-xs text-text-secondary mb-4">
                      Period runs from the <strong>{new Date(selected.start_date).getDate()}</strong>th of each month.
                      Formula: (salary ÷ 30) × days worked — advances deducted automatically.
                    </p>
                    <div className="flex items-end gap-3">
                      <div>
                        <label className="label">Month</label>
                        <input
                          type="month"
                          className="input"
                          value={salaryMonth}
                          onChange={e => { setSalaryMonth(e.target.value); setSalaryCalc(null); }}
                        />
                      </div>
                      <button onClick={handleCalculateSalary} disabled={calcLoading} className="btn btn-primary">
                        {calcLoading ? "Calculating..." : "Calculate"}
                      </button>
                    </div>

                    {salaryCalc && (
                      <div className="mt-5 border border-surface-4 rounded-lg overflow-hidden">
                        <div className="bg-surface-3 px-4 py-3 text-sm font-semibold text-text-secondary">
                          Period: {formatDate(salaryCalc.period.start)} → {formatDate(salaryCalc.period.end)}
                        </div>
                        <div className="p-4 space-y-2 text-sm">
                          <div className="flex justify-between"><span className="text-text-secondary">Base Salary</span><span>{toMoney(salaryCalc.salary)}</span></div>
                          <div className="flex justify-between"><span className="text-text-secondary">Days in Period</span><span>{salaryCalc.daysInPeriod} days</span></div>
                          <div className="flex justify-between"><span className="text-text-secondary">Days Off</span><span className="text-danger">{salaryCalc.daysOff} days ({toMoney((salaryCalc.salary / 30) * salaryCalc.daysOff)} deducted)</span></div>
                          <div className="flex justify-between"><span className="text-text-secondary">Days Worked</span><span className="text-success">{salaryCalc.daysWorked} days</span></div>
                          <div className="flex justify-between font-semibold"><span className="text-text-secondary">Gross Salary</span><span>{toMoney(salaryCalc.grossSalary)}</span></div>
                          <div className="flex justify-between text-danger"><span>Advance Deduction</span><span>— {toMoney(salaryCalc.advanceDeduction)}</span></div>
                          <div className="flex justify-between font-bold text-base border-t border-surface-4 pt-2 mt-2">
                            <span className="text-text-primary">Net Salary to Pay</span>
                            <span className="text-success text-lg">{toMoney(salaryCalc.netSalary)}</span>
                          </div>
                        </div>
                        <div className="p-4 border-t border-surface-4 flex items-center gap-3">
                          <input
                            className="input flex-1"
                            placeholder="Notes (optional)"
                            value={salaryPayNote}
                            onChange={e => setSalaryPayNote(e.target.value)}
                          />
                          <button onClick={handlePaySalary} className="btn btn-success flex items-center gap-2">
                            <CheckCircle2 className="w-4 h-4" /> Mark as Paid
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Payment history */}
                <div className="bg-surface-2 rounded-lg border border-surface-4 overflow-hidden">
                  <div className="p-4 border-b border-surface-4">
                    <h3 className="font-semibold text-text-primary">Salary Payment History</h3>
                  </div>
                  {!selected.payments?.length ? (
                    <div className="p-6 text-center text-text-secondary text-sm">No salary payments yet</div>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-surface-3">
                        <tr>
                          <th className="text-left px-4 py-2 text-text-secondary font-medium">Period</th>
                          <th className="text-right px-4 py-2 text-text-secondary font-medium">Gross</th>
                          <th className="text-right px-4 py-2 text-text-secondary font-medium">Advances</th>
                          <th className="text-right px-4 py-2 text-text-secondary font-medium">Net Paid</th>
                          <th className="text-left px-4 py-2 text-text-secondary font-medium">Paid On</th>
                        </tr>
                      </thead>
                      <tbody>
                        {selected.payments.map((p: any) => (
                          <tr key={p.id} className="border-t border-surface-4">
                            <td className="px-4 py-3 text-text-secondary">{formatDate(p.period_start)} → {formatDate(p.period_end)}</td>
                            <td className="px-4 py-3 text-right">{toMoney(p.gross_salary)}</td>
                            <td className="px-4 py-3 text-right text-danger">{p.advance_deduction > 0 ? `— ${toMoney(p.advance_deduction)}` : "-"}</td>
                            <td className="px-4 py-3 text-right font-bold text-success">{toMoney(p.net_salary)}</td>
                            <td className="px-4 py-3 text-text-secondary">{formatDate(p.paid_date)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Add Employee Modal ────────────────────────────────────────────────── */}
      {showAddForm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-2 rounded-xl shadow-xl w-full max-w-lg border border-surface-4">
            <div className="flex items-center justify-between p-5 border-b border-surface-4">
              <h2 className="text-lg font-bold text-text-primary">Add New Employee</h2>
              <button onClick={() => setShowAddForm(false)} className="text-text-secondary hover:text-text-primary"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label className="label">Full Name *</label>
                  <input className="input" value={empForm.name} onChange={e => setEmpForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Muhammad Ali" />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={empForm.phone} onChange={e => setEmpForm(f => ({ ...f, phone: e.target.value }))} placeholder="03XX-XXXXXXX" />
                </div>
                <div>
                  <label className="label">Start Date *</label>
                  <input type="date" className="input" value={empForm.startDate} onChange={e => setEmpForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Monthly Salary (Rs.) *</label>
                  <input type="number" className="input" value={empForm.salary} onChange={e => setEmpForm(f => ({ ...f, salary: e.target.value }))} placeholder="e.g. 25000" />
                </div>
                <div>
                  <label className="label">Address</label>
                  <input className="input" value={empForm.address} onChange={e => setEmpForm(f => ({ ...f, address: e.target.value }))} placeholder="Optional" />
                </div>
                <div className="col-span-2">
                  <label className="label">Notes</label>
                  <textarea className="input" rows={2} value={empForm.notes} onChange={e => setEmpForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
                </div>
              </div>
              {empForm.salary && Number(empForm.salary) > 0 && (
                <div className="bg-surface-3 rounded-lg p-3 text-sm text-text-secondary">
                  Daily rate: <strong className="text-text-primary">{toMoney(Number(empForm.salary) / 30)}</strong> per day
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-surface-4">
              <button onClick={() => setShowAddForm(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleAddEmployee} className="btn btn-primary">Add Employee</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Mark as Left Modal ────────────────────────────────────────────────── */}
      {showMarkLeft && selected && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
          <div className="bg-surface-2 rounded-xl shadow-xl w-full max-w-md border border-surface-4">
            <div className="flex items-center justify-between p-5 border-b border-surface-4">
              <h2 className="text-lg font-bold text-text-primary flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-warning" /> Mark Employee as Left
              </h2>
              <button onClick={() => setShowMarkLeft(false)} className="text-text-secondary hover:text-text-primary"><X className="w-5 h-5" /></button>
            </div>
            <div className="p-5 space-y-4">
              <p className="text-text-secondary text-sm">
                <strong className="text-text-primary">{selected.name}</strong> will be marked as no longer employed.
              </p>
              <div>
                <label className="label">Last Working Date</label>
                <input type="date" className="input" value={leftDate} onChange={e => setLeftDate(e.target.value)} />
              </div>
              {leavingPay && (
                <div className="bg-warning/10 border border-warning/30 rounded-lg p-4 text-sm">
                  <p className="font-semibold text-warning mb-2">Notice Pay (1 month + 5 days)</p>
                  <div className="space-y-1 text-text-secondary">
                    <div className="flex justify-between"><span>Daily rate</span><span>{toMoney(leavingPay.dailyRate)}</span></div>
                    <div className="flex justify-between"><span>× {leavingPay.days} days</span><span className="font-bold text-text-primary">{toMoney(leavingPay.leavingPay)}</span></div>
                  </div>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-3 p-5 border-t border-surface-4">
              <button onClick={() => setShowMarkLeft(false)} className="btn btn-ghost">Cancel</button>
              <button onClick={handleMarkLeft} className="btn btn-danger">Confirm — Mark as Left</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Toast ────────────────────────────────────────────────────────────── */}
      {msg && (
        <div className={cn(
          "fixed bottom-6 right-6 px-5 py-3 rounded-lg shadow-xl text-white font-medium z-50 flex items-center gap-2",
          msg.type === "success" ? "bg-success" : "bg-danger"
        )}>
          {msg.type === "success" ? <CheckCircle2 className="w-4 h-4" /> : <AlertTriangle className="w-4 h-4" />}
          {msg.text}
        </div>
      )}
    </div>
  );
}
