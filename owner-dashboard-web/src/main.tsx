import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, Session, Summary, SupplierOption } from './api';
import './styles.css';

const money = (value?: number | null) => `Rs. ${Math.round(Number(value || 0)).toLocaleString('en-PK')}`;
const qty = (value?: number | null) => Number(value || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });
const todayIso = () => new Date().toISOString().slice(0, 10);

function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const raw = localStorage.getItem('owner-dashboard-session');
    return raw ? JSON.parse(raw) : null;
  });
  const [active, setActive] = useState<'overview' | 'sales' | 'operations' | 'supplier'>('overview');
  const [date, setDate] = useState('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 2800);
  };

  const saveSession = (next: Session | null) => {
    setSession(next);
    if (next) localStorage.setItem('owner-dashboard-session', JSON.stringify(next));
    else localStorage.removeItem('owner-dashboard-session');
  };

  const loadSummary = async (selectedDate = date) => {
    if (!session) return;
    setLoading(true);
    try {
      const data = await api.summary(session.accessToken, selectedDate || undefined);
      setSummary(data);
      setDate(data.date);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load dashboard');
    } finally {
      setLoading(false);
    }
  };

  const loadSuppliers = async () => {
    if (!session) return;
    const data = await api.supplierEntryData(session.accessToken);
    setSuppliers(data.suppliers);
  };

  useEffect(() => {
    if (!session) return;
    loadSummary();
    loadSuppliers().catch(() => undefined);
    const timer = window.setInterval(() => loadSummary(), 60000);
    return () => window.clearInterval(timer);
  }, [session?.accessToken]);

  const login = async (username: string, password: string) => {
    const next = await api.login(username, password);
    if (!['ADMIN', 'MANAGER'].includes(next.user.role)) {
      throw new Error('Only admin or manager can open owner dashboard');
    }
    saveSession(next);
  };

  const logout = () => {
    saveSession(null);
    setSummary(null);
  };

  const changeDate = (days: number) => {
    const base = date ? new Date(`${date}T00:00:00`) : new Date();
    base.setDate(base.getDate() + days);
    const next = base.toISOString().slice(0, 10);
    setDate(next);
    loadSummary(next);
  };

  if (!session) return <LoginView onLogin={login} />;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">ND</div>
          <div>
            <h1>Noon Dairy</h1>
            <p>Owner Dashboard</p>
          </div>
        </div>
        <nav className="nav">
          {[
            ['overview', 'Overview'],
            ['sales', 'Sales'],
            ['operations', 'Operations'],
            ['supplier', 'Supplier Entry'],
          ].map(([key, label]) => (
            <button key={key} className={active === key ? 'active' : ''} onClick={() => setActive(key as typeof active)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="serverPill"><span /> {api.apiUrl}</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Private cloud control room</p>
            <h2>{active === 'overview' ? 'Business Overview' : active === 'sales' ? 'Sales and Money' : active === 'operations' ? 'Operations Health' : 'Supplier Milk Entry'}</h2>
            <p>{summary ? `Date ${summary.date} | Updated ${new Date(summary.generatedAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Loading live shop data'}</p>
          </div>
          <div className="toolbar">
            <input type="date" value={date} onChange={(e) => { setDate(e.target.value); loadSummary(e.target.value); }} />
            <button onClick={() => changeDate(-1)}>Previous</button>
            <button onClick={() => changeDate(1)}>Next</button>
            <button onClick={() => { setDate(todayIso()); loadSummary(todayIso()); }}>Today</button>
            <button className="primary" disabled={loading} onClick={() => loadSummary()}>{loading ? 'Loading...' : 'Refresh'}</button>
            <button className="danger" onClick={logout}>Logout</button>
          </div>
        </header>

        {error && <div className="error">{error}</div>}
        {!summary ? <LoadingGrid /> : (
          <>
            {active === 'overview' && <Overview summary={summary} />}
            {active === 'sales' && <Sales summary={summary} />}
            {active === 'operations' && <Operations summary={summary} />}
            {active === 'supplier' && <SupplierEntry suppliers={suppliers} token={session.accessToken} reload={() => { loadSuppliers(); loadSummary(); }} notify={showToast} />}
          </>
        )}
      </main>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

function LoginView({ onLogin }: { onLogin: (username: string, password: string) => Promise<void> }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await onLogin(username, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="loginPage">
      <section className="loginHero">
        <div>
          <p className="eyebrow">Noon Dairy cloud</p>
          <h1>Professional owner dashboard for your dairy shop.</h1>
          <p>Live sales, expected cash, khata, supplier balances, stock alerts, POS sync health, and online supplier milk entry.</p>
        </div>
        <form className="loginCard" onSubmit={submit}>
          <label>Username<input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" /></label>
          <label>Password / PIN<input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" /></label>
          <button className="primary" disabled={loading}>{loading ? 'Opening...' : 'Open Dashboard'}</button>
          {error && <div className="error">{error}</div>}
        </form>
      </section>
    </div>
  );
}

function Overview({ summary }: { summary: Summary }) {
  const register = summary.register;
  const kpis = [
    ['Gross Sales', money(summary.sales.grossSales), `${summary.sales.billCount} bills`],
    ['Real Refunds', money(summary.sales.refunds), 'Correction returns separate'],
    ['Online Sales', money(summary.sales.onlineSales), `Expected ${money(register?.expectedOnline)}`],
    ['Khata Sales', money(summary.sales.khataSales), `${summary.khata.customersOwing} owing customers`],
    ['Milk Bought', `${qty(summary.suppliers.milkKgToday)} kg`, money(summary.suppliers.milkPurchaseToday)],
    ['Supplier Payable', money(summary.suppliers.payableToSuppliers), `${summary.suppliers.activeSuppliers} active suppliers`],
    ['Expenses', money(summary.expenses.today), 'Selected date'],
    ['Stock Value', money(summary.inventory.stockValue), `Milk ${qty(summary.inventory.milkKg)} kg, yogurt ${qty(summary.inventory.yogurtKg)} kg`],
  ];

  return (
    <div className="view">
      <div className="heroGrid">
        <article className="hero">
          <p className="eyebrow">Net sales</p>
          <strong>{money(summary.sales.netSales)}</strong>
          <p>Real refunds are subtracted. Accidental corrections stay separate.</p>
          <div className="chips">
            <span>{summary.sales.billCount} bills</span>
            <span>Avg {money(summary.sales.avgBill)}</span>
            <span>{summary.shift ? `Shift open ${Math.floor(summary.shift.minutesOpen / 60)}h ${summary.shift.minutesOpen % 60}m` : 'No open shift'}</span>
            <span>{summary.devices.some((x) => x.health === 'online') ? 'POS online' : 'No live POS'}</span>
          </div>
        </article>
        <article className="card">
          <div className="cardHead">
            <div><p className="eyebrow">Cash register</p><h3>{register?.isClosed ? 'Closed register' : 'Open register'}</h3></div>
            <span className={register?.isClosed ? 'badge warn' : 'badge good'}>{register?.isClosed ? 'Closed' : 'Open'}</span>
          </div>
          <strong className="big">{money(register?.expectedCash)}</strong>
          <Rows rows={[
            ['Opening cash', money(register?.openingCash)],
            ['Cash in', money(register?.cashIn)],
            ['Cash out', money(register?.cashOut)],
            ['Online expected', money(register?.expectedOnline)],
          ]} />
        </article>
      </div>
      <div className="kpis">{kpis.map(([title, value, note]) => <Metric key={title} title={title} value={value} note={note} />)}</div>
      <div className="grid">
        <article className="card wide"><div className="cardHead"><div><p className="eyebrow">Trend</p><h3>Last 7 Days</h3></div><span className="badge">Net</span></div><LineChart rows={summary.charts.salesTrend} /></article>
        <article className="card"><div className="cardHead"><div><p className="eyebrow">Collection</p><h3>Payment Mix</h3></div></div><PaymentMix rows={summary.charts.paymentMix} /></article>
      </div>
    </div>
  );
}

function Sales({ summary }: { summary: Summary }) {
  return (
    <div className="grid">
      <Panel title="Top Products" eyebrow="Products"><Rows rows={summary.charts.topProducts.map((x) => [x.name, money(x.revenue), `${qty(x.quantity)} ${x.unit}`])} empty="No product sales." /></Panel>
      <Panel title="Expense Categories" eyebrow="Costs"><Rows rows={summary.charts.expenseByCategory.map((x) => [x.category.replaceAll('_', ' '), money(x.amount)])} empty="No expenses." /></Panel>
      <Panel title="Recent Sales" eyebrow="Receipts" wide><Rows rows={summary.recentSales.map((x) => [x.billNumber, money(x.grandTotal), `${x.paymentType} / ${x.customerName}`])} empty="No sales for this date." /></Panel>
      <Panel title="Khata and Supplier Money" eyebrow="Money" wide><Rows rows={[
        ['Customer khata due', money(summary.khata.totalDue), `${summary.khata.customersOwing} customers`],
        ['Supplier payable', money(summary.suppliers.payableToSuppliers), `${summary.suppliers.activeSuppliers} suppliers`],
        ['Supplier paid today', money(summary.suppliers.supplierPaymentsToday), 'Cash out'],
        ['Correction returns', money(summary.sales.correctionReturns.amount), `${summary.sales.correctionReturns.count} entries`],
      ]} /></Panel>
    </div>
  );
}

function Operations({ summary }: { summary: Summary }) {
  return (
    <div className="grid">
      <Panel title="Device Health" eyebrow="Sync"><Rows rows={summary.devices.map((x) => [x.deviceName, x.health, `${x.minutesSinceSeen ?? '-'} minutes ago`])} empty="No registered devices." /></Panel>
      <Panel title="Inventory Alerts" eyebrow="Stock"><Rows rows={summary.inventory.alerts.map((x) => [x.name, `${qty(x.stock)} ${x.unit}`, `Threshold ${qty(x.threshold)}`])} empty="No low stock alerts." /></Panel>
      <Panel title="Supplier Balances" eyebrow="Farmers"><Rows rows={summary.charts.supplierBalances.map((x) => [x.name, money(x.balance), x.mode === 'SEPARATE' ? `Cow ${money(x.cowRate)} / Buffalo ${money(x.buffaloRate)}` : `Mixed ${money(x.defaultRate)}`])} empty="No suppliers." /></Panel>
      <Panel title="Milk / Yogurt Volume" eyebrow="Volume"><Rows rows={summary.charts.salesTrend.map((x) => [x.date, `Milk ${qty(x.milkKg)} kg`, `Yogurt ${qty(x.yogurtKg)} kg`])} empty="No volume data." /></Panel>
    </div>
  );
}

function SupplierEntry({ suppliers, token, reload, notify }: { suppliers: SupplierOption[]; token: string; reload: () => void; notify: (message: string) => void }) {
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(todayIso());
  const [shift, setShift] = useState('MORNING');
  const [milkType, setMilkType] = useState('MIXED');
  const [quantityValue, setQuantityValue] = useState('');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState('');

  const supplier = useMemo(() => suppliers.find((x) => x.id === supplierId) || suppliers[0], [supplierId, suppliers]);

  useEffect(() => {
    if (!supplier) return;
    setSupplierId(supplier.id);
    setMilkType(supplier.milkSupplyMode === 'SEPARATE' ? 'COW' : 'MIXED');
  }, [supplier?.id]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!supplier) return;
    try {
      const result = await api.createSupplierEntry(token, { supplierId: supplier.id, date, shift, milkType, quantity: Number(quantityValue), notes });
      setMessage(`Saved ${result.supplierName}: ${qty(result.quantity)} kg @ ${money(result.rate)} = ${money(result.totalAmount)}`);
      setQuantityValue('');
      setNotes('');
      reload();
      notify('Supplier milk entry saved.');
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not save entry');
    }
  };

  return (
    <article className="card wide">
      <div className="cardHead">
        <div><p className="eyebrow">Cloud entry</p><h3>Supplier Milk Entry</h3><p>Saved directly on VPS. POS pulls this data before supplier work.</p></div>
        <button onClick={reload}>Reload Suppliers</button>
      </div>
      <form className="supplierForm" onSubmit={submit}>
        <label>Supplier<select value={supplier?.id || ''} onChange={(e) => setSupplierId(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.milkSupplyMode})</option>)}</select></label>
        <label>Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label>Shift<select value={shift} onChange={(e) => setShift(e.target.value)}><option value="MORNING">Morning</option><option value="EVENING">Evening</option></select></label>
        <label>Milk Type<select value={milkType} disabled={supplier?.milkSupplyMode !== 'SEPARATE'} onChange={(e) => setMilkType(e.target.value)}><option value="MIXED">Mixed</option><option value="COW">Cow</option><option value="BUFFALO">Buffalo</option></select></label>
        <label>Quantity kg<input type="number" min="0.25" step="0.25" value={quantityValue} onChange={(e) => setQuantityValue(e.target.value)} /></label>
        <label>Notes<input value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
        <button className="primary">Save Milk Entry</button>
      </form>
      {supplier && <p className="hint">{supplier.milkSupplyMode === 'SEPARATE' ? `Separate supplier: cow ${money(supplier.cowRate)}, buffalo ${money(supplier.buffaloRate)}` : `Mixed supplier rate ${money(supplier.defaultRate)}`} / Balance {money(supplier.currentBalance)}</p>}
      {message && <div className={message.startsWith('Saved') ? 'success' : 'error'}>{message}</div>}
    </article>
  );
}

function Metric({ title, value, note }: { title: string; value: string; note: string }) {
  return <article className="metric"><p className="metricTitle">{title}</p><strong>{value}</strong><span>{note}</span></article>;
}

function Panel({ title, eyebrow, children, wide }: { title: string; eyebrow: string; children: React.ReactNode; wide?: boolean }) {
  return <article className={`card ${wide ? 'wide' : ''}`}><div className="cardHead"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div></div>{children}</article>;
}

function Rows({ rows, empty }: { rows: Array<[string, string, string?]>; empty?: string }) {
  if (!rows.length) return <p className="hint">{empty || 'No data.'}</p>;
  return <div>{rows.map(([left, right, note], index) => <div className="row" key={`${left}-${index}`}><span>{left}{note && <small>{note}</small>}</span><strong>{right}</strong></div>)}</div>;
}

function PaymentMix({ rows }: { rows: Summary['charts']['paymentMix'] }) {
  const total = rows.reduce((sum, row) => sum + Number(row.value || 0), 0) || 1;
  return <div className="mix">{rows.map((row, index) => {
    const pct = Math.round(Number(row.value || 0) / total * 100);
    return <div className="mixRow" key={row.name}><b>{row.name}</b><div className="track"><span className={`fill fill${index}`} style={{ width: `${pct}%` }} /></div><strong>{money(row.value)}</strong></div>;
  })}</div>;
}

function LineChart({ rows }: { rows: Summary['charts']['salesTrend'] }) {
  if (!rows.length) return <div className="chart empty">No sales trend yet.</div>;
  const width = 820;
  const height = 270;
  const pad = 34;
  const max = Math.max(1, ...rows.map((row) => Number(row.netSales || 0)));
  const points = rows.map((row, index) => ({
    x: pad + (index * (width - pad * 2)) / Math.max(1, rows.length - 1),
    y: height - pad - (Number(row.netSales || 0) / max) * (height - pad * 2),
    row,
  }));
  const line = points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${pad},${height - pad} ${line} ${width - pad},${height - pad}`;
  return <div className="chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Seven day net sales chart">
    <defs><linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#047d75" stopOpacity=".26" /><stop offset="100%" stopColor="#047d75" stopOpacity="0" /></linearGradient></defs>
    <rect width={width} height={height} fill="#f8fbfc" />
    {[0, 1, 2, 3].map((i) => <line key={i} x1={pad} y1={pad + i * ((height - pad * 2) / 3)} x2={width - pad} y2={pad + i * ((height - pad * 2) / 3)} stroke="#d9e3e7" />)}
    <polygon points={area} fill="url(#salesFill)" />
    <polyline points={line} fill="none" stroke="#047d75" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    {points.map((point) => <circle key={point.row.date} cx={point.x} cy={point.y} r="6" fill="#fff" stroke="#047d75" strokeWidth="4"><title>{point.row.date} {money(point.row.netSales)}</title></circle>)}
    {points.map((point) => <text key={`${point.row.date}-label`} x={point.x} y={height - 10} textAnchor="middle" fill="#637780" fontSize="12" fontWeight="800">{point.row.date.slice(5)}</text>)}
  </svg></div>;
}

function LoadingGrid() {
  return <div className="kpis">{Array.from({ length: 8 }).map((_, index) => <div className="skeleton" key={index} />)}</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
