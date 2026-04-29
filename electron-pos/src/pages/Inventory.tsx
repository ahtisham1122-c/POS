import { useState, useEffect, useMemo } from "react";
import { Package, Search, Plus, ArrowUpCircle, Edit2, Trash2, Filter, Download } from "lucide-react";
import { cn } from "../lib/utils";

type Product = {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  selling_price: number;
  cost_price: number;
  stock: number;
  low_stock_threshold?: number;
  tax_exempt?: number;
  emoji?: string;
};

function toMoney(value: number) {
  return `Rs. ${Number(value || 0).toLocaleString("en-PK", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default function Inventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"PRODUCTS" | "LOG">("PRODUCTS");
  const [categoryFilter, setCategoryFilter] = useState("ALL");
  const [statusFilter, setStatusFilter] = useState("ALL");

  const [isStockInModalOpen, setStockInModalOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [stockInQty, setStockInQty] = useState("");
  const [stockNotes, setStockNotes] = useState("");

  const [movements, setMovements] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [inventorySummary, setInventorySummary] = useState({ totalProducts: 0, totalValuation: 0, lowStockCount: 0 });

  // Add Product Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newProduct, setNewProduct] = useState({
    code: "",
    name: "",
    category: "",
    unit: "pcs",
    sellingPrice: "",
    costPrice: "",
    stock: "",
    lowStockThreshold: "5",
    taxExempt: true,
    emoji: "📦"
  });

  // Edit Product Modal State
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editProduct, setEditProduct] = useState({
    id: "",
    code: "",
    name: "",
    category: "",
    unit: "pcs",
    sellingPrice: "",
    costPrice: "",
    lowStockThreshold: "5",
    taxExempt: true,
    emoji: "📦"
  });

  // Delete Product State
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [productToDelete, setProductToDelete] = useState<Product | null>(null);


  const loadData = async () => {
    setIsLoading(true);
    try {
      const [prods, moves, summary] = await Promise.all([
        window.electronAPI?.products?.getAll(),
        window.electronAPI?.inventory?.getMovements(),
        window.electronAPI?.inventory?.getSummary()
      ]);
      setProducts(prods || []);
      setMovements(moves || []);
      if (summary) setInventorySummary(summary);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const categories = useMemo(() => ["ALL", ...new Set(products.map(p => p.category || "OTHER"))], [products]);

  const filteredProducts = useMemo(() => {
    return products.filter(p => {
      const stockStatus = p.stock <= 0 ? "OUT" : p.stock <= (p.low_stock_threshold || 5) ? "LOW" : "OK";
      const matchSearch = `${p.name} ${p.code}`.toLowerCase().includes(search.toLowerCase());
      const matchCat = categoryFilter === "ALL" || p.category === categoryFilter;
      const matchStatus = statusFilter === "ALL" || stockStatus === statusFilter;
      return matchSearch && matchCat && matchStatus;
    });
  }, [products, search, categoryFilter, statusFilter]);

  const stockValue = inventorySummary.totalValuation;
  const lowCount = inventorySummary.lowStockCount;
  const outCount = useMemo(() => products.filter(p => p.stock <= 0).length, [products]);

  const handleStockIn = async () => {
    if (!selectedProduct || !stockInQty) return;
    try {
      const res = await window.electronAPI?.inventory?.stockIn(selectedProduct.id, {
        quantity: Number(stockInQty),
        notes: stockNotes
      });
      if (res?.success) {
        setStockInModalOpen(false);
        setStockInQty("");
        setStockNotes("");
        setSelectedProduct(null);
        loadData();
      } else {
        alert(res?.error || "Failed to stock in");
      }
    } catch (err: any) {
      alert(err.message || "Failed to stock in");
    }
  };

  const handleAddProduct = async () => {
    try {
      const res = await window.electronAPI?.products?.create({
        ...newProduct,
        sellingPrice: Number(newProduct.sellingPrice),
        costPrice: Number(newProduct.costPrice || 0),
        stock: Number(newProduct.stock || 0),
        lowStockThreshold: Number(newProduct.lowStockThreshold || 5),
        taxExempt: newProduct.taxExempt
      });
      if (res?.success) {
        setIsAddModalOpen(false);
        setNewProduct({
          code: "",
          name: "",
          category: "",
          unit: "pcs",
          sellingPrice: "",
          costPrice: "",
          stock: "",
          lowStockThreshold: "5",
          taxExempt: true,
          emoji: "📦"
        });
        loadData();
      } else {
        alert(res?.error || "Failed to create product");
      }
    } catch (err: any) {
      alert(err.message || "Failed to create product");
    }
  };

  const handleEditProduct = async () => {
    try {
      const res = await window.electronAPI?.products?.update(editProduct.id, {
        name: editProduct.name,
        category: editProduct.category,
        unit: editProduct.unit,
        sellingPrice: Number(editProduct.sellingPrice),
        costPrice: Number(editProduct.costPrice || 0),
        lowStockThreshold: Number(editProduct.lowStockThreshold || 5),
        taxExempt: editProduct.taxExempt,
        emoji: editProduct.emoji
      });
      if (res?.success) {
        setIsEditModalOpen(false);
        loadData();
      } else {
        alert(res?.error || "Failed to update product");
      }
    } catch (err: any) {
      alert(err.message || "Failed to update product");
    }
  };

  const handleDeleteProduct = async () => {
    if (!productToDelete) return;
    try {
      const res = await window.electronAPI?.products?.remove(productToDelete.id);
      if (res?.success) {
        setIsDeleteModalOpen(false);
        setProductToDelete(null);
        loadData();
      } else {
        alert(res?.error || "Failed to delete product");
      }
    } catch (err: any) {
      alert(err.message || "Failed to delete product");
    }
  };

  const exportStock = async (format: "excel" | "pdf") => {
    const result = await window.electronAPI?.reports?.exportReport({ type: "stock-report", format });
    if (!result?.success && result?.reason !== "canceled") alert(result?.error || "Export failed");
  };


  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto animate-slide-up">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Inventory Management</h1>
          <p className="text-text-secondary mt-1">Track product levels, valuation, and refill status.</p>
        </div>
        <div className="flex flex-wrap gap-2 self-start sm:self-auto">
          <button onClick={() => exportStock("excel")} className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" /> Excel
          </button>
          <button onClick={() => exportStock("pdf")} className="btn-secondary flex items-center gap-2">
            <Download className="w-4 h-4" /> PDF
          </button>
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="btn-primary flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add Product
          </button>
        </div>

      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="card p-5">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Total Products</p>
          <p className="text-2xl font-bold text-text-primary">{products.length}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Stock Value</p>
          <p className="text-2xl font-bold text-text-primary font-mono">{toMoney(stockValue)}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Low Stock</p>
          <p className="text-2xl font-bold text-warning">{lowCount}</p>
        </div>
        <div className="card p-5">
          <p className="text-xs text-text-secondary font-medium uppercase tracking-wider mb-1">Out of Stock</p>
          <p className="text-2xl font-bold text-danger">{outCount}</p>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="flex border-b border-surface-4 bg-surface-2/50 overflow-x-auto">
          {["PRODUCTS", "LOG"].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as any)}
              className={cn(
                "px-6 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors",
                activeTab === tab ? "border-primary text-primary bg-primary/5" : "border-transparent text-text-secondary hover:text-text-primary hover:bg-surface-3"
              )}
            >
              {tab === "LOG" ? "Stock Movements" : "Products"}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="p-12 flex justify-center"><div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div></div>
        ) : activeTab === "PRODUCTS" ? (
          <div className="p-4">
            <div className="flex flex-col md:flex-row gap-3 mb-4">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary" />
                <input
                  type="text"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search by name or code..."
                  className="input pl-10"
                />
              </div>
              <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input md:w-48 appearance-none">
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input md:w-48 appearance-none">
                <option value="ALL">All Status</option>
                <option value="OK">In Stock</option>
                <option value="LOW">Low Stock</option>
                <option value="OUT">Out of Stock</option>
              </select>
            </div>

            <div className="overflow-x-auto border border-surface-4 rounded-lg">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-wider font-semibold border-b border-surface-4">
                  <tr>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Stock</th>
                    <th className="px-4 py-3">Sell Price</th>
                    <th className="px-4 py-3">Cost</th>
                    <th className="px-4 py-3">Tax</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-4">
                  {filteredProducts.map(p => {
                    const status = p.stock <= 0 ? "OUT" : p.stock <= (p.low_stock_threshold || 5) ? "LOW" : "OK";
                    const isLocked = p.code === 'MILK' || p.code === 'YOGT';
                    const isMilk = p.code === 'MILK';
                    const isYogurt = p.code === 'YOGT';
                    return (
                      <tr key={p.id} className="hover:bg-surface-3/50 transition-colors">
                        <td className="px-4 py-3 font-mono text-text-secondary">{p.code}</td>
                        <td className="px-4 py-3 font-medium flex items-center gap-2">
                          <span className="text-xl">{p.emoji || "📦"}</span>
                          {p.name}
                          {isMilk && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 font-semibold">SUPPLIER-FED</span>}
                          {isYogurt && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 font-semibold">FROM MILK</span>}
                        </td>
                        <td className="px-4 py-3">{p.category}</td>
                        <td className="px-4 py-3 font-mono font-medium">{p.stock.toFixed(2)} <span className="text-text-secondary text-xs">{p.unit}</span></td>
                        <td className="px-4 py-3 font-mono">{toMoney(p.selling_price)}</td>
                        <td className="px-4 py-3 font-mono text-text-secondary">{toMoney(p.cost_price)}</td>
                        <td className="px-4 py-3">
                          <span className={cn("badge", Number(p.tax_exempt || 0) === 1 ? "badge-success" : "bg-info/10 text-info")}>
                            {Number(p.tax_exempt || 0) === 1 ? "Exempt" : "Taxable"}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {status === "OK" && <span className="badge badge-success">● In Stock</span>}
                          {status === "LOW" && <span className="badge badge-warning animate-pulse">⚠ Low</span>}
                          {status === "OUT" && <span className="badge badge-danger">✕ Out</span>}
                        </td>
                        <td className="px-4 py-3 text-right space-x-2">
                          <button
                            onClick={() => { setSelectedProduct(p); setStockInModalOpen(true); }}
                            className={cn("p-1.5 rounded transition-colors", isYogurt ? "text-amber-400 hover:bg-amber-500/10" : "text-success hover:bg-success/10")}
                            title={isYogurt ? "Produce Yogurt (uses milk)" : isMilk ? "Stock In (use Suppliers page for collections)" : "Stock In"}
                          >
                            <ArrowUpCircle className="w-4 h-4" />
                          </button>
                          <button
                            disabled={isLocked}
                            onClick={() => {
                              if (isLocked) return;
                              setEditProduct({
                                id: p.id,
                                code: p.code,
                                name: p.name,
                                category: p.category,
                                unit: p.unit,
                                sellingPrice: String(p.selling_price),
                                costPrice: String(p.cost_price),
                                lowStockThreshold: String(p.low_stock_threshold || 5),
                                taxExempt: Number(p.tax_exempt || 0) === 1,
                                emoji: p.emoji || "📦"
                              });
                              setIsEditModalOpen(true);
                            }}
                            className={cn(
                              "p-1.5 rounded transition-colors",
                              isLocked
                                ? "text-text-secondary/40 cursor-not-allowed"
                                : "text-text-secondary hover:text-primary hover:bg-primary/10"
                            )}
                            title={isLocked ? "System product cannot be edited" : "Edit"}
                          >
                            <Edit2 className="w-4 h-4" />
                          </button>
                          {isLocked ? (
                            <span className="inline-flex p-1.5 text-text-secondary/40 cursor-not-allowed" title="System product — cannot be deleted">
                              🔒
                            </span>
                          ) : (
                            <button
                              onClick={() => { setProductToDelete(p); setIsDeleteModalOpen(true); }}
                              className="p-1.5 text-text-secondary hover:text-danger hover:bg-danger/10 rounded transition-colors" title="Delete"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredProducts.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-8 text-center text-text-secondary">
                        <Package className="w-12 h-12 mx-auto mb-2 opacity-50" />
                        <p>No products found</p>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        {!isLoading && activeTab === "LOG" && (
          <div className="p-4 animate-slide-in-right">
            <div className="overflow-x-auto border border-surface-4 rounded-lg">
              <table className="w-full text-left text-sm whitespace-nowrap">
                <thead className="bg-surface-3 text-text-secondary uppercase text-[10px] tracking-wider font-semibold border-b border-surface-4">
                  <tr>
                    <th className="px-4 py-3">Date</th>
                    <th className="px-4 py-3">Product</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3 text-right">Qty</th>
                    <th className="px-4 py-3 text-right">Balance</th>
                    <th className="px-4 py-3">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-4">
                  {movements.map((m: any) => (
                    <tr key={m.id} className="hover:bg-surface-3/50 transition-colors">
                      <td className="px-4 py-3 text-text-secondary">{new Date(m.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3 font-medium">[{m.product_code}] {m.product_name}</td>
                      <td className="px-4 py-3">
                        <span className={cn("px-2 py-1 rounded text-xs font-bold",
                          m.movement_type === "STOCK_IN" ? "bg-success/10 text-success" :
                          m.movement_type === "MILK_COLLECTION" ? "bg-blue-500/10 text-blue-400" :
                          m.movement_type === "YOGURT_PRODUCTION" ? "bg-amber-500/10 text-amber-400" :
                          m.movement_type === "STOCK_OUT" ? "bg-danger/10 text-danger" :
                          m.movement_type === "SALE" ? "bg-info/10 text-info" :
                          m.movement_type === "WASTAGE" ? "bg-orange-500/10 text-orange-400" :
                          "bg-surface-4 text-text-primary"
                        )}>
                          {m.movement_type.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className={cn("px-4 py-3 text-right font-mono font-bold", 
                        ["STOCK_IN", "ADJUSTMENT"].includes(m.movement_type) && m.stock_after >= m.stock_before ? "text-success" : "text-danger"
                      )}>
                        {m.stock_after > m.stock_before ? "+" : "-"}{m.quantity}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-text-secondary">{m.stock_after}</td>
                      <td className="px-4 py-3 text-text-secondary text-xs truncate max-w-[200px]" title={m.notes}>{m.notes || "-"}</td>
                    </tr>
                  ))}
                  {movements.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-4 py-8 text-center text-text-secondary">No stock movements found.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {isStockInModalOpen && selectedProduct && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-md overflow-hidden flex flex-col border border-surface-4">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center">
              <h3 className="font-semibold text-lg">
                {selectedProduct.code === 'YOGT' ? '🫙 Produce Yogurt' : `Stock In: ${selectedProduct.name}`}
              </h3>
              <button onClick={() => setStockInModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4">
              {selectedProduct.code === 'YOGT' && (
                <div className="bg-amber-500/10 border border-amber-500/30 rounded-lg p-3 text-sm text-amber-400">
                  ⚠ Yogurt is made from milk. Adding yogurt stock will automatically deduct the same quantity from Milk inventory.
                  {stockInQty && Number(stockInQty) > 0 && (
                    <div className="mt-1 font-semibold">
                      This will use {Number(stockInQty).toFixed(2)} kg of Milk.
                    </div>
                  )}
                </div>
              )}
              {selectedProduct.code === 'MILK' && (
                <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 text-sm text-blue-400">
                  💡 Milk stock normally comes from supplier entries (Suppliers page). Use this only for manual corrections.
                </div>
              )}
              <div className="bg-surface-3 rounded-lg p-4 flex justify-between items-center">
                <span className="text-text-secondary text-sm">Current Stock</span>
                <span className="font-mono font-bold text-lg">{selectedProduct.stock.toFixed(2)} {selectedProduct.unit}</span>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">
                  {selectedProduct.code === 'YOGT' ? 'Yogurt Quantity to Produce' : 'Quantity to Add'}
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={stockInQty}
                    onChange={(e) => setStockInQty(e.target.value)}
                    className="input font-mono text-lg py-3"
                    placeholder="0.00"
                    autoFocus
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-text-secondary font-mono">{selectedProduct.unit}</span>
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Notes (Optional)</label>
                <input
                  type="text"
                  value={stockNotes}
                  onChange={(e) => setStockNotes(e.target.value)}
                  className="input py-2"
                  placeholder={selectedProduct.code === 'YOGT' ? "e.g. Morning batch" : "e.g. Supplier name or reason"}
                />
              </div>
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setStockInModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              <button
                onClick={handleStockIn}
                className={cn("flex-1", selectedProduct.code === 'YOGT' ? "bg-amber-500 hover:bg-amber-600 text-white font-semibold py-2 px-4 rounded-lg transition-colors" : "btn-primary")}
                disabled={!stockInQty || Number(stockInQty) <= 0}
              >
                {selectedProduct.code === 'YOGT' ? 'Confirm Production' : 'Confirm Stock In'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-lg overflow-hidden flex flex-col border border-surface-4">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center">
              <h3 className="font-semibold text-lg">Add New Product</h3>
              <button onClick={() => setIsAddModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Product Name *</label>
                  <input
                    type="text"
                    value={newProduct.name}
                    onChange={(e) => setNewProduct({ ...newProduct, name: e.target.value })}
                    className="input"
                    placeholder="e.g. Fresh Milk"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Product Code</label>
                  <input
                    type="text"
                    value={newProduct.code}
                    onChange={(e) => setNewProduct({ ...newProduct, code: e.target.value })}
                    className="input font-mono"
                    placeholder="Auto-generated if empty"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Category *</label>
                  <input
                    type="text"
                    value={newProduct.category}
                    onChange={(e) => setNewProduct({ ...newProduct, category: e.target.value })}
                    className="input"
                    placeholder="e.g. DAIRY"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Unit *</label>
                  <select
                    value={newProduct.unit}
                    onChange={(e) => setNewProduct({ ...newProduct, unit: e.target.value })}
                    className="input appearance-none"
                  >
                    <option value="pcs">Pieces (pcs)</option>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="ltr">Liters (ltr)</option>
                    <option value="gm">Grams (gm)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Selling Price *</label>
                  <input
                    type="number"
                    value={newProduct.sellingPrice}
                    onChange={(e) => setNewProduct({ ...newProduct, sellingPrice: e.target.value })}
                    className="input font-mono"
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Cost Price</label>
                  <input
                    type="number"
                    value={newProduct.costPrice}
                    onChange={(e) => setNewProduct({ ...newProduct, costPrice: e.target.value })}
                    className="input font-mono"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Opening Stock</label>
                  <input
                    type="number"
                    value={newProduct.stock}
                    onChange={(e) => setNewProduct({ ...newProduct, stock: e.target.value })}
                    className="input font-mono"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Low Stock Alert</label>
                  <input
                    type="number"
                    value={newProduct.lowStockThreshold}
                    onChange={(e) => setNewProduct({ ...newProduct, lowStockThreshold: e.target.value })}
                    className="input font-mono"
                    placeholder="5"
                  />
                </div>
              </div>

              <label className="flex items-center justify-between rounded-lg border border-surface-4 bg-surface-3 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">Tax Exempt Product</div>
                  <div className="text-xs text-text-secondary">Turn this on if this item should not receive tax during checkout.</div>
                </div>
                <input
                  type="checkbox"
                  checked={newProduct.taxExempt}
                  onChange={(e) => setNewProduct({ ...newProduct, taxExempt: e.target.checked })}
                  className="h-5 w-5 accent-primary"
                />
              </label>

              <div>
                <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Emoji / Icon</label>
                <input
                  type="text"
                  value={newProduct.emoji}
                  onChange={(e) => setNewProduct({ ...newProduct, emoji: e.target.value })}
                  className="input text-center text-2xl w-20"
                  placeholder="📦"
                />
              </div>
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setIsAddModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleAddProduct} className="btn-primary flex-1" disabled={!newProduct.name || !newProduct.sellingPrice}>Save Product</button>
            </div>
          </div>
        </div>
      )}

      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-lg overflow-hidden flex flex-col border border-surface-4">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center">
              <h3 className="font-semibold text-lg">Edit Product: {editProduct.name}</h3>
              <button onClick={() => setIsEditModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Product Name *</label>
                  <input
                    type="text"
                    value={editProduct.name}
                    onChange={(e) => setEditProduct({ ...editProduct, name: e.target.value })}
                    className="input"
                    placeholder="e.g. Fresh Milk"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Product Code</label>
                  <input
                    type="text"
                    value={editProduct.code}
                    className="input font-mono bg-surface-3 cursor-not-allowed"
                    disabled
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Category *</label>
                  <input
                    type="text"
                    value={editProduct.category}
                    onChange={(e) => setEditProduct({ ...editProduct, category: e.target.value })}
                    className="input"
                    placeholder="e.g. DAIRY"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Unit *</label>
                  <select
                    value={editProduct.unit}
                    onChange={(e) => setEditProduct({ ...editProduct, unit: e.target.value })}
                    className="input appearance-none"
                  >
                    <option value="pcs">Pieces (pcs)</option>
                    <option value="kg">Kilograms (kg)</option>
                    <option value="ltr">Liters (ltr)</option>
                    <option value="gm">Grams (gm)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Selling Price *</label>
                  <input
                    type="number"
                    value={editProduct.sellingPrice}
                    onChange={(e) => setEditProduct({ ...editProduct, sellingPrice: e.target.value })}
                    className="input font-mono"
                    placeholder="0.00"
                    required
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Cost Price</label>
                  <input
                    type="number"
                    value={editProduct.costPrice}
                    onChange={(e) => setEditProduct({ ...editProduct, costPrice: e.target.value })}
                    className="input font-mono"
                    placeholder="0.00"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Low Stock Alert</label>
                  <input
                    type="number"
                    value={editProduct.lowStockThreshold}
                    onChange={(e) => setEditProduct({ ...editProduct, lowStockThreshold: e.target.value })}
                    className="input font-mono"
                    placeholder="5"
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-text-secondary uppercase mb-1 block">Emoji / Icon</label>
                  <input
                    type="text"
                    value={editProduct.emoji}
                    onChange={(e) => setEditProduct({ ...editProduct, emoji: e.target.value })}
                    className="input text-center text-2xl w-20"
                    placeholder="📦"
                  />
                </div>
              </div>
              <label className="flex items-center justify-between rounded-lg border border-surface-4 bg-surface-3 px-4 py-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">Tax Exempt Product</div>
                  <div className="text-xs text-text-secondary">Turn this on if this item should be excluded from tax.</div>
                </div>
                <input
                  type="checkbox"
                  checked={editProduct.taxExempt}
                  onChange={(e) => setEditProduct({ ...editProduct, taxExempt: e.target.checked })}
                  className="h-5 w-5 accent-primary"
                />
              </label>
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setIsEditModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleEditProduct} className="btn-primary flex-1" disabled={!editProduct.name || !editProduct.sellingPrice}>Save Changes</button>
            </div>
          </div>
        </div>
      )}

      {isDeleteModalOpen && productToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-slide-up">
          <div className="bg-surface-2 rounded-xl shadow-float w-full max-w-md overflow-hidden flex flex-col border border-surface-4">
            <div className="p-4 border-b border-surface-4 flex justify-between items-center">
              <h3 className="font-semibold text-lg text-danger">Delete Product</h3>
              <button onClick={() => setIsDeleteModalOpen(false)} className="text-text-secondary hover:text-text-primary">✕</button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-text-primary">
                Are you sure you want to delete <span className="font-semibold">{productToDelete.name}</span>?
              </p>
              <p className="text-xs text-text-secondary">
                This will mark the product as inactive. It will not be available for new sales, but past records will remain intact.
              </p>
            </div>
            <div className="p-4 bg-surface-3 border-t border-surface-4 flex gap-3">
              <button onClick={() => setIsDeleteModalOpen(false)} className="btn-secondary flex-1">Cancel</button>
              <button onClick={handleDeleteProduct} className="btn-danger flex-1">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>

  );
}
