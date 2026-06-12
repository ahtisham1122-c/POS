import React, { FormEvent, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { api, Session, Summary, SupplierOption } from './api';
import './styles.css';

const money = (value?: number | null) => `Rs. ${Math.round(Number(value || 0)).toLocaleString('en-PK')}`;
const qty = (value?: number | null) => Number(value || 0).toLocaleString('en-PK', { maximumFractionDigits: 2 });
const todayIso = () => new Date().toISOString().slice(0, 10);
const pct = (value?: number | null) => `${Number(value || 0) > 0 ? '+' : ''}${qty(value)}%`;

type View = 'overview' | 'analytics' | 'sales' | 'operations' | 'supplier';

function App() {
  const [session, setSession] = useState<Session | null>(() => {
    const raw = localStorage.getItem('owner-dashboard-session');
    return raw ? JSON.parse(raw) : null;
  });
  const [active, setActive] = useState<View>('overview');
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
            <p>Owner Intelligence</p>
          </div>
        </div>
        <nav className="nav">
          {[
            ['overview', 'Command Center'],
            ['analytics', 'Analytics'],
            ['sales', 'Sales & Money'],
            ['operations', 'Operations'],
            ['supplier', 'Supplier Entry'],
          ].map(([key, label]) => (
            <button key={key} className={active === key ? 'active' : ''} onClick={() => setActive(key as View)}>
              {label}
            </button>
          ))}
        </nav>
        <div className="serverPill"><span /> {api.apiUrl}</div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <p className="eyebrow">Private VPS control room</p>
            <h2>{pageTitle(active)}</h2>
            <p>{summary ? `Date ${summary.date} | Updated ${new Date(summary.generatedAt).toLocaleString('en-PK', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Loading live shop data'}</p>
          </div>
          <div className="toolbar">
            <input type="date" value={date} onChange={(event) => { setDate(event.target.value); loadSummary(event.target.value); }} />
            <button onClick={() => changeDate(-1)}>Previous</button>
            <button onClick={() => changeDate(1)}>Next</button>
            <button onClick={() => { setDate(todayIso()); loadSummary(todayIso()); }}>Today</button>
            <button className="primary" disabled={loading} onClick={() => loadSummary()}>{loading ? 'Loading...' : 'Refresh'}</button>
            <button className="danger" onClick={() => saveSession(null)}>Logout</button>
          </div>
        </header>

        {error && <div className="error">{error}</div>}
        {!summary ? <LoadingGrid /> : (
          <>
            {active === 'overview' && <Overview summary={summary} />}
            {active === 'analytics' && <Analytics summary={summary} />}
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

function pageTitle(view: View) {
  return {
    overview: 'Executive Command Center',
    analytics: 'Growth Analytics',
    sales: 'Sales, Cash and Khata',
    operations: 'Operations Health',
    supplier: 'Supplier Milk Entry',
  }[view];
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
          <h1>Owner dashboard for sales, cash, stock, suppliers and growth.</h1>
          <p>Track the shop from mobile or desktop with live synced POS data, commercial trends, alerts, and smart daily decisions.</p>
        </div>
        <form className="loginCard" onSubmit={submit}>
          <label>Username<input value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" /></label>
          <label>Password / PIN<input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete="current-password" /></label>
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
    ['Net Sales', money(summary.sales.netSales), `${summary.sales.billCount} bills`, 'good'],
    ['Gross Profit', money(summary.analytics.grossProfit), `${qty(summary.analytics.grossMarginPercent)}% gross margin`, 'info'],
    ['Expected Cash', money(register?.expectedCash), register?.isClosed ? 'Register closed' : 'Open register', register?.isClosed ? 'warn' : 'good'],
    ['Online Expected', money(register?.expectedOnline), `Variance ${money(register?.onlineVariance)}`, 'info'],
    ['Khata Sales', money(summary.sales.khataSales), `${summary.khata.customersOwing} customers owing`, 'warn'],
    ['Expenses', money(summary.expenses.today), `${qty(summary.analytics.expenseRatio)}% of net sales`, 'danger'],
    ['Milk Bought', `${qty(summary.suppliers.milkKgToday)} kg`, money(summary.suppliers.milkPurchaseToday), 'info'],
    ['Stock Value', money(summary.inventory.stockValue), `${summary.inventory.lowStockCount + summary.inventory.outOfStockCount} stock alerts`, 'warn'],
  ];

  return (
    <div className="view">
      <div className="heroGrid">
        <article className="hero">
          <p className="eyebrow">Today / selected date</p>
          <strong>{money(summary.sales.netSales)}</strong>
          <p>Net sales after real refunds. Correction returns are tracked separately, so accidental receipts do not destroy profit.</p>
          <div className="chips">
            <span>{summary.sales.billCount} bills</span>
            <span>Avg {money(summary.sales.avgBill)}</span>
            <span>{pct(summary.analytics.dayChangePercent)} vs previous day</span>
            <span>{summary.devices.some((device) => device.health === 'online') ? 'POS online' : 'POS not seen'}</span>
          </div>
        </article>
        <article className="card commandCard">
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

      <div className="kpis">{kpis.map(([title, value, note, tone]) => <Metric key={title} title={title} value={value} note={note} tone={tone} />)}</div>

      <div className="insights">
        {summary.analytics.insights.map((insight) => <InsightCard key={insight.title} {...insight} />)}
      </div>

      <div className="grid">
        <Panel title="30 Day Sales, Expense and Profit Trend" eyebrow="Trend" wide action={`${pct(summary.analytics.monthChangePercent)} month`}>
          <TrendChart rows={summary.charts.salesTrend} />
        </Panel>
        <Panel title="Payment Collection Mix" eyebrow="Cash / online / khata">
          <Donut rows={summary.charts.paymentMix} />
        </Panel>
        <Panel title="Hourly Sales Flow" eyebrow="Peak time">
          <BarChart rows={summary.charts.hourlySales.map((row) => ({ label: row.label.slice(0, 2), value: row.sales, note: `${row.bills} bills` }))} />
        </Panel>
      </div>
    </div>
  );
}

function Analytics({ summary }: { summary: Summary }) {
  const weeklyRows = summary.charts.weeklyTrend.map((row) => ({ label: row.label.slice(5, 10), value: row.netSales, note: `${row.bills} bills` }));
  const monthlyRows = summary.charts.monthlyTrend.map((row) => ({ label: row.label.slice(5), value: row.netSales, note: `${row.bills} bills` }));

  return (
    <div className="view">
      <div className="executiveStrip">
        <Metric title="Weekly Growth" value={pct(summary.analytics.weekChangePercent)} note="vs previous 7 days" tone={summary.analytics.weekChangePercent >= 0 ? 'good' : 'warn'} />
        <Metric title="Monthly Growth" value={pct(summary.analytics.monthChangePercent)} note="vs previous month" tone={summary.analytics.monthChangePercent >= 0 ? 'good' : 'warn'} />
        <Metric title="COGS" value={money(summary.analytics.cogs)} note="Net product cost after real returns" tone="warn" />
        <Metric title="Gross Margin" value={`${qty(summary.analytics.grossMarginPercent)}%`} note={money(summary.analytics.grossProfit)} tone="info" />
        <Metric title="Operating Result" value={money(summary.analytics.estimatedOperatingProfit)} note="Gross profit minus expenses" tone={summary.analytics.estimatedOperatingProfit >= 0 ? 'good' : 'danger'} />
      </div>

      <div className="grid">
        <Panel title="30 Day Profit Quality" eyebrow="Net sales / gross profit / operating profit" wide><ProfitChart rows={summary.charts.salesTrend} /></Panel>
        <Panel title="Cash and Online Position" eyebrow="Register trend" wide><CashTrendChart rows={summary.charts.salesTrend} /></Panel>
        <Panel title="Weekly Net Sales" eyebrow="8 week view" wide><BarChart rows={weeklyRows} /></Panel>
        <Panel title="Monthly Net Sales" eyebrow="12 month view" wide><BarChart rows={monthlyRows} /></Panel>
        <Panel title="Product Profit Contribution" eyebrow="Margin">
          <Rows rows={summary.charts.productContribution.map((x) => [x.name, money(x.grossProfit), `${money(x.revenue)} sales / ${qty(x.marginPercent)}% margin`])} empty="No product profit data." />
        </Panel>
        <Panel title="Best Customers" eyebrow="Khata behaviour">
          <Rows rows={summary.charts.topCustomers.map((x) => [x.name, money(x.sales), `${x.bills} bills / owes ${money(x.currentBalance)}`])} empty="No customer sales." />
        </Panel>
        <Panel title="Top Product Today" eyebrow="Leader">
          {summary.analytics.topProduct ? (
            <div className="spotlight">
              <strong>{summary.analytics.topProduct.name}</strong>
              <span>{money(summary.analytics.topProduct.revenue)}</span>
              <p>{qty(summary.analytics.topProduct.quantity)} {summary.analytics.topProduct.unit} sold</p>
            </div>
          ) : <p className="hint">No product leader yet.</p>}
        </Panel>
        <Panel title="Decision Notes" eyebrow="Owner insights">
          <Rows rows={summary.analytics.insights.map((x) => [x.title, x.value, x.detail])} />
        </Panel>
        <Panel title="Data Accuracy" eyebrow="Source and confidence">
          <Rows rows={[
            ['Source', summary.analytics.dataQuality.source, `${summary.analytics.dataQuality.saleRows} sale rows`],
            ['Returns checked', `${summary.analytics.dataQuality.returnRows} returns`, `${summary.analytics.dataQuality.returnedItemRows} return item rows`],
            ['Sale item cost', summary.analytics.dataQuality.usesOriginalSaleItemCost ? 'Original cost saved' : 'Missing', 'Profit uses sale item cost where possible'],
            ['Return item cost', summary.analytics.dataQuality.returnedItemCostIsEstimated ? 'Estimated' : 'No real returns', 'Return items do not store original cost yet'],
            ['Last POS seen', summary.analytics.dataQuality.lastDeviceSeenMinutes === null ? 'No device' : `${summary.analytics.dataQuality.lastDeviceSeenMinutes} min ago`, 'Cloud freshness check'],
          ]} />
        </Panel>
      </div>
    </div>
  );
}

function Sales({ summary }: { summary: Summary }) {
  return (
    <div className="grid">
      <Panel title="Sales Breakdown" eyebrow="Selected date">
        <Rows rows={[
          ['Gross sales', money(summary.sales.grossSales), `${summary.sales.billCount} bills`],
          ['Real refunds', money(summary.sales.refunds), 'Subtracted from sales'],
          ['Net sales', money(summary.sales.netSales), `Average bill ${money(summary.sales.avgBill)}`],
          ['Correction returns', money(summary.sales.correctionReturns.amount), `${summary.sales.correctionReturns.count} accidental entries`],
        ]} />
      </Panel>
      <Panel title="Payment Mix" eyebrow="Collection">
        <PaymentMix rows={summary.charts.paymentMix} />
      </Panel>
      <Panel title="Top Products" eyebrow="Products">
        <Rows rows={summary.charts.topProducts.map((x) => [x.name, money(x.revenue), `${qty(x.quantity)} ${x.unit}`])} empty="No product sales." />
      </Panel>
      <Panel title="Expense Categories" eyebrow="Costs">
        <Rows rows={summary.charts.expenseByCategory.map((x) => [x.category.replaceAll('_', ' '), money(x.amount)])} empty="No expenses." />
      </Panel>
      <Panel title="Recent Sales" eyebrow="Receipts" wide>
        <Rows rows={summary.recentSales.map((x) => [x.billNumber, money(x.grandTotal), `${new Date(x.saleDate).toLocaleTimeString('en-PK', { hour: '2-digit', minute: '2-digit' })} / ${x.paymentType} / ${x.customerName}`])} empty="No sales for this date." />
      </Panel>
      <Panel title="Khata and Supplier Money" eyebrow="Balances" wide>
        <Rows rows={[
          ['Customer khata due', money(summary.khata.totalDue), `${summary.khata.customersOwing} customers`],
          ['Supplier payable', money(summary.suppliers.payableToSuppliers), `${summary.suppliers.activeSuppliers} suppliers`],
          ['Supplier paid today', money(summary.suppliers.supplierPaymentsToday), 'Cash out'],
          ['Milk purchase today', money(summary.suppliers.milkPurchaseToday), `${qty(summary.suppliers.milkKgToday)} kg`],
        ]} />
      </Panel>
    </div>
  );
}

function Operations({ summary }: { summary: Summary }) {
  return (
    <div className="grid">
      <Panel title="Device Health" eyebrow="Cloud sync">
        <Rows rows={summary.devices.map((x) => [x.deviceName, x.health, `${x.minutesSinceSeen ?? '-'} minutes ago`])} empty="No registered devices." />
      </Panel>
      <Panel title="Inventory Alerts" eyebrow="Stock">
        <Rows rows={summary.inventory.alerts.map((x) => [x.name, `${qty(x.stock)} ${x.unit}`, `Threshold ${qty(x.threshold)}`])} empty="No low stock alerts." />
      </Panel>
      <Panel title="All Farmer Balances" eyebrow={`${summary.charts.supplierBalances.length} farmers`}>
        <Rows rows={summary.charts.supplierBalances.map((x) => [
          x.isActive ? x.name : `${x.name} (inactive)`,
          money(x.balance),
          x.mode === 'SEPARATE' ? `Cow ${money(x.cowRate)} / Buffalo ${money(x.buffaloRate)}` : `Mixed ${money(x.defaultRate)}`,
        ])} empty="No suppliers." />
      </Panel>
      <Panel title="Milk / Yogurt Volume" eyebrow="30 day volume" wide>
        <StackedVolume rows={summary.charts.salesTrend} />
      </Panel>
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
        <label>Supplier<select value={supplier?.id || ''} onChange={(event) => setSupplierId(event.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.milkSupplyMode})</option>)}</select></label>
        <label>Date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
        <label>Shift<select value={shift} onChange={(event) => setShift(event.target.value)}><option value="MORNING">Morning</option><option value="EVENING">Evening</option></select></label>
        <label>Milk Type<select value={milkType} disabled={supplier?.milkSupplyMode !== 'SEPARATE'} onChange={(event) => setMilkType(event.target.value)}><option value="MIXED">Mixed</option><option value="COW">Cow</option><option value="BUFFALO">Buffalo</option></select></label>
        <label>Quantity kg<input type="number" min="0.25" step="0.25" value={quantityValue} onChange={(event) => setQuantityValue(event.target.value)} /></label>
        <label>Notes<input value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
        <button className="primary">Save Milk Entry</button>
      </form>
      {supplier && <p className="hint">{supplier.milkSupplyMode === 'SEPARATE' ? `Separate supplier: cow ${money(supplier.cowRate)}, buffalo ${money(supplier.buffaloRate)}` : `Mixed supplier rate ${money(supplier.defaultRate)}`} / Balance {money(supplier.currentBalance)}</p>}
      {message && <div className={message.startsWith('Saved') ? 'success' : 'error'}>{message}</div>}
    </article>
  );
}

function Metric({ title, value, note, tone = 'info' }: { title: string; value: string; note: string; tone?: string }) {
  return <article className={`metric tone-${tone}`}><p className="metricTitle">{title}</p><strong>{value}</strong><span>{note}</span></article>;
}

function InsightCard({ tone, title, value, detail }: { tone: string; title: string; value: string; detail: string }) {
  return <article className={`insight tone-${tone}`}><span>{title}</span><strong>{value}</strong><p>{detail}</p></article>;
}

function Panel({ title, eyebrow, children, wide, action }: { title: string; eyebrow: string; children: React.ReactNode; wide?: boolean; action?: string }) {
  return <article className={`card ${wide ? 'wide' : ''}`}><div className="cardHead"><div><p className="eyebrow">{eyebrow}</p><h3>{title}</h3></div>{action && <span className="badge">{action}</span>}</div>{children}</article>;
}

function Rows({ rows, empty }: { rows: Array<[string, string, string?]>; empty?: string }) {
  if (!rows.length) return <p className="hint">{empty || 'No data.'}</p>;
  return <div>{rows.map(([left, right, note], index) => <div className="row" key={`${left}-${index}`}><span>{left}{note && <small>{note}</small>}</span><strong>{right}</strong></div>)}</div>;
}

function PaymentMix({ rows }: { rows: Summary['charts']['paymentMix'] }) {
  const total = rows.reduce((sum, row) => sum + Number(row.value || 0), 0) || 1;
  return <div className="mix">{rows.map((row, index) => {
    const percent = Math.round(Number(row.value || 0) / total * 100);
    return <div className="mixRow" key={row.name}><b>{row.name}</b><div className="track"><span className={`fill fill${index}`} style={{ width: `${percent}%` }} /></div><strong>{money(row.value)}</strong></div>;
  })}</div>;
}

function Donut({ rows }: { rows: Summary['charts']['paymentMix'] }) {
  const total = rows.reduce((sum, row) => sum + Number(row.value || 0), 0);
  let offset = 25;
  const colors = ['#0f9f8f', '#246bfe', '#d59622'];
  return (
    <div className="donutWrap">
      <svg viewBox="0 0 42 42" className="donut">
        <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="#e6edf0" strokeWidth="5" />
        {rows.map((row, index) => {
          const slice = total > 0 ? Number(row.value || 0) / total * 100 : 0;
          const circle = <circle key={row.name} cx="21" cy="21" r="15.9" fill="transparent" stroke={colors[index % colors.length]} strokeWidth="5" strokeDasharray={`${slice} ${100 - slice}`} strokeDashoffset={offset} />;
          offset -= slice;
          return circle;
        })}
      </svg>
      <div>
        <strong>{money(total)}</strong>
        <PaymentMix rows={rows} />
      </div>
    </div>
  );
}

function TrendChart({ rows }: { rows: Summary['charts']['salesTrend'] }) {
  if (!rows.length) return <div className="chart empty">No trend data.</div>;
  const width = 960;
  const height = 320;
  const pad = 42;
  const max = Math.max(1, ...rows.flatMap((row) => [Number(row.netSales || 0), Number(row.expenses || 0), Number(row.grossProfit || 0)]));
  const toPoint = (value: number, index: number) => ({
    x: pad + (index * (width - pad * 2)) / Math.max(1, rows.length - 1),
    y: height - pad - (value / max) * (height - pad * 2),
  });
  const netLine = rows.map((row, index) => toPoint(Number(row.netSales || 0), index)).map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const expenseLine = rows.map((row, index) => toPoint(Number(row.expenses || 0), index)).map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const area = `${pad},${height - pad} ${netLine} ${width - pad},${height - pad}`;
  return <div className="chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="30 day sales and expense trend">
    <defs><linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0f9f8f" stopOpacity=".24" /><stop offset="100%" stopColor="#0f9f8f" stopOpacity="0" /></linearGradient></defs>
    <rect width={width} height={height} fill="#ffffff" />
    {[0, 1, 2, 3].map((i) => <line key={i} x1={pad} y1={pad + i * ((height - pad * 2) / 3)} x2={width - pad} y2={pad + i * ((height - pad * 2) / 3)} stroke="#dfe8ec" />)}
    <polygon points={area} fill="url(#netFill)" />
    <polyline points={netLine} fill="none" stroke="#0f9f8f" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points={expenseLine} fill="none" stroke="#d24b5a" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="10 9" />
    <polyline points={rows.map((row, index) => toPoint(Number(row.grossProfit || 0), index)).map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')} fill="none" stroke="#246bfe" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    {rows.map((row, index) => index % 4 === 0 || index === rows.length - 1 ? <text key={row.date} x={toPoint(Number(row.netSales || 0), index).x} y={height - 10} textAnchor="middle" fill="#60747c" fontSize="12" fontWeight="800">{row.date.slice(5)}</text> : null)}
  </svg><div className="legend"><span className="legendNet" /> Net <span className="legendProfit" /> Gross profit <span className="legendExpense" /> Expenses</div></div>;
}

function ProfitChart({ rows }: { rows: Summary['charts']['salesTrend'] }) {
  return <LineCompareChart rows={rows.map((row) => ({
    label: row.date.slice(5),
    a: row.netSales,
    b: row.grossProfit,
    c: row.operatingProfit,
  }))} labels={['Net sales', 'Gross profit', 'Operating']} />;
}

function CashTrendChart({ rows }: { rows: Summary['charts']['salesTrend'] }) {
  return <LineCompareChart rows={rows.map((row) => ({
    label: row.date.slice(5),
    a: row.expectedCash,
    b: row.expectedOnline,
    c: row.milkPurchase,
  }))} labels={['Expected cash', 'Expected online', 'Milk purchase']} />;
}

function LineCompareChart({ rows, labels }: { rows: Array<{ label: string; a: number; b: number; c: number }>; labels: [string, string, string] }) {
  if (!rows.length) return <div className="chart empty">No chart data.</div>;
  const width = 960;
  const height = 300;
  const pad = 42;
  const min = Math.min(0, ...rows.flatMap((row) => [Number(row.a || 0), Number(row.b || 0), Number(row.c || 0)]));
  const max = Math.max(1, ...rows.flatMap((row) => [Number(row.a || 0), Number(row.b || 0), Number(row.c || 0)]));
  const span = Math.max(1, max - min);
  const toPoint = (value: number, index: number) => ({
    x: pad + (index * (width - pad * 2)) / Math.max(1, rows.length - 1),
    y: height - pad - ((value - min) / span) * (height - pad * 2),
  });
  const line = (key: 'a' | 'b' | 'c') => rows.map((row, index) => toPoint(Number(row[key] || 0), index)).map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  const zeroY = toPoint(0, 0).y;
  return <div className="chart"><svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={labels.join(', ')}>
    <rect width={width} height={height} fill="#ffffff" />
    {[0, 1, 2, 3].map((i) => <line key={i} x1={pad} y1={pad + i * ((height - pad * 2) / 3)} x2={width - pad} y2={pad + i * ((height - pad * 2) / 3)} stroke="#dfe8ec" />)}
    {min < 0 && <line x1={pad} y1={zeroY} x2={width - pad} y2={zeroY} stroke="#9aaeb6" strokeDasharray="7 7" />}
    <polyline points={line('a')} fill="none" stroke="#0f9f8f" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points={line('b')} fill="none" stroke="#246bfe" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    <polyline points={line('c')} fill="none" stroke="#d59622" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="9 8" />
    {rows.map((row, index) => index % 4 === 0 || index === rows.length - 1 ? <text key={`${row.label}-${index}`} x={toPoint(Number(row.a || 0), index).x} y={height - 10} textAnchor="middle" fill="#60747c" fontSize="12" fontWeight="800">{row.label}</text> : null)}
  </svg><div className="legend"><span className="legendNet" /> {labels[0]} <span className="legendProfit" /> {labels[1]} <span className="legendAmber" /> {labels[2]}</div></div>;
}

function BarChart({ rows }: { rows: Array<{ label: string; value: number; note?: string }> }) {
  if (!rows.length) return <p className="hint">No chart data.</p>;
  const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
  return <div className="barChart">{rows.map((row, index) => {
    const height = Math.max(5, Number(row.value || 0) / max * 100);
    return <div className="barItem" key={`${row.label}-${index}`}><div className="barColumn"><span style={{ height: `${height}%` }}><b>{money(row.value)}</b></span></div><small>{row.label}</small></div>;
  })}</div>;
}

function StackedVolume({ rows }: { rows: Summary['charts']['salesTrend'] }) {
  const compact = rows.slice(-14);
  const max = Math.max(1, ...compact.flatMap((row) => [Number(row.milkKg || 0), Number(row.yogurtKg || 0)]));
  return <div className="volumeGrid">{compact.map((row) => (
    <div className="volumeDay" key={row.date}>
      <div><span style={{ height: `${Number(row.milkKg || 0) / max * 100}%` }} /><em style={{ height: `${Number(row.yogurtKg || 0) / max * 100}%` }} /></div>
      <small>{row.date.slice(5)}</small>
    </div>
  ))}</div>;
}

function LoadingGrid() {
  return <div className="kpis">{Array.from({ length: 8 }).map((_, index) => <div className="skeleton" key={index} />)}</div>;
}

createRoot(document.getElementById('root')!).render(<App />);
