"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ArrowUpCircle,
  Boxes,
  CircleAlert,
  CircleCheckBig,
  FileDown,
  PackageOpen,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { dailyRateService, inventoryService, productService } from "@/services/api";
import { cn, formatCurrency } from "@/lib/utils";
import { PageHeader } from "@/components/shared/PageHeader";
import { StatCard } from "@/components/shared/StatCard";
import { DataTable, type DataTableColumn } from "@/components/shared/DataTable";
import { AppModal } from "@/components/shared/AppModal";
import { ConfirmationDialog } from "@/components/shared/ConfirmationDialog";
import { EmptyState } from "@/components/shared/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Product = {
  id: string;
  code: string;
  name: string;
  category: string;
  unit: string;
  sellingPrice: number;
  costPrice: number;
  stock: number;
  lowStockThreshold: number;
  emoji?: string;
  isActive: boolean;
};

type StockMovement = {
  id: string;
  createdAt: string;
  movementType: "OPENING" | "STOCK_IN" | "ADJUSTMENT" | "SALE";
  quantity: number;
  stockBefore: number;
  stockAfter: number;
  supplier?: string | null;
  notes?: string | null;
  createdById?: string | null;
  productId: string;
};

type ProductDetail = Product & {
  stockMovements?: StockMovement[];
};

type InventorySummary = {
  productsCount: number;
  stockValue: number;
  lowStockCount: number;
  outOfStockCount: number;
};

type ProductFormState = {
  name: string;
  category: string;
  unit: string;
  sellingPrice: string;
  costPrice: string;
  stock: string;
  lowStockThreshold: string;
  emoji: string;
};

const CATEGORIES = [
  "ALL",
  "MILK",
  "YOGURT",
  "GHEE",
  "DRINKS",
  "CHEESE",
  "SWEETS",
  "BUTTER_CREAM",
  "OTHER",
] as const;

const STATUS_FILTERS = ["ALL", "IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK"] as const;

const EMOJI_OPTIONS = ["🥛", "🫙", "🧈", "🧀", "🥤", "🍬", "📦", "🐄", "🥣", "🍶", "🛒", "🏷️"];

function getProductStatus(product: Product) {
  const stock = Number(product.stock || 0);
  const threshold = Number(product.lowStockThreshold || 0);
  if (stock <= 0) return "OUT_OF_STOCK";
  if (stock <= threshold) return "LOW_STOCK";
  return "IN_STOCK";
}

function buildCsv(rows: Product[]) {
  const header = ["Code", "Name", "Category", "Unit", "Stock", "Cost Price", "Stock Value"];
  const body = rows.map((product) => {
    const stock = Number(product.stock || 0);
    const cost = Number(product.costPrice || 0);
    const value = stock * cost;
    return [
      product.code || "-",
      product.name,
      product.category,
      product.unit,
      stock.toString(),
      cost.toFixed(2),
      value.toFixed(2),
    ];
  });
  return [header, ...body]
    .map((cells) => cells.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","))
    .join("\n");
}

export default function InventoryPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState("products");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("ALL");
  const [status, setStatus] = useState<(typeof STATUS_FILTERS)[number]>("ALL");
  const [milkRate, setMilkRate] = useState("");
  const [yogurtRate, setYogurtRate] = useState("");
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isStockInOpen, setIsStockInOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);

  const { data: products = [], isLoading: productsLoading } = useQuery<Product[]>({
    queryKey: ["products", "inventory", category, search],
    queryFn: async () =>
      (await productService.getAll({
        category: category === "ALL" ? undefined : category,
        search: search.trim() || undefined,
      })) as unknown as Product[],
  });

  const { data: summary, isLoading: summaryLoading } = useQuery<InventorySummary>({
    queryKey: ["inventory", "summary"],
    queryFn: async () => (await inventoryService.getSummary()) as unknown as InventorySummary,
  });

  const { data: todayRates, isLoading: ratesLoading } = useQuery<{ milkRate: number; yogurtRate: number }>({
    queryKey: ["daily-rates", "today"],
    queryFn: async () =>
      (await dailyRateService.getToday()) as unknown as { milkRate: number; yogurtRate: number },
  });

  const { data: stockLogs = [], isLoading: stockLogLoading } = useQuery<
    Array<StockMovement & { productName: string; productUnit: string; productEmoji: string }>
  >({
    queryKey: ["inventory", "stock-log", products.map((item) => item.id).join("|")],
    enabled: activeTab === "stock-log" && products.length > 0,
    queryFn: async () => {
      const details = (await Promise.all(
        products.map(async (product) => (await productService.getOne(product.id)) as unknown as ProductDetail)
      )) as ProductDetail[];
      return details
        .flatMap((detail) =>
          (detail.stockMovements ?? [])
            .filter((movement) => movement.movementType === "STOCK_IN" || movement.movementType === "OPENING")
            .map((movement) => ({
              ...movement,
              productName: detail.name,
              productUnit: detail.unit,
              productEmoji: detail.emoji || "📦",
            }))
        )
        .sort((a, b) => Number(new Date(b.createdAt)) - Number(new Date(a.createdAt)));
    },
  });

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const productStatus = getProductStatus(product);
      if (status === "ALL") return true;
      return productStatus === status;
    });
  }, [products, status]);

  const valuationRows = useMemo(() => {
    return filteredProducts
      .map((product) => {
        const stock = Number(product.stock || 0);
        const cost = Number(product.costPrice || 0);
        return {
          ...product,
          totalValue: stock * cost,
        };
      })
      .sort((a, b) => b.totalValue - a.totalValue);
  }, [filteredProducts]);

  const totalStockValue = useMemo(
    () => valuationRows.reduce((sum, item) => sum + Number(item.totalValue || 0), 0),
    [valuationRows]
  );

  const productMutation = useMutation({
    mutationFn: (payload: { id?: string; data: ProductFormState }) => {
      const parsed = {
        name: payload.data.name.trim(),
        category: payload.data.category as Product["category"],
        unit: payload.data.unit.trim(),
        sellingPrice: Number(payload.data.sellingPrice),
        costPrice: Number(payload.data.costPrice),
        stock: Number(payload.data.stock || 0),
        lowStockThreshold: Number(payload.data.lowStockThreshold || 0),
        emoji: payload.data.emoji.trim() || "📦",
      };

      if (payload.id) {
        return productService.update(payload.id, {
          name: parsed.name,
          category: parsed.category,
          unit: parsed.unit,
        });
      }

      return productService.create(parsed);
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast.success(variables.id ? "Product updated successfully" : "Product added successfully");
      setIsProductModalOpen(false);
      setSelectedProduct(null);
    },
    onError: (error: Error) => toast.error(error.message || "Could not save product"),
  });

  const stockInMutation = useMutation({
    mutationFn: (payload: { id: string; quantity: number; supplier?: string; notes?: string }) =>
      productService.stockIn(payload.id, {
        quantity: payload.quantity,
        supplier: payload.supplier,
        notes: payload.notes,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Stock added successfully");
      setIsStockInOpen(false);
      setSelectedProduct(null);
    },
    onError: (error: Error) => toast.error(error.message || "Failed to add stock"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => productService.remove(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["products"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      toast.success("Product moved to inactive list");
      setIsDeleteOpen(false);
      setSelectedProduct(null);
    },
    onError: (error: Error) => toast.error(error.message || "Delete failed"),
  });

  const ratesMutation = useMutation({
    mutationFn: (payload: { milkRate: number; yogurtRate: number }) => dailyRateService.update(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["daily-rates"] });
      toast.success("Daily rates updated");
      setMilkRate("");
      setYogurtRate("");
    },
    onError: (error: Error) => toast.error(error.message || "Could not update daily rates"),
  });

  const handleUpdateRates = () => {
    const nextMilk = Number(milkRate || todayRates?.milkRate || 0);
    const nextYogurt = Number(yogurtRate || todayRates?.yogurtRate || 0);
    if (nextMilk <= 0 || nextYogurt <= 0) {
      toast.error("Milk and yogurt rates must be greater than zero");
      return;
    }
    ratesMutation.mutate({ milkRate: nextMilk, yogurtRate: nextYogurt });
  };

  const exportValuation = () => {
    const csv = buildCsv(valuationRows);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `inventory-valuation-${format(new Date(), "yyyy-MM-dd")}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success("Valuation CSV exported");
  };

  const productColumns: DataTableColumn<Product>[] = [
    {
      id: "index",
      header: "#",
      className: "w-12 text-text-secondary",
      cell: (_, index) => index + 1,
    },
    {
      id: "emoji",
      header: "Emoji",
      className: "w-16 text-lg",
      cell: (row) => row.emoji || "📦",
    },
    {
      id: "code",
      header: "Code",
      sortable: true,
      accessor: (row) => row.code,
      className: "mono text-xs",
      cell: (row) => row.code || "-",
    },
    {
      id: "name",
      header: "Name",
      sortable: true,
      accessor: (row) => row.name,
      className: "font-medium",
      cell: (row) => row.name,
    },
    {
      id: "category",
      header: "Category",
      sortable: true,
      accessor: (row) => row.category,
      cell: (row) => (
        <Badge variant="outline" className="border-border bg-surface-2 text-text-secondary">
          {row.category}
        </Badge>
      ),
    },
    {
      id: "unit",
      header: "Unit",
      cell: (row) => row.unit,
    },
    {
      id: "sellingPrice",
      header: "Sell Price",
      sortable: true,
      accessor: (row) => Number(row.sellingPrice || 0),
      className: "mono text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="block text-right">{formatCurrency(row.sellingPrice || 0)}</span>,
    },
    {
      id: "costPrice",
      header: "Cost",
      sortable: true,
      accessor: (row) => Number(row.costPrice || 0),
      className: "mono text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="block text-right">{formatCurrency(row.costPrice || 0)}</span>,
    },
    {
      id: "stock",
      header: "Stock",
      sortable: true,
      accessor: (row) => Number(row.stock || 0),
      className: "mono text-right",
      headerClassName: "text-right",
      cell: (row) => (
        <span
          className={cn(
            "block text-right",
            getProductStatus(row) === "OUT_OF_STOCK" && "text-danger",
            getProductStatus(row) === "LOW_STOCK" && "text-warning"
          )}
        >
          {Number(row.stock || 0)} {row.unit}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (row) => getProductStatus(row),
      cell: (row) => {
        const statusValue = getProductStatus(row);
        return (
          <Badge
            className={cn(
              "border text-[11px] font-semibold",
              statusValue === "IN_STOCK" && "border-success/50 bg-success/15 text-success",
              statusValue === "LOW_STOCK" && "border-warning/50 bg-warning/15 text-warning",
              statusValue === "OUT_OF_STOCK" && "border-danger/50 bg-danger/15 text-danger"
            )}
          >
            {statusValue === "IN_STOCK" ? "In Stock" : statusValue === "LOW_STOCK" ? "Low Stock" : "Out of Stock"}
          </Badge>
        );
      },
    },
    {
      id: "actions",
      header: "Actions",
      headerClassName: "text-right",
      className: "text-right",
      cell: (row) => (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Stock In"
            onClick={() => {
              setSelectedProduct(row);
              setIsStockInOpen(true);
            }}
          >
            <ArrowUpCircle className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Edit Product"
            onClick={() => {
              setSelectedProduct(row);
              setIsProductModalOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            title="Delete Product"
            className="border-danger/40 text-danger hover:bg-danger/15 hover:text-danger"
            onClick={() => {
              setSelectedProduct(row);
              setIsDeleteOpen(true);
            }}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ),
    },
  ];

  const stockLogColumns: DataTableColumn<StockMovement & { productName: string; productUnit: string; productEmoji: string }>[] =
    [
      {
        id: "createdAt",
        header: "Date",
        sortable: true,
        accessor: (row) => Number(new Date(row.createdAt)),
        cell: (row) => (
          <div>
            <p className="text-sm text-text">{format(new Date(row.createdAt), "dd MMM yyyy")}</p>
            <p className="text-xs text-text-secondary">{format(new Date(row.createdAt), "hh:mm a")}</p>
          </div>
        ),
      },
      {
        id: "product",
        header: "Product",
        sortable: true,
        accessor: (row) => row.productName,
        cell: (row) => (
          <div className="flex items-center gap-2">
            <span className="text-base">{row.productEmoji}</span>
            <span className="font-medium text-text">{row.productName}</span>
          </div>
        ),
      },
      {
        id: "movementType",
        header: "Type",
        sortable: true,
        accessor: (row) => row.movementType,
        cell: (row) => (
          <Badge className={row.movementType === "OPENING" ? "bg-info/15 text-info" : "bg-success/15 text-success"}>
            {row.movementType === "OPENING" ? "Opening" : "Stock In"}
          </Badge>
        ),
      },
      {
        id: "quantity",
        header: "Quantity",
        sortable: true,
        accessor: (row) => Number(row.quantity || 0),
        className: "mono",
        cell: (row) => `+${Number(row.quantity || 0).toFixed(2)} ${row.productUnit}`,
      },
      {
        id: "supplier",
        header: "Supplier",
        sortable: true,
        accessor: (row) => row.supplier || "",
        cell: (row) => row.supplier || "-",
      },
      {
        id: "by",
        header: "By",
        sortable: true,
        accessor: (row) => row.createdById || "",
        cell: (row) => row.createdById || "system",
      },
      {
        id: "notes",
        header: "Notes",
        cell: (row) => row.notes || "-",
      },
    ];

  const valuationColumns: DataTableColumn<(Product & { totalValue: number })>[] = [
    {
      id: "product",
      header: "Product",
      sortable: true,
      accessor: (row) => row.name,
      cell: (row) => (
        <div className="flex items-center gap-2">
          <span>{row.emoji || "📦"}</span>
          <span className="font-medium">{row.name}</span>
        </div>
      ),
    },
    {
      id: "stock",
      header: "Stock",
      sortable: true,
      accessor: (row) => Number(row.stock || 0),
      className: "mono",
      cell: (row) => `${Number(row.stock || 0).toFixed(2)} ${row.unit}`,
    },
    {
      id: "costPrice",
      header: "Cost Price",
      sortable: true,
      accessor: (row) => Number(row.costPrice || 0),
      className: "mono",
      cell: (row) => formatCurrency(row.costPrice || 0),
    },
    {
      id: "value",
      header: "Total Value",
      sortable: true,
      accessor: (row) => Number(row.totalValue || 0),
      className: "mono text-right",
      headerClassName: "text-right",
      cell: (row) => <span className="block text-right font-semibold text-accent">{formatCurrency(row.totalValue)}</span>,
    },
  ];

  return (
    <div className="page-enter space-y-6">
      <PageHeader
        title="Inventory"
        breadcrumb="Operations / Inventory"
        description="Track products, stock movement, and inventory value from one screen."
      />

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={PackageOpen}
          label="Products"
          value={summaryLoading ? "..." : `${summary?.productsCount || 0}`}
          trend="Active catalog items"
          accent="info"
        />
        <StatCard
          icon={Boxes}
          label="Stock Value"
          value={summaryLoading ? "..." : formatCurrency(summary?.stockValue || 0)}
          trend="Based on cost price"
          accent="primary"
        />
        <StatCard
          icon={CircleAlert}
          label="Low Stock"
          value={summaryLoading ? "..." : `${summary?.lowStockCount || 0}`}
          trend="Needs restocking"
          trendDirection={(summary?.lowStockCount || 0) > 0 ? "down" : "up"}
          accent={(summary?.lowStockCount || 0) > 0 ? "warning" : "success"}
        />
        <StatCard
          icon={CircleCheckBig}
          label="Out of Stock"
          value={summaryLoading ? "..." : `${summary?.outOfStockCount || 0}`}
          trend="Immediate action required"
          trendDirection={(summary?.outOfStockCount || 0) > 0 ? "down" : "up"}
          accent={(summary?.outOfStockCount || 0) > 0 ? "danger" : "success"}
        />
      </section>

      <section className="surface-card rounded-lg border border-primary/30 bg-primary/5 p-4">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-primary-light">Milk Rate (Today)</Label>
            <Input
              type="number"
              value={milkRate}
              onChange={(event) => setMilkRate(event.target.value)}
              placeholder={ratesLoading ? "Loading..." : String(todayRates?.milkRate ?? "")}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs font-semibold uppercase tracking-wide text-primary-light">Yogurt Rate (Today)</Label>
            <Input
              type="number"
              value={yogurtRate}
              onChange={(event) => setYogurtRate(event.target.value)}
              placeholder={ratesLoading ? "Loading..." : String(todayRates?.yogurtRate ?? "")}
            />
          </div>
          <Button onClick={handleUpdateRates} className="self-end" disabled={ratesMutation.isPending}>
            {ratesMutation.isPending ? "Updating..." : "Update Daily Rates"}
          </Button>
        </div>
      </section>

      <section className="surface-card rounded-lg border border-border p-4">
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <TabsList className="h-auto w-full justify-start rounded-lg border border-border bg-surface-2 p-1 lg:w-auto">
              <TabsTrigger
                value="products"
                className="h-10 rounded-md px-4 data-[state=active]:bg-primary data-[state=active]:text-white"
              >
                Products
              </TabsTrigger>
              <TabsTrigger
                value="stock-log"
                className="h-10 rounded-md px-4 data-[state=active]:bg-primary data-[state=active]:text-white"
              >
                Stock-In Log
              </TabsTrigger>
              <TabsTrigger
                value="valuation"
                className="h-10 rounded-md px-4 data-[state=active]:bg-primary data-[state=active]:text-white"
              >
                Valuation Report
              </TabsTrigger>
            </TabsList>

            {activeTab === "products" && (
              <Button
                onClick={() => {
                  setSelectedProduct(null);
                  setIsProductModalOpen(true);
                }}
              >
                <Plus className="h-4 w-4" />
                Add Product
              </Button>
            )}

            {activeTab === "valuation" && (
              <Button variant="outline" onClick={exportValuation}>
                <FileDown className="h-4 w-4" />
                Export CSV
              </Button>
            )}
          </div>

          {(activeTab === "products" || activeTab === "valuation") && (
            <div className="mb-4 grid grid-cols-1 gap-3 xl:grid-cols-[1fr_220px_220px]">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-secondary" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  className="pl-10"
                  placeholder="Search products by code or name"
                />
              </div>

              <Select value={category} onValueChange={(next) => setCategory(next as (typeof CATEGORIES)[number])}>
                <SelectTrigger>
                  <SelectValue placeholder="Category" />
                </SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((item) => (
                    <SelectItem key={item} value={item}>
                      {item === "ALL" ? "All Categories" : item.replaceAll("_", " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={status} onValueChange={(next) => setStatus(next as (typeof STATUS_FILTERS)[number])}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">All Status</SelectItem>
                  <SelectItem value="IN_STOCK">In Stock</SelectItem>
                  <SelectItem value="LOW_STOCK">Low Stock</SelectItem>
                  <SelectItem value="OUT_OF_STOCK">Out of Stock</SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          <TabsContent value="products" className="mt-0">
            <DataTable
              columns={productColumns}
              rows={filteredProducts}
              loading={productsLoading}
              emptyTitle="No products found"
              emptyDescription="Try a different filter or add your first product."
              defaultRowsPerPage={10}
            />
          </TabsContent>

          <TabsContent value="stock-log" className="mt-0">
            {products.length === 0 && !productsLoading ? (
              <EmptyState
                icon={ArrowUpCircle}
                title="No products available"
                description="Add products first to see stock movement logs."
                className="min-h-[260px] border border-border"
              />
            ) : (
              <DataTable
                columns={stockLogColumns}
                rows={stockLogs}
                loading={stockLogLoading}
                emptyTitle="No stock activity yet"
                emptyDescription="Stock-in events will appear here automatically."
                defaultRowsPerPage={10}
              />
            )}
          </TabsContent>

          <TabsContent value="valuation" className="mt-0 space-y-4">
            <DataTable
              columns={valuationColumns}
              rows={valuationRows}
              loading={productsLoading}
              emptyTitle="No products for valuation"
              emptyDescription="Create products and set cost prices to calculate valuation."
              defaultRowsPerPage={10}
            />
            <div className="flex items-center justify-end rounded-lg border border-border bg-surface-2 px-4 py-3">
              <p className="mono text-base font-semibold text-text">
                Total Stock Value: <span className="text-accent">{formatCurrency(totalStockValue)}</span>
              </p>
            </div>
          </TabsContent>
        </Tabs>
      </section>

      <ProductModal
        open={isProductModalOpen}
        product={selectedProduct}
        loading={productMutation.isPending}
        onOpenChange={(open) => {
          setIsProductModalOpen(open);
          if (!open) setSelectedProduct(null);
        }}
        onSubmit={(values) => productMutation.mutate({ id: selectedProduct?.id, data: values })}
      />

      <StockInModal
        open={isStockInOpen}
        product={selectedProduct}
        loading={stockInMutation.isPending}
        onOpenChange={(open) => {
          setIsStockInOpen(open);
          if (!open) setSelectedProduct(null);
        }}
        onSubmit={(values) => {
          if (!selectedProduct) return;
          stockInMutation.mutate({
            id: selectedProduct.id,
            quantity: Number(values.quantity),
            supplier: values.supplier?.trim() || undefined,
            notes: values.notes?.trim() || undefined,
          });
        }}
      />

      <ConfirmationDialog
        open={isDeleteOpen}
        onOpenChange={(open) => {
          setIsDeleteOpen(open);
          if (!open) setSelectedProduct(null);
        }}
        title="Delete Product?"
        message={`"${selectedProduct?.name || "This product"}" will be marked inactive and hidden from the catalog.`}
        confirmText="Delete Product"
        onConfirm={() => {
          if (!selectedProduct) return;
          deleteMutation.mutate(selectedProduct.id);
        }}
        loading={deleteMutation.isPending}
      />
    </div>
  );
}

function ProductModal({
  open,
  onOpenChange,
  product,
  onSubmit,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onSubmit: (values: ProductFormState) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState<ProductFormState>({
    name: "",
    category: "OTHER",
    unit: "kg",
    sellingPrice: "",
    costPrice: "",
    stock: "0",
    lowStockThreshold: "5",
    emoji: "📦",
  });

  const [loadedProductId, setLoadedProductId] = useState<string | null>(null);

  if (product && loadedProductId !== product.id) {
    setForm({
      name: product.name || "",
      category: product.category || "OTHER",
      unit: product.unit || "kg",
      sellingPrice: String(product.sellingPrice ?? ""),
      costPrice: String(product.costPrice ?? ""),
      stock: String(product.stock ?? "0"),
      lowStockThreshold: String(product.lowStockThreshold ?? "5"),
      emoji: product.emoji || "📦",
    });
    setLoadedProductId(product.id);
  }

  if (!product && loadedProductId) {
    setLoadedProductId(null);
    setForm({
      name: "",
      category: "OTHER",
      unit: "kg",
      sellingPrice: "",
      costPrice: "",
      stock: "0",
      lowStockThreshold: "5",
      emoji: "📦",
    });
  }

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.name.trim()) return toast.error("Product name is required");
    if (Number(form.sellingPrice) <= 0 || Number(form.costPrice) < 0) {
      return toast.error("Enter valid selling and cost prices");
    }
    if (Number(form.lowStockThreshold) < 0 || Number(form.stock) < 0) {
      return toast.error("Stock values cannot be negative");
    }
    onSubmit(form);
  };

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      title={product ? "Edit Product" : "Add Product"}
      description="Maintain your catalog with clean and accurate product data."
      className="sm:max-w-[760px]"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="product-form" disabled={loading}>
            {loading ? "Saving..." : product ? "Update Product" : "Create Product"}
          </Button>
        </>
      }
    >
      <form id="product-form" onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="space-y-1 md:col-span-2">
          <Label>Name</Label>
          <Input value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} required />
        </div>

        <div className="space-y-1">
          <Label>Category</Label>
          <Select value={form.category} onValueChange={(value) => setForm((prev) => ({ ...prev, category: value }))}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.filter((item) => item !== "ALL").map((item) => (
                <SelectItem key={item} value={item}>
                  {item.replaceAll("_", " ")}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1">
          <Label>Unit</Label>
          <Input value={form.unit} onChange={(event) => setForm((prev) => ({ ...prev, unit: event.target.value }))} required />
        </div>

        <div className="space-y-1">
          <Label>Selling Price</Label>
          <Input
            type="number"
            value={form.sellingPrice}
            onChange={(event) => setForm((prev) => ({ ...prev, sellingPrice: event.target.value }))}
            required
          />
        </div>

        <div className="space-y-1">
          <Label>Cost Price</Label>
          <Input
            type="number"
            value={form.costPrice}
            onChange={(event) => setForm((prev) => ({ ...prev, costPrice: event.target.value }))}
            required
          />
        </div>

        {!product && (
          <div className="space-y-1">
            <Label>Opening Stock</Label>
            <Input
              type="number"
              value={form.stock}
              onChange={(event) => setForm((prev) => ({ ...prev, stock: event.target.value }))}
            />
          </div>
        )}

        <div className="space-y-1">
          <Label>Low Stock Threshold</Label>
          <Input
            type="number"
            value={form.lowStockThreshold}
            onChange={(event) => setForm((prev) => ({ ...prev, lowStockThreshold: event.target.value }))}
          />
        </div>

        <div className="space-y-2 md:col-span-2">
          <Label>Emoji</Label>
          <div className="grid grid-cols-6 gap-2 rounded-lg border border-border bg-surface-2 p-2">
            {EMOJI_OPTIONS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                onClick={() => setForm((prev) => ({ ...prev, emoji }))}
                className={cn(
                  "h-10 rounded-md border text-lg transition-all",
                  form.emoji === emoji
                    ? "border-primary bg-primary/20 shadow-glow"
                    : "border-border bg-surface hover:border-primary/40"
                )}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      </form>
    </AppModal>
  );
}

function StockInModal({
  open,
  onOpenChange,
  product,
  onSubmit,
  loading,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  product: Product | null;
  onSubmit: (values: { quantity: string; supplier: string; notes: string }) => void;
  loading: boolean;
}) {
  const [quantity, setQuantity] = useState("1");
  const [supplier, setSupplier] = useState("");
  const [notes, setNotes] = useState("");

  if (!open && (quantity !== "1" || supplier || notes)) {
    setQuantity("1");
    setSupplier("");
    setNotes("");
  }

  const changeQuantity = (delta: number) => {
    const current = Number(quantity || 0);
    const next = Math.max(0, Number((current + delta).toFixed(2)));
    setQuantity(String(next));
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (Number(quantity) <= 0) return toast.error("Quantity must be greater than zero");
    onSubmit({ quantity, supplier, notes });
  };

  return (
    <AppModal
      open={open}
      onOpenChange={onOpenChange}
      title={`Stock In ${product ? `- ${product.name}` : ""}`}
      description="Add incoming stock and keep movement records clean."
      className="sm:max-w-[560px]"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="stock-in-form" disabled={loading || !product}>
            {loading ? "Updating..." : "Confirm Stock In"}
          </Button>
        </>
      }
    >
      {!product ? (
        <EmptyState
          icon={ArrowUpCircle}
          title="Select a product first"
          description="Choose a product from the table, then open stock-in."
          className="min-h-[220px] border border-border"
        />
      ) : (
        <form id="stock-in-form" onSubmit={handleSubmit} className="space-y-3">
          <div className="rounded-lg border border-border bg-surface-2 p-3">
            <p className="text-xs uppercase tracking-wider text-text-secondary">Current Stock</p>
            <p className="mono mt-1 text-lg font-semibold text-text">
              {Number(product.stock || 0).toFixed(2)} {product.unit}
            </p>
          </div>

          <div className="space-y-1">
            <Label>Quantity</Label>
            <div className="grid grid-cols-[52px_1fr_52px] gap-2">
              <Button type="button" variant="outline" onClick={() => changeQuantity(-1)}>
                -
              </Button>
              <Input
                type="number"
                step="0.01"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="text-center text-base font-semibold"
              />
              <Button type="button" variant="outline" onClick={() => changeQuantity(1)}>
                +
              </Button>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Supplier</Label>
            <Input value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Optional supplier name" />
          </div>

          <div className="space-y-1">
            <Label>Notes</Label>
            <Input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional remarks" />
          </div>
        </form>
      )}
    </AppModal>
  );
}
