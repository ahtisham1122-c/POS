export interface ElectronAPI {
  auth: {
    login: (credentials: { username: string; password: string }) => Promise<any>;
    getMe: () => Promise<any>;
    getUsers: () => Promise<any[]>;
    createUser: (data: { name: string; username: string; pin: string; role: 'ADMIN' | 'MANAGER' | 'CASHIER' }) => Promise<{ success: boolean; user?: any; error?: string }>;
    logout: () => Promise<{ success: boolean }>;
    verifyManagerPin: (data: { pin: string; action?: string }) => Promise<{ success: boolean; approver?: any; error?: string }>;
    setManagerPin: (data: { userId?: string; currentPassword: string; newPin: string }) => Promise<{ success: boolean; error?: string }>;
    resetUserPassword: (data: { userId: string; currentPassword: string; newPin: string }) => Promise<{ success: boolean; error?: string }>;
    updateUserRole: (data: { userId: string; newRole: 'ADMIN' | 'MANAGER' | 'CASHIER'; currentPassword: string }) => Promise<{ success: boolean; error?: string }>;
    deleteUser: (data: { userId: string; currentPassword: string }) => Promise<{ success: boolean; error?: string }>;
    completeInitialSetup: (data: { currentPassword: string; newPin: string }) => Promise<{ success: boolean; error?: string }>;
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
    getAll: (showInactive?: boolean) => Promise<any[]>;
    create: (data: any) => Promise<{ success: boolean; id?: string; error?: string }>;
    update: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
    deactivate: (id: string, options?: { reason?: string }) => Promise<{ success: boolean; error?: string }>;
    collectMilk: (data: any) => Promise<{ success: boolean; collectionId?: string; totalAmount?: number; supplierBalance?: number; error?: string }>;
    updateCollection: (id: string, data: any) => Promise<{ success: boolean; collectionId?: string; totalAmount?: number; supplierBalance?: number; error?: string }>;
    collectPayment: (id: string, data: any) => Promise<{ success: boolean; paymentId?: string; balanceAfter?: number; error?: string }>;
    updatePayment: (paymentId: string, data: { amount: number; notes?: string }) => Promise<{ success: boolean; balanceAfter?: number; error?: string }>;
    deletePayment: (paymentId: string, data?: { reason?: string }) => Promise<{ success: boolean; balanceAfter?: number; error?: string }>;
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
    remove: (id: string, options?: { managerPin?: string }) => Promise<any>;
    getLedger: (id: string) => Promise<any[]>;
    collectPayment: (id: string, data: any) => Promise<{ success: boolean; error?: string }>;
    search: (query: string) => Promise<any[]>;
    getStatement: (id: string, startDate?: string, endDate?: string) => Promise<{ customer: any; ledger: any[] } | null>;
  };
  sales: {
    getAll: (filters?: any) => Promise<any[]>;
    getOne: (id: string) => Promise<any>;
    getReceipt: (id: string) => Promise<any>;
    create: (data: any) => Promise<{ success: boolean; duplicate?: boolean; saleId?: string; transactionId?: string; billNumber?: string; tokenNumber?: number | null; subtotal?: number; discountAmount?: number; taxAmount?: number; taxRate?: number; taxLabel?: string; grandTotal?: number; amountPaid?: number; balanceDue?: number; cashPaid?: number; onlinePaid?: number; cashTendered?: number; changeReturned?: number; lateSaleNote?: string | null; error?: string }>;
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
    remove: (id: string, options?: { managerPin?: string; reason?: string }) => Promise<any>;
    getSummary: () => Promise<any>;
    getWastageDefaults: () => Promise<any[]>;
    addWastage: (data: any) => Promise<any>;
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
    getAnalytics: (filters?: { date?: string; daysBack?: number }) => Promise<any>;
    exportReport: (data: { type: string; format: 'excel' | 'pdf'; params?: any }) => Promise<{ success: boolean; path?: string; reason?: string; error?: string }>;
  };
  dailyRates: {
    getToday: () => Promise<any>;
    getLatest: () => Promise<any>;
    getByDate: (date: string) => Promise<any>;
    update: (data: any) => Promise<any>;
    getHistory: () => Promise<any[]>;
    getRateChangeHistory: (limit?: number) => Promise<any[]>;
  };
  cashRegister: {
    getToday: () => Promise<any>;
    open: (data: any) => Promise<any>;
    close: (data?: any) => Promise<any>;
    reopen: (data?: { managerPin?: string }) => Promise<{ success: boolean; error?: string }>;
    getHistory: () => Promise<any[]>;
  };
  shifts: {
    getCurrent: () => Promise<any | null>;
    getToday: () => Promise<any | null>;
    open: (data: any) => Promise<{ success: boolean; shiftId?: string; requiresPreviousShiftConfirmation?: boolean; error?: string }>;
    close: (data: any) => Promise<{ success: boolean; expectedCash?: number; closingCash?: number; variance?: number; error?: string }>;
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
    getFailedRows: () => Promise<Array<{ id: string; table_name: string; record_id: string; operation: string; error_message: string; attempt_count: number; last_attempted_at: string | null; created_at: string }>>;
    dismissRow: (id: string) => Promise<{ success: boolean }>;
  };
  cfd: {
    getStatus: () => Promise<{ enabled: boolean; connected: boolean; path: string; baudRate: number; welcomeLine1: string; welcomeLine2: string; lastWriteAt: number | null; nativeAvailable: boolean }>;
    listPorts: () => Promise<Array<{ path: string; manufacturer?: string; productId?: string; vendorId?: string; serialNumber?: string }>>;
    test: (data: { path: string; baudRate?: number; line1?: string; line2?: string }) => Promise<{ success: boolean; error?: string }>;
    saveConfig: (data: { enabled?: boolean; path?: string; baudRate?: number; welcomeLine1?: string; welcomeLine2?: string }) => Promise<{ success: boolean; error?: string }>;
    reconnect: () => Promise<{ success: boolean; error?: string }>;
    showItem: (data: { name: string; price: number; quantity?: number }) => Promise<{ success: boolean; skipped?: boolean }>;
    showCartTotal: (data: { itemCount: number; total: number }) => Promise<{ success: boolean; skipped?: boolean }>;
    showThankYou: (data: { grandTotal: number; change?: number }) => Promise<{ success: boolean; skipped?: boolean }>;
    showWelcome: () => Promise<{ success: boolean; skipped?: boolean }>;
    showLines: (data: { line1: string; line2: string }) => Promise<{ success: boolean; skipped?: boolean }>;
  };
  system: {
    backup: () => Promise<{ success: boolean; path?: string; backups?: any[]; error?: string }>;
    restore: () => Promise<{ success: boolean; restoredFrom?: string; safetyBackup?: string | null; message?: string; reason?: string; error?: string }>;
    listBackups: () => Promise<{ success: boolean; backupDir: string; dbPath: string; backups: any[] }>;
    openBackupFolder: () => Promise<{ success: boolean; backupDir: string }>;
    getBackupDirInfo: () => Promise<{ success: boolean; backupDir: string; defaultDir: string; isCustom: boolean }>;
    chooseBackupFolder: (options?: { migrateExisting?: boolean }) => Promise<{ success: boolean; backupDir?: string; migrated?: number; reason?: string; error?: string }>;
    setBackupFolder: (data: { path: string; migrateExisting?: boolean }) => Promise<{ success: boolean; backupDir?: string; migrated?: number; error?: string }>;
    resetBackupFolder: () => Promise<{ success: boolean; backupDir?: string; error?: string }>;
    getPaths: () => Promise<any>;
    getBusinessDate: () => Promise<{ date: string; openShiftId?: string | null; openShiftOpenedAt?: string | null; shopDayStartHour: number; ramadan24Hour: boolean; is24HourMode?: boolean }>;
    getHealth: () => Promise<any>;
  };
  printer: {
    getPrinters: () => Promise<{ success: boolean; printers: Array<{ name: string; displayName: string; description?: string; status?: number; isDefault?: boolean }>; error?: string }>;
    printReceipt: (data: any) => Promise<{ success: boolean; error?: string }>;
    printStatement: (data: any) => Promise<{ success: boolean; error?: string }>;
  };
  employees: {
    getAll: (showInactive?: boolean) => Promise<any[]>;
    getOne: (id: string) => Promise<any>;
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
    updateSalary: (id: string, salary: number, effectiveDate: string, notes?: string) => Promise<any>;
    markLeft: (id: string, leftDate: string) => Promise<any>;
    addAdvance: (data: any) => Promise<any>;
    issueMilk: (data: any) => Promise<any>;
    addLeave: (data: any) => Promise<any>;
    calculateSalary: (employeeId: string, periodStart: string, periodEnd: string) => Promise<any>;
    paySalary: (data: any) => Promise<any>;
    getDefaultPeriod: (startDate: string, targetMonth?: string) => Promise<{ start: string; end: string; periodStart: string; periodEnd: string }>;
    getPayrollSummary: (month?: string) => Promise<any>;
    calculateLeavingPay: (employeeId: string) => Promise<any>;
  };
  riders: {
    getAll: (showInactive?: boolean) => Promise<any[]>;
    create: (data: any) => Promise<any>;
    update: (id: string, data: any) => Promise<any>;
    deactivate: (id: string) => Promise<any>;
  };
  deliveries: {
    getTodayOverview: () => Promise<any>;
    getOrCreateSession: (riderId: string) => Promise<any>;
    addPickup: (data: any) => Promise<any>;
    addReturn: (data: any) => Promise<any>;
    updateEntry: (entryId: string, data: any) => Promise<any>;
    completeSession: (sessionId: string, notes?: string) => Promise<any>;
    getSession: (sessionId: string) => Promise<any>;
    getPickupSlip: (entryId: string) => Promise<any>;
    getMonthlyStatement: (riderId: string, month?: string) => Promise<any>;
    getRiderHistory: (riderId: string, limit?: number) => Promise<any[]>;
    getAllHistory: (limit?: number) => Promise<any[]>;
    getMilkStock: () => Promise<any>;
  };
  onNetworkChange: (callback: (status: 'online' | 'offline') => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
