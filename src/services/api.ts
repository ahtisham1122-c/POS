import apiClient from "@/lib/axios";

export const authService = {
  login: (data: any) => apiClient.post("/auth/login", data),
  logout: () => apiClient.post("/auth/logout"),
  getMe: () => apiClient.get("/auth/me"),
};

export const productService = {
  getAll: (params?: any) => apiClient.get("/products", { params }),
  getOne: (id: string) => apiClient.get(`/products/${id}`),
  create: (data: any) => apiClient.post("/products", data),
  update: (id: string, data: any) => apiClient.patch(`/products/${id}`, data),
  updatePrice: (id: string, data: any) => apiClient.patch(`/products/${id}/price`, data),
  remove: (id: string) => apiClient.delete(`/products/${id}`),
  stockIn: (id: string, data: any) => apiClient.post(`/products/${id}/stock-in`, data),
};

export const customerService = {
  getAll: (params?: any) => apiClient.get("/customers", { params }),
  getOne: (id: string) => apiClient.get(`/customers/${id}`),
  create: (data: any) => apiClient.post("/customers", data),
  update: (id: string, data: any) => apiClient.patch(`/customers/${id}`, data),
  remove: (id: string) => apiClient.delete(`/customers/${id}`),
  getLedger: (id: string, params?: any) => apiClient.get(`/customers/${id}/ledger`, { params }),
  collectPayment: (id: string, data: any) => apiClient.post(`/customers/${id}/collect-payment`, data),
};

export const saleService = {
  create: (data: any) => apiClient.post("/sales", data),
  getAll: (params?: any) => apiClient.get("/sales", { params }),
  getOne: (id: string) => apiClient.get(`/sales/${id}`),
};

export const reportService = {
  getDailySummary: (date?: string) => apiClient.get("/reports/daily-summary", { params: { date } }),
  getSalesChart: (days = 7) => apiClient.get("/reports/sales-chart", { params: { days } }),
  getProductPerformance: (params?: any) => apiClient.get("/reports/product-performance", { params }),
};

export const dailyRateService = {
  getToday: () => apiClient.get("/daily-rates/today"),
  update: (data: any) => apiClient.post("/daily-rates", data),
};

export const expenseService = {
  getAll: (params?: any) => apiClient.get("/expenses", { params }),
  create: (data: any) => apiClient.post("/expenses", data),
};

export const inventoryService = {
  getSummary: () => apiClient.get("/inventory/summary"),
};

export const cashRegisterService = {
  getToday: () => apiClient.get("/cash-register/today"),
  open: (data: any) => apiClient.post("/cash-register/open", data),
  close: () => apiClient.patch("/cash-register/close"),
};

export const settingsService = {
  getAll: () => apiClient.get("/settings"),
  update: (data: any) => apiClient.patch("/settings", data),
};
