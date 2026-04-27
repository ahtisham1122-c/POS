export const KEYS = {
  PRODUCTS: 'nd_products',
  CUSTOMERS: 'nd_customers',
  SALES: 'nd_sales',
  SALE_ITEMS: 'nd_sale_items',
  PAYMENTS: 'nd_payments',
  LEDGER: 'nd_ledger',
  STOCK_MOVEMENTS: 'nd_stock_movements',
  EXPENSES: 'nd_expenses',
  DAILY_RATES: 'nd_daily_rates',
  CASH_REGISTER: 'nd_cash_register',
  SETTINGS: 'nd_settings',
  ACTIVITY_LOG: 'nd_activity_log',
  HELD_BILLS: 'nd_held_bills',
};

const defaultProducts = [
  { id: "PRD-001", name: "Full Cream Milk", category: "Milk", unit: "kg", price: 220, cost: 170, stock: 50, emoji: "🥛", lowStockThreshold: 5 },
  { id: "PRD-002", name: "Yogurt (Dahi)", category: "Yogurt", unit: "kg", price: 180, cost: 130, stock: 30, emoji: "🫙", lowStockThreshold: 5 },
  { id: "PRD-003", name: "Desi Ghee", category: "Butter & Cream", unit: "kg", price: 2200, cost: 1900, stock: 15, emoji: "🧈", lowStockThreshold: 3 },
  { id: "PRD-004", name: "Lassi", category: "Drinks", unit: "500ml", price: 120, cost: 80, stock: 40, emoji: "🥤", lowStockThreshold: 5 },
  { id: "PRD-005", name: "Butter", category: "Butter & Cream", unit: "250g", price: 320, cost: 260, stock: 20, emoji: "🫐", lowStockThreshold: 5 },
  { id: "PRD-006", name: "Cream (Malai)", category: "Butter & Cream", unit: "250g", price: 280, cost: 210, stock: 15, emoji: "🍶", lowStockThreshold: 3 },
  { id: "PRD-007", name: "Paneer", category: "Cheese", unit: "500g", price: 400, cost: 320, stock: 10, emoji: "🧀", lowStockThreshold: 3 },
  { id: "PRD-008", name: "Khoya (Mawa)", category: "Other", unit: "250g", price: 350, cost: 280, stock: 8, emoji: "🥣", lowStockThreshold: 2 }
];

const defaultCustomers = [
  { id: "CUST-001", name: "Ahmed Bhai", phone: "0300-1234567", address: "Shop 4, Gulshan", balance: -450, cardNo: "C-101" },
  { id: "CUST-002", name: "Fatima Begum", phone: "0321-9876543", address: "House 12, DHA", balance: 0, cardNo: "C-102" },
  { id: "CUST-003", name: "Raza Stores", phone: "0333-5554444", address: "Main Market", balance: -1200, cardNo: "C-103" }
];

const defaultSettings = {
  shopName: "Noon Dairy 🐄",
  phone: "0300-0000000",
  address: "Main Market, City",
  footerMsg: "Thank you! Come again 🙏",
  cashiers: ["Admin", "Cashier 1", "Cashier 2"],
  defaultCashier: "Admin"
};

export const initializeDB = () => {
  if (!localStorage.getItem(KEYS.PRODUCTS)) {
    localStorage.setItem(KEYS.PRODUCTS, JSON.stringify(defaultProducts));
    localStorage.setItem(KEYS.CUSTOMERS, JSON.stringify(defaultCustomers));
    localStorage.setItem(KEYS.SALES, JSON.stringify([]));
    localStorage.setItem(KEYS.SALE_ITEMS, JSON.stringify([]));
    localStorage.setItem(KEYS.PAYMENTS, JSON.stringify([]));
    localStorage.setItem(KEYS.LEDGER, JSON.stringify([]));
    localStorage.setItem(KEYS.STOCK_MOVEMENTS, JSON.stringify([]));
    localStorage.setItem(KEYS.EXPENSES, JSON.stringify([]));
    localStorage.setItem(KEYS.DAILY_RATES, JSON.stringify({ milk: 220, yogurt: 180, lastUpdated: new Date().toISOString() }));
    localStorage.setItem(KEYS.CASH_REGISTER, JSON.stringify({ date: new Date().toISOString().split('T')[0], opening: 0, cashIn: 0, cashOut: 0, closed: false }));
    localStorage.setItem(KEYS.SETTINGS, JSON.stringify(defaultSettings));
    localStorage.setItem(KEYS.ACTIVITY_LOG, JSON.stringify([]));
    localStorage.setItem(KEYS.HELD_BILLS, JSON.stringify([]));
    
    logActivity("System Initialized");
  }
};

export const getDB = (key: string) => JSON.parse(localStorage.getItem(key) || 'null') || (key === KEYS.SETTINGS ? defaultSettings : []);
export const setDB = (key: string, data: any) => {
  localStorage.setItem(key, JSON.stringify(data));
  window.dispatchEvent(new Event('db_updated'));
};

export const logActivity = (desc: string, user = "System") => {
  const logs = getDB(KEYS.ACTIVITY_LOG);
  logs.unshift({ id: `LOG-${Date.now()}`, date: new Date().toISOString(), desc, user });
  if(logs.length > 500) logs.pop();
  setDB(KEYS.ACTIVITY_LOG, logs);
};

export const generateId = (prefix: string, key: string) => {
  const items = getDB(key);
  const num = items.length + 1;
  return `${prefix}-${num.toString().padStart(4, '0')}`;
};
