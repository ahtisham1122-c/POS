export interface ElectronAPI {
  auth: {
    login: (credentials: { username: string; password: string }) => Promise<any>;
    getMe: () => Promise<any>;
    getUsers: () => Promise<any[]>;
    logout: () => Promise<{ success: boolean }>;
    verifyManagerPin: (data: { pin: string; action?: string }) => Promise<{ success: boolean; approver?: any; error?: string }>;
    setManagerPin: (data: { userId?: string; currentPassword: string; newPin: string }) => Promise<{ success: boolean; error?: string }>;
  };
  audit: {
    getAll: (limit?: number) => Promise<any[]>;
    verifyIntegrity: () => Promise<{ success: boolean; valid: boolean; checked: number; badEntryId?: string; unsealedCount?: number; error?: string }>;
    sealLegacy: () => Promise<{ success: boolean; sealedCount?: number; checked?: number; error?: string }>;
  };
  products: {
    getAll: () => Promise<any[]>;
    getOne: (id: string) => Promise<any>;
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
    remove: (id: string) => Promise<any>;
    stockIn: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
    getMovements: (id: string) => Promise<any[]>;
  };
  inventory: {
    getSummary: () => Promise<any>;
    getLowStock: () => Promise<any[]>;
    getMovements: () => Promise<any[]>;
    getValuation: () => Promise<number>;
    stockIn: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
    stockOut: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
    adjustStock: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
    addWastage: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
  };
  suppliers: {
    getAll: () => Promise<any[]>;
    create: (data: any) => Promise<{ success: boolean; id?: string; error?: string }>;
    update: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
    collectMilk: (data: any) => Promise<{ success: boolean; collectionId?: string; totalAmount?: number; supplierBalance?: number; error?: string }>;
    collectPayment: (id: string, data: any) => Promise<{ success: boolean; paymentId?: string; balanceAfter?: number; error?: string }>;
    getCollections: (filters?: any) => Promise<any[]>;
    getLedger: (id: string) => Promise<any[]>;
    getCycleReport: (filters: any) => Promise<any>;
    getCycleStatement: (filters: any) => Promise<any | null>;
  };
  customers: {
    getAll: (filters?: any) => Promise<any[]>;
    getOne: (id: string) => Promise<any>;
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
    remove: (id: string) => Promise<any>;
    getLedger: (id: string) => Promise<any[]>;
    collectPayment: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
    search: (query: string) => Promise<any[]>;
    getStatement: (id: string, startDate?: string, endDate?: string) => Promise<{ customer: any; ledger: any[] } | null>;
  };
  sales: {
    getAll: (filters?: any) => Promise<any[]>;
    getOne: (id: string) => Promise<any>;
    getReceipt: (id: string) => Promise<any>;
    create: (data: any) => Promise<{ success: boolean; duplicate?: boolean; saleId?: string; transactionId?: string; billNumber?: string; subtotal?: number; discountAmount?: number; taxAmount?: number; taxRate?: number; taxLabel?: string; grandTotal?: number; amountPaid?: number; balanceDue?: number; cashPaid?: number; onlinePaid?: number; cashTendered?: number; changeReturned?: number; error?: string }>;
    void: (data: { saleId: string; reason: string; restockItems?: boolean; managerPin?: string }) => Promise<{ success: boolean; voidId?: string; billNumber?: string; cashReversed?: number; creditReversed?: number; restockedItems?: boolean; error?: string }>;
    hold: (data: any) => Promise<{ success: boolean; holdId?: string; error?: string }>;
    getHeld: () => Promise<any[]>;
    deleteHeld: (id: string) => Promise<{ success: boolean; error?: string }>;
  };
  returns: {
    getAll: (filters?: any) => Promise<any[]>;
    getSaleForReturn: (saleIdOrBillNumber: string) => Promise<any>;
    create: (data: any) => Promise<{ success: boolean; returnId?: string; returnNumber?: string; refundAmount?: number; error?: string }>;
  };
  receiptAudit: {
    preview: (data: any) => Promise<{ success: boolean; audit?: any; error?: string }>;
    save: (data: any) => Promise<{ success: boolean; sessionId?: string; audit?: any; error?: string }>;
    getHistory: (limit?: number) => Promise<any[]>;
    getLatestForDate: (date: string) => Promise<any | null>;
  };
  expenses: {
    getAll: (filters?: any) => Promise<any[]>;
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
    remove: (id: string) => Promise<any>;
    getSummary: () => Promise<any>;
  };
  reports: {
    getDailySummary: (date: string) => Promise<any>;
    getSalesChart: (days: number) => Promise<any[]>;
    getProductPerformance: () => Promise<any[]>;
    getEndOfDay: (date: string) => Promise<any>;
    getZReport: (date: string) => Promise<any>;
    closeRegister: (data: any) => Promise<any>;
    getCustomerDues: () => Promise<any[]>;
    getProfitLoss: (startDate: string, endDate: string) => Promise<any>;
    getMonthlySummary: (year: string) => Promise<any[]>;
    getDashboardStats: () => Promise<any>;
    exportReport: (data: { type: string; format: 'excel' | 'pdf'; params?: any }) => Promise<{ success: boolean; path?: string; reason?: string; error?: string }>;
  };
  dailyRates: {
    getToday: () => Promise<any>;
    update: (data: any) => Promise<any>;
  };
  cashRegister: {
    getToday: () => Promise<any>;
    open: (data: any) => Promise<any>;
    close: (data?: any) => Promise<any>;
    getHistory: () => Promise<any[]>;
  };
  shifts: {
    getCurrent: () => Promise<any | null>;
    getToday: () => Promise<any | null>;
    open: (data: any) => Promise<{ success: boolean; shiftId?: string; error?: string }>;
    close: (data: any) => Promise<{ success: boolean; expectedCash?: number; closingCash?: number; variance?: number; requiresReceiptAudit?: boolean; error?: string }>;
    getHistory: (limit?: number) => Promise<any[]>;
  };
  settings: {
    getAll: () => Promise<any[]>;
    update: (data: any) => Promise<any>;
  };
  sync: {
    getStatus: () => Promise<any>;
    syncNow: () => Promise<any>;
    getPendingCount: () => Promise<number>;
  };
  system: {
    backup: () => Promise<{ success: boolean; path?: string; backups?: any[]; error?: string }>;
    restore: () => Promise<{ success: boolean; restoredFrom?: string; safetyBackup?: string | null; message?: string; reason?: string; error?: string }>;
    listBackups: () => Promise<{ success: boolean; backupDir: string; dbPath: string; backups: any[] }>;
    openBackupFolder: () => Promise<{ success: boolean; backupDir: string }>;
    getPaths: () => Promise<any>;
    getBusinessDate: () => Promise<{ date: string; shopDayStartHour: number; ramadan24Hour: boolean }>;
  };
  printer: {
    getPrinters: () => Promise<{ success: boolean; printers: Array<{ name: string; displayName: string; description?: string; status?: number; isDefault?: boolean }>; error?: string }>;
    printReceipt: (data: any) => Promise<{ success: boolean; error?: string }>;
    printStatement: (data: any) => Promise<{ success: boolean; error?: string }>;
  };
  onNetworkChange: (callback: (status: 'online' | 'offline') => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
