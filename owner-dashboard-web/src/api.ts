const API_URL = (import.meta.env.VITE_API_URL || 'http://72.62.112.216/api').replace(/\/+$/, '');

export type User = {
  id: string;
  name: string;
  username: string;
  role: 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';
};

export type SupplierOption = {
  id: string;
  code: string;
  name: string;
  allowedShifts: string;
  milkSupplyMode: 'MIXED' | 'SEPARATE';
  defaultRate: number;
  cowRate: number;
  buffaloRate: number;
  currentBalance: number;
};

export type Summary = {
  date: string;
  generatedAt: string;
  sales: {
    billCount: number;
    grossSales: number;
    refunds: number;
    correctionReturns: { count: number; amount: number };
    netSales: number;
    cashSales: number;
    onlineSales: number;
    khataSales: number;
    avgBill: number;
  };
  register: null | {
    isClosed: boolean;
    openingCash: number;
    cashIn: number;
    cashOut: number;
    expectedCash: number;
    closingCash: number;
    expectedOnline: number;
    closingOnline: number;
    onlineVariance: number;
  };
  shift: null | { id: string; date: string; openedAt: string; minutesOpen: number };
  khata: { customersOwing: number; totalDue: number };
  suppliers: {
    activeSuppliers: number;
    milkKgToday: number;
    milkPurchaseToday: number;
    milkCollectionEntries: number;
    supplierPaymentsToday: number;
    payableToSuppliers: number;
  };
  expenses: { today: number };
  inventory: {
    stockValue: number;
    lowStockCount: number;
    outOfStockCount: number;
    milkKg: number;
    yogurtKg: number;
    alerts: Array<{ code: string; name: string; stock: number; threshold: number; unit: string }>;
  };
  devices: Array<{
    deviceId: string;
    deviceName: string;
    terminalNumber: number;
    health: string;
    minutesSinceSeen: number | null;
  }>;
  recentSales: Array<{
    billNumber: string;
    saleDate: string;
    paymentType: string;
    grandTotal: number;
    customerName: string;
  }>;
  charts: {
    salesTrend: Array<{
      date: string;
      bills: number;
      grossSales: number;
      refunds: number;
      netSales: number;
      expenses: number;
      cogs: number;
      grossProfit: number;
      operatingProfit: number;
      milkKg: number;
      yogurtKg: number;
      milkPurchasedKg: number;
      milkPurchase: number;
      expectedCash: number;
      expectedOnline: number;
    }>;
    weeklyTrend: Array<{ label: string; bills: number; grossSales: number; refunds: number; netSales: number; expenses: number; milkKg: number; milkPurchase: number; operatingResult: number }>;
    monthlyTrend: Array<{ label: string; bills: number; grossSales: number; refunds: number; netSales: number; expenses: number; milkKg: number; milkPurchase: number; operatingResult: number }>;
    hourlySales: Array<{ hour: number; label: string; sales: number; bills: number }>;
    paymentMix: Array<{ name: string; value: number }>;
    topProducts: Array<{ name: string; unit: string; quantity: number; revenue: number }>;
    expenseByCategory: Array<{ category: string; amount: number }>;
    supplierBalances: Array<{ name: string; balance: number; mode: string; defaultRate: number; cowRate: number; buffaloRate: number; isActive: boolean }>;
    productContribution: Array<{ name: string; unit: string; quantity: number; revenue: number; grossProfit: number; marginPercent: number }>;
    topCustomers: Array<{ name: string; sales: number; bills: number; currentBalance: number }>;
  };
  analytics: {
    cogs: number;
    grossProfit: number;
    grossMarginPercent: number;
    estimatedOperatingProfit: number;
    expenseRatio: number;
    dayChangePercent: number;
    weekChangePercent: number;
    monthChangePercent: number;
    busiestHour: { hour: number; label: string; sales: number; bills: number };
    topProduct: null | { name: string; unit: string; quantity: number; revenue: number };
    selectedPeriod: {
      day: Summary['charts']['salesTrend'][number] | null;
      week: Summary['charts']['weeklyTrend'][number] | null;
      month: Summary['charts']['monthlyTrend'][number] | null;
    };
    dataQuality: {
      source: string;
      saleRows: number;
      returnRows: number;
      returnedItemRows: number;
      usesOriginalSaleItemCost: boolean;
      returnedItemCostIsEstimated: boolean;
      lastDeviceSeenMinutes: number | null;
    };
    insights: Array<{ tone: 'good' | 'warn' | 'danger' | 'info'; title: string; value: string; detail: string }>;
  };
};

type ApiEnvelope<T> = {
  success: boolean;
  data: T;
  message?: string;
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  user: User;
};

async function request<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  const body = (await res.json().catch(() => null)) as ApiEnvelope<T> | T | null;

  if (!res.ok) {
    const message = body && typeof body === 'object' && 'message' in body ? String(body.message) : `Request failed (${res.status})`;
    throw new Error(message);
  }

  if (body && typeof body === 'object' && 'success' in body && 'data' in body) {
    return body.data as T;
  }
  return body as T;
}

export const api = {
  apiUrl: API_URL,
  login(username: string, password: string) {
    return request<Session>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  refresh(refreshToken: string) {
    return request<Session>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
  },
  me(token: string) {
    return request<User>('/auth/me', {}, token);
  },
  summary(token: string, date?: string) {
    return request<Summary>(`/owner-dashboard/summary${date ? `?date=${encodeURIComponent(date)}` : ''}`, {}, token);
  },
  supplierEntryData(token: string) {
    return request<{ date: string; suppliers: SupplierOption[] }>('/owner-dashboard/supplier-entry-data', {}, token);
  },
  createSupplierEntry(token: string, payload: {
    supplierId: string;
    date: string;
    shift: string;
    milkType: string;
    quantity: number;
    notes?: string;
  }) {
    return request<{
      success: boolean;
      supplierName: string;
      quantity: number;
      rate: number;
      totalAmount: number;
    }>('/owner-dashboard/supplier-entries', {
      method: 'POST',
      body: JSON.stringify(payload),
    }, token);
  },
};
