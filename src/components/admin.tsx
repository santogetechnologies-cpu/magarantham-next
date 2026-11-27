"use client";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Profile, capabilities, money } from "@/lib/core";
import { adminForms, adminNav, Field } from "@/lib/admin-fields";
import { api } from "./api";
import { useShop } from "./shop-context";
import { OrderView } from "./order-view";
import { AdminSidebar } from "./admin/sidebar";
import { AdminTopbar } from "./admin/topbar";
import { DashboardOverview, OverviewData } from "./admin/dashboard-overview";
import { ProductModal, ProductFormData } from "./admin/product-modal";
import { MessageTemplatesEditor } from "./admin/message-templates";
import { StockModal } from "./admin/stock-modal";
import { DataTable, Column } from "./admin/data-table";
import { CatalogueHierarchyManager } from "./admin/catalogue-hierarchy";
import { FestivalOffersManager } from "./admin/festival-offers";
import { PageHeader } from "./admin/page-header";
import { BannersManager } from "./admin/banners";
import { OrdersDashboard } from "./admin/orders-dashboard";

type Row = Record<string, any>;

function FieldInput({
  field: f,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  let show = value ?? "";
  if (f.rupees && typeof show === "number") show = show / 100;
  if (f.type === "datetime-local" && show)
    show = new Date(
      new Date(String(show)).getTime() -
      new Date(String(show)).getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 16);
  const change = (v: string) =>
    onChange(
      v === "" && f.nullable
        ? null
        : f.type === "number"
          ? Math.round(Number(v) * (f.rupees ? 100 : 1))
          : f.type === "datetime-local"
            ? v
              ? new Date(v).toISOString()
              : null
            : v,
    );
  return (
    <label className={f.type === "checkbox" ? "check" : ""}>
      {f.type === "checkbox" ? (
        <>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {f.label}
        </>
      ) : (
        <>
          {f.label}
          {f.type === "textarea" ? (
            <textarea
              value={String(show)}
              maxLength={2000}
              onChange={(e) => change(e.target.value)}
            />
          ) : f.type === "select" ? (
            <select
              value={String(show)}
              onChange={(e) => change(e.target.value)}
            >
              <option value="">Select an option</option>
              {f.choices?.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
              {f.options?.map((o) => (
                <option key={o} value={o}>
                  {o.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type || "text"}
              value={String(show)}
              step={f.rupees ? ".01" : "1"}
              maxLength={1000}
              onChange={(e) => change(e.target.value)}
            />
          )}
        </>
      )}
    </label>
  );
}

export function Admin({
  section = "",
  orderId,
  profile,
}: {
  section?: string;
  orderId?: string;
  profile: Profile;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [selected, setSelected] = useState<Row | null>(null);
  const [busy, setBusy] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [status, setStatus] = useState("");
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const router = useRouter();
  const searchParams = useSearchParams();
  const actionParam = searchParams.get("action");
  const tabParam = searchParams.get("tab");

  // Modals for products & stock operations
  const [productModalOpen, setProductModalOpen] = useState(
    section === "product-new" || (section === "products" && actionParam === "new"),
  );
  const [editingProduct, setEditingProduct] = useState<Row | null>(null);
  const [deletingProduct, setDeletingProduct] = useState<Row | null>(null);
  const [deletingStaff, setDeletingStaff] = useState<Row | null>(null);
  const [stockModalOpen, setStockModalOpen] = useState(
    section === "inventory" && actionParam === "adjust",
  );
  const [stockModalProductId, setStockModalProductId] = useState<string>("");
  const [inventoryTab, setInventoryTab] = useState<"all" | "low" | "movements">(
    tabParam === "low" || tabParam === "movements" ? tabParam : "all",
  );

  const { notice } = useShop();
  const [categories, setCategories] = useState<Row[]>([]);
  const [adminCatSearch, setAdminCatSearch] = useState("");
  const [viewAllFlatTable, setViewAllFlatTable] = useState(false);
  const categoryParam = searchParams.get("category");
  const searchQueryParam = searchParams.get("search");

  useEffect(() => {
    if (searchQueryParam) {
      setAdminCatSearch(searchQueryParam);
      setViewAllFlatTable(true);
    }
  }, [searchQueryParam]);

  function isSareeInCat(
    product: Row,
    cat: Row,
    allCats: Row[],
  ): boolean {
    if (product.category_id && String(product.category_id) === String(cat.id)) return true;
    if (product.subcategory_id) {
      if (String(product.subcategory_id) === String(cat.id)) return true;
      const sub = allCats.find((c) => String(c.id) === String(product.subcategory_id));
      if (sub && String(sub.parent_id) === String(cat.id)) return true;
    }
    const prodCatLower = String(product.category || "").trim().toLowerCase();
    const catNameLower = String(cat.name || "").trim().toLowerCase();
    if (prodCatLower && catNameLower && prodCatLower === catNameLower) {
      return true;
    }
    const prodCatSlug = prodCatLower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const catNameSlug = catNameLower.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const catSlug = String(cat.slug || "").trim().toLowerCase();
    if (prodCatSlug && (prodCatSlug === catNameSlug || prodCatSlug === catSlug)) {
      return true;
    }
    return false;
  }

  function reloadCategories() {
    api<Row>("/api/erp/reference?module=categories")
      .then((r) => setCategories(r.categories || []))
      .catch((e) => notice(e.message));
  }

  useEffect(() => {
    if (section === "products" || section === "product-new" || section === "pricing") {
      reloadCategories();
    }
  }, [section]);

  const requestVersion = useRef(0);
  const form = adminForms[section];
  const entity =
    form?.entity ||
    ({
      dashboard: "overview",
      staff: "profiles",
      "admin-accounts": "profiles",
      "staff-permissions": "profiles",
      audit: "audit_log",
      "stock-movements": "inventory",
      "low-stock": "inventory",
      "product-new": "products",
      pricing: "products",
      "price-history": "product_price_history",
      leaves: "employee_leaves",
      "attendance-reports": "attendance_records",
      "sales-reports": "orders",
      "stock-reports": "products",
      "employee-reports": "employees",
    } as Record<string, string>)[section] ||
    section ||
    "overview";

  async function load(page = 0) {
    const version = ++requestVersion.current;
    setBusy(true);
    try {
      const queryParam =
        section === "orders" && status
          ? `&status=${status}`
          : section === "low-stock"
            ? `&filter=low_stock`
            : "";
      const r = await api<Row>(`/api/admin/${entity}?page=${page}${queryParam}`);
      if (version !== requestVersion.current) return;
      if (entity === "overview") {
        setOverview(r as OverviewData);
      } else {
        setRows((old) =>
          page === 0
            ? r.rows
            : [...new Map([...old, ...r.rows].map((x) => [x.id, x])).values()],
        );
        setNextPage(r.nextPage ?? null);
        if (section === "settings" && r.rows[0]) {
          setSelected(
            Object.fromEntries(
              form.fields.map((f) => [f.key, r.rows[0][f.key]]),
            ),
          );
        }
      }
      setLoadError("");
    } catch (e) {
      if (version === requestVersion.current)
        setLoadError((e as Error).message);
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }

  useEffect(() => {
    requestVersion.current++;
    setSelected(null);
    setRows([]);
    setEditingProduct(null);
    if (section === "product-new" || (section === "products" && actionParam === "new")) {
      setProductModalOpen(true);
    } else {
      setProductModalOpen(false);
    }
    if (section === "inventory" && actionParam === "adjust") {
      setStockModalProductId("");
      setStockModalOpen(true);
    }
    if (section === "inventory") {
      setInventoryTab(
        tabParam === "low" || tabParam === "movements" ? tabParam : "all",
      );
    }
    void load();
  }, [section, status, actionParam, tabParam]);

  async function mutate(path: string, payload: unknown) {
    setBusy(true);
    try {
      const r = await api<Row>(path, payload);
      notice(r.message || "Saved.");
      await load();
      return true;
    } catch (e) {
      notice((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteProduct() {
    if (!deletingProduct) return;
    const target = deletingProduct;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/products?id=${encodeURIComponent(target.id)}`,
        {
          method: "DELETE",
          cache: "no-store",
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to delete saree.");
      }
      setDeletingProduct(null);
      notice(data.message || "Saree deleted.");
      await load();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDeleteStaff() {
    if (!deletingStaff) return;
    const target = deletingStaff;
    setBusy(true);
    try {
      const res = await fetch(
        `/api/admin/profiles?id=${encodeURIComponent(target.id)}`,
        {
          method: "DELETE",
          cache: "no-store",
        },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Failed to delete staff account.");
      }
      setDeletingStaff(null);
      notice(data.message || "Staff account deleted.");
      await load();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function edit(r: Row) {
    if (section === "products") {
      setEditingProduct(r);
      setProductModalOpen(true);
      return;
    }
    setSelected({
      id: r.id,
      ...Object.fromEntries(
        form.fields.map((f) => [
          f.key,
          r[f.key] ??
          form.defaults[f.key] ??
          (f.type === "checkbox" ? false : f.type === "number" ? 0 : ""),
        ]),
      ),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !selected) return;
    const data = Object.fromEntries(
      form.fields.map((f) => [
        f.key,
        selected[f.key] ??
        (f.nullable
          ? null
          : f.type === "checkbox"
            ? false
            : f.type === "number"
              ? 0
              : ""),
      ]),
    );
    if (section === "products")
      data.category =
        categories.find(
          (c) =>
            c.id ===
            categories.find((s) => s.id === selected.subcategory_id)?.parent_id,
        )?.name || "Sarees";
    if (
      (await mutate(`/api/admin/${entity}`, {
        id: typeof selected.id === "string" ? selected.id : null,
        data,
      })) &&
      section !== "settings"
    )
      setSelected(null);
  }

  const sectionTitles: Record<string, string> = {
    "": "Dashboard Overview",
    dashboard: "Dashboard Overview",
    products: "Saree Catalogue",
    "product-new": "Add Saree",
    inventory: "Stock Management",
    "stock-movements": "Stock Movement Ledger",
    "low-stock": "Low Stock Alerts",
    orders: "Online Orders",
    staff: "Staff Accounts & Access",
    "admin-accounts": "Staff User Accounts",
    "staff-permissions": "Role & Permission Matrix",
    audit: "Operational Activity Logs",
    coupons: "Coupon Codes & Vouchers",
    leaves: "Leave Management",
    pricing: "Product Pricing Matrix",
    "price-history": "Price Change Audit Trail",
    settings: "Store & Invoice Settings",
    "store-profile": "Store Profile & Branding",
    offers: "Promotional Offers",
    "sales-reports": "Sales Analytics",
    "stock-reports": "Stock Valuation",
    "employee-reports": "HR Reports",
    notifications: "Store Notifications",
  };

  const title = sectionTitles[section] || form?.title || "Store Overview";

  // Product table columns
  const productColumns: Column<Row>[] = [
    {
      key: "name",
      header: "Saree Product",
      render: (r) => (
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {r.image_path ? (
            <img
              src={r.image_path}
              alt={r.name}
              style={{
                width: 44,
                height: 44,
                objectFit: "cover",
                borderRadius: 4,
                border: "1px solid var(--erp-border, #EAD5C0)",
              }}
            />
          ) : (
            <div
              style={{
                width: 44,
                height: 44,
                background: "var(--erp-peach, #F8DFCA)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: 4,
                color: "var(--erp-burgundy, #800020)",
                fontWeight: 600,
                fontSize: 12,
              }}
            >
              SILK
            </div>
          )}
          <div>
            <strong style={{ display: "block", color: "var(--erp-maroon, #650019)" }}>
              {r.name}
            </strong>
            <small style={{ color: "var(--erp-text-muted, #6e5854)" }}>
              SKU: {r.sku} {r.barcode ? `· ${r.barcode}` : ""}
            </small>
          </div>
        </div>
      ),
      sortable: true,
      exportValue: (r) => `${r.name} (${r.sku})`,
    },
    {
      key: "category",
      header: "Category & Fabric",
      render: (r) => {
        const sub = r.subcategory_id
          ? categories.find((c) => c.id === r.subcategory_id)
          : null;
        return (
          <div>
            <span style={{ fontWeight: 600, color: "var(--erp-maroon, #650019)" }}>
              {r.category || r.saree_type || "Sarees"}
              {sub && sub.name.toLowerCase() !== "all styles" ? ` › ${sub.name}` : ""}
            </span>
            <small style={{ display: "block", color: "var(--erp-text-muted, #6e5854)" }}>
              {r.fabric || "Pure Mulberry Silk"} · {r.colour || "—"}
            </small>
          </div>
        );
      },
      sortable: true,
      exportValue: (r) => `${r.category || ""} - ${r.fabric || ""}`,
    },
    {
      key: "price_paise",
      header: "Pricing (Rs)",
      render: (r) => (
        <div>
          <strong style={{ color: "var(--erp-maroon, #650019)" }}>
            {money(r.price_paise)}
          </strong>
          {r.compare_at_price_paise > r.price_paise && (
            <small
              style={{
                display: "block",
                textDecoration: "line-through",
                color: "var(--erp-text-muted, #6e5854)",
              }}
            >
              {money(r.compare_at_price_paise)}
            </small>
          )}
        </div>
      ),
      sortable: true,
      exportValue: (r) => r.price_paise / 100,
    },
    {
      key: "stock_on_hand",
      header: "Stock Level",
      render: (r) => {
        const onHand = r.stock_on_hand ?? 0;
        const reserved = r.reserved ?? 0;
        const available = onHand - reserved;
        const minStock = r.min_stock_level ?? 0;
        const isLow = available > 0 && available <= minStock;
        const isOut = available <= 0;

        return (
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
              <strong>{available} avail</strong>
              <small style={{ color: "var(--erp-text-muted, #6e5854)" }}>
                ({onHand} on hand)
              </small>
            </div>
            {isOut ? (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  background: "#FEE2E2",
                  color: "#991B1B",
                }}
              >
                OUT OF STOCK
              </span>
            ) : isLow ? (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  background: "#FEF3C7",
                  color: "#92400E",
                }}
              >
                LOW STOCK
              </span>
            ) : (
              <span
                style={{
                  display: "inline-block",
                  padding: "2px 6px",
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 600,
                  background: "#DCFCE7",
                  color: "#166534",
                }}
              >
                IN STOCK
              </span>
            )}
          </div>
        );
      },
      sortable: true,
      exportValue: (r) => (r.stock_on_hand ?? 0) - (r.reserved ?? 0),
    },
    {
      key: "published",
      header: "Status",
      render: (r) => (
        <div>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 500,
              background: r.archived
                ? "#FEE2E2"
                : r.published
                  ? "var(--erp-peach, #F8DFCA)"
                  : "#E5E7EB",
              color: r.archived
                ? "#991B1B"
                : r.published
                  ? "var(--erp-burgundy, #800020)"
                  : "#4B5563",
            }}
          >
            {r.archived ? "Archived" : r.published ? "Online" : "Draft"}
          </span>
          {r.featured && !r.archived && (
            <small
              style={{
                display: "block",
                color: "var(--erp-gold, #C49A52)",
                fontWeight: 600,
              }}
            >
              ★ Featured
            </small>
          )}
        </div>
      ),
      sortable: true,
    },
    {
      key: "actions",
      header: "Actions",
      render: (r) => (
        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            className="text-link"
            onClick={() => {
              setEditingProduct(r);
              setProductModalOpen(true);
            }}
          >
            Edit
          </button>
          <button
            type="button"
            className="text-link"
            style={{ color: "var(--erp-gold, #C49A52)" }}
            onClick={() => {
              setStockModalProductId(r.id);
              setStockModalOpen(true);
            }}
          >
            Stock
          </button>
          <button
            type="button"
            className="text-link"
            disabled={busy}
            style={{ color: "#B91C1C" }}
            onClick={() => setDeletingProduct(r)}
          >
            Delete
          </button>
        </div>
      ),
    },
  ];

  // Inventory Table Columns
  const inventoryColumns: Column<Row>[] = [
    {
      key: "name",
      header: "Saree Product",
      render: (r) => (
        <div>
          <strong style={{ color: "var(--erp-maroon, #650019)" }}>{r.name}</strong>
          <small style={{ display: "block", color: "var(--erp-text-muted, #6e5854)" }}>
            SKU: {r.sku} {r.barcode ? `· ${r.barcode}` : ""}
          </small>
        </div>
      ),
      sortable: true,
      exportValue: (r) => `${r.name} (${r.sku})`,
    },
    {
      key: "stock_on_hand",
      header: "On Hand",
      render: (r) => <strong>{r.stock_on_hand ?? 0} units</strong>,
      sortable: true,
    },
    {
      key: "reserved",
      header: "Reserved / In Cart",
      render: (r) => <span>{r.reserved ?? 0} units</span>,
      sortable: true,
    },
    {
      key: "available",
      header: "Available to Sell",
      render: (r) => {
        const avail = (r.stock_on_hand ?? 0) - (r.reserved ?? 0);
        return (
          <strong
            style={{
              color: avail <= 0 ? "#991B1B" : avail <= 3 ? "#92400E" : "#166534",
            }}
          >
            {avail} units
          </strong>
        );
      },
      sortable: true,
      exportValue: (r) => (r.stock_on_hand ?? 0) - (r.reserved ?? 0),
    },
    {
      key: "min_stock_level",
      header: "Min Alert Level",
      render: (r) => <span>{r.min_stock_level ?? 0} units</span>,
      sortable: true,
    },
    {
      key: "actions",
      header: "Adjust",
      render: (r) => (
        <button
          type="button"
          className="button button-outline"
          style={{ padding: "4px 10px", fontSize: "12px" }}
          onClick={() => {
            setStockModalProductId(r.id);
            setStockModalOpen(true);
          }}
        >
          Adjust Stock ＋
        </button>
      ),
    },
  ];

  // Orders Table Columns
  const orderColumns: Column<Row>[] = [
    {
      key: "number",
      header: "Order Number",
      render: (o) => (
        <div>
          <strong style={{ color: "var(--erp-maroon, #650019)" }}>
            MS-{o.number}
          </strong>
          <small style={{ display: "block", color: "var(--erp-text-muted, #6e5854)" }}>
            {new Date(o.created_at).toLocaleString("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </small>
        </div>
      ),
      sortable: true,
      exportValue: (o) => `MS-${o.number}`,
    },
    {
      key: "customer",
      header: "Customer",
      render: (o) => (
        <div>
          <span>{o.address?.name || "Direct Customer"}</span>
          <small style={{ display: "block", color: "var(--erp-text-muted, #6e5854)" }}>
            {o.address?.phone || "—"} · {o.address?.city || ""}
          </small>
        </div>
      ),
      exportValue: (o) => `${o.address?.name || ""} (${o.address?.phone || ""})`,
    },
    {
      key: "total_paise",
      header: "Amount",
      render: (o) => <strong>{money(o.total_paise)}</strong>,
      sortable: true,
      exportValue: (o) => o.total_paise / 100,
    },
    {
      key: "status",
      header: "Order / Payment State",
      render: (o) => (
        <div>
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 12,
              fontSize: 11,
              fontWeight: 500,
              background:
                o.status === "delivered"
                  ? "#DCFCE7"
                  : o.status === "shipped"
                    ? "#DBEAFE"
                    : "#FEF3C7",
              color:
                o.status === "delivered"
                  ? "#166534"
                  : o.status === "shipped"
                    ? "#1E40AF"
                    : "#92400E",
            }}
          >
            {o.status?.replaceAll("_", " ")}
          </span>
          <small style={{ display: "block", color: "var(--erp-text-muted, #6e5854)" }}>
            Payment: {o.payment_status}
          </small>
        </div>
      ),
      sortable: true,
    },
    {
      key: "actions",
      header: "View",
      render: (o) => (
        <Link className="text-link" href={`/admin/orders/${o.id}`}>
          Open order ↗
        </Link>
      ),
    },
  ];

  return (
    <div className="luxury-admin-shell">
      <AdminSidebar
        currentSection={section}
        profile={profile}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="luxury-admin-viewport">
        <AdminTopbar
          section={section}
          profile={profile}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <main className="luxury-admin-main ms-main" key={section}>
          {orderId ? (
            <OrderView id={orderId} admin />
          ) : (
            <>
              {section !== "product-new" && section !== "products" && (
                <PageHeader
                  section={section}
                  actions={
                    section && section !== "dashboard" ? (
                      <>
                        <button
                          className="ms-btn ms-btn-ghost ms-btn-sm"
                          onClick={() => void load()}
                          disabled={busy}
                        >
                          Refresh
                        </button>
                        {section === "inventory" && (
                          <button
                            className="ms-btn ms-btn-primary ms-btn-sm"
                            onClick={() => {
                              setStockModalProductId("");
                              setStockModalOpen(true);
                            }}
                          >
                            + Record stock movement
                          </button>
                        )}
                      </>
                    ) : undefined
                  }
                />
              )}

              {loadError && (
                <div role="alert" className="ms-alert ms-alert-danger">
                  {loadError}
                </div>
              )}

              {/* OVERVIEW / DASHBOARD */}
              {(!section || section === "dashboard") && (
                <DashboardOverview
                  data={overview}
                  onAdjustStock={(productId) => {
                    setStockModalProductId(productId);
                    setStockModalOpen(true);
                  }}
                />
              )}

              {/* PRODUCTS SECTION (inline Add/Edit workspace OR Category Cards OR Filtered Catalogue table) */}
              {(section === "products" || section === "product-new") && (
                <div>
                  {productModalOpen || section === "product-new" ? (
                    <ProductModal
                      product={editingProduct as any}
                      categories={categories as any}
                      onClose={() => {
                        setProductModalOpen(false);
                        setEditingProduct(null);
                        if (actionParam === "new" || section === "product-new") {
                          if (categoryParam) {
                            router.push(`/admin/products?category=${encodeURIComponent(categoryParam)}`);
                          } else {
                            router.push("/admin/products");
                          }
                        }
                      }}
                      onSaved={() => {
                        setProductModalOpen(false);
                        setEditingProduct(null);
                        notice("Product saved.");
                        reloadCategories();
                        if (actionParam === "new" || section === "product-new") {
                          if (categoryParam) {
                            router.push(`/admin/products?category=${encodeURIComponent(categoryParam)}`);
                          } else {
                            router.push("/admin/products");
                          }
                        } else {
                          void load();
                        }
                      }}
                    />
                  ) : categoryParam ? (
                    // CATEGORY-FILTERED SAREE LISTING (e.g. /admin/products?category=kanchipuram)
                    (() => {
                      const paramSlug = categoryParam.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
                      const activeCat = categories.find(
                        (c) =>
                          !c.parent_id &&
                          (String(c.slug || "").toLowerCase() === categoryParam.toLowerCase() ||
                            String(c.name || "").toLowerCase() === categoryParam.toLowerCase() ||
                            String(c.name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") === paramSlug ||
                            String(c.id) === categoryParam),
                      );
                      const catName = activeCat?.name || categoryParam.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
                      const filteredCategoryRows = rows.filter((p) =>
                        activeCat
                          ? isSareeInCat(p, activeCat, categories)
                          : String(p.category || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") === paramSlug,
                      );
                      const catCover =
                        activeCat?.image_path ||
                        filteredCategoryRows.find((p) => p.image_path)?.image_path ||
                        "/assets/brand-logo.png";

                      return (
                        <div className="admin-cat-detail-wrap">
                          {/* Breadcrumb & Hero Header */}
                          <div className="admin-cat-detail-header">
                            <div className="admin-cat-header-left">
                              <button
                                type="button"
                                className="button button-outline admin-back-btn"
                                onClick={() => router.push("/admin/products")}
                              >
                                ← Back to All Categories
                              </button>
                              <div className="admin-cat-header-identity">
                                <img
                                  src={catCover}
                                  alt={catName}
                                  className="admin-cat-header-thumb"
                                />
                                <div>
                                  <div className="admin-cat-header-badges">
                                    <span className="eyebrow" style={{ margin: 0 }}>
                                      CATEGORY COLLECTION
                                    </span>
                                    <span className="admin-cat-count-pill">
                                      {filteredCategoryRows.length}{" "}
                                      {filteredCategoryRows.length === 1 ? "Saree" : "Sarees"}
                                    </span>
                                  </div>
                                  <h2 className="admin-cat-header-title">
                                    {catName} Collection
                                  </h2>
                                  <p className="admin-cat-header-desc">
                                    {activeCat?.description ||
                                      `All active sarees belonging to the ${catName} collection.`}
                                  </p>
                                </div>
                              </div>
                            </div>

                            <div className="admin-cat-header-actions">
                              <button
                                type="button"
                                className="button gold-btn"
                                onClick={() => {
                                  setEditingProduct({ category: catName });
                                  setProductModalOpen(true);
                                }}
                              >
                                ＋ Add Saree to {catName}
                              </button>
                              <button
                                type="button"
                                className="button button-outline"
                                onClick={() => {
                                  setStockModalProductId("");
                                  setStockModalOpen(true);
                                }}
                              >
                                Stock Adjust
                              </button>
                            </div>
                          </div>

                          {/* Filtered Sarees Table */}
                          {filteredCategoryRows.length > 0 ? (
                            <DataTable
                              columns={productColumns}
                              data={filteredCategoryRows}
                              searchKey={["name", "sku", "saree_type", "fabric", "colour"]}
                              searchPlaceholder={`Search within ${catName}...`}
                              exportFileName={`magarantham_${catName.toLowerCase()}_sarees`}
                              title={`${catName} Saree Listing`}
                            />
                          ) : (
                            <div className="admin-cat-empty-panel">
                              <div className="admin-cat-empty-icon">🪡</div>
                              <h3>No sarees found in {catName} yet</h3>
                              <p>
                                Start building this collection by adding your first saree with
                                images, variants and prices.
                              </p>
                              <button
                                type="button"
                                className="button gold-btn"
                                onClick={() => {
                                  setEditingProduct({ category: catName });
                                  setProductModalOpen(true);
                                }}
                              >
                                ＋ Add First {catName} Saree
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()
                  ) : !viewAllFlatTable ? (
                    // VISUAL CATEGORY CARDS GRID (/admin/products)
                    (() => {
                      const mainCats = categories.filter((c) => !c.parent_id);
                      const q = adminCatSearch.trim().toLowerCase();
                      const filteredMains = q
                        ? mainCats.filter(
                          (c) =>
                            String(c.name || "").toLowerCase().includes(q) ||
                            String(c.slug || "").toLowerCase().includes(q),
                        )
                        : mainCats;

                      return (
                        <div className="admin-cat-overview-wrap">
                          {/* Controls Bar */}
                          <div className="admin-cat-bar">
                            <div className="admin-cat-search-box">
                              <svg
                                width="15"
                                height="15"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                aria-hidden="true"
                              >
                                <circle cx="11" cy="11" r="8" />
                                <line x1="21" y1="21" x2="16.65" y2="16.65" />
                              </svg>
                              <input
                                type="search"
                                placeholder="Search categories by name..."
                                value={adminCatSearch}
                                onChange={(e) => setAdminCatSearch(e.target.value)}
                                className="admin-cat-search-input"
                              />
                            </div>

                            <div className="admin-cat-bar-actions">
                              <button
                                type="button"
                                className="button gold-btn"
                                onClick={() => {
                                  setEditingProduct(null);
                                  setProductModalOpen(true);
                                }}
                              >
                                ＋ Add Saree
                              </button>
                              <button
                                type="button"
                                className="button button-outline"
                                onClick={() => router.push("/admin/categories")}
                              >
                                Manage Categories ⚙
                              </button>
                              <button
                                type="button"
                                className="button button-outline"
                                onClick={() => setViewAllFlatTable(true)}
                              >
                                View All Products Table ▤
                              </button>
                            </div>
                          </div>

                          {/* Luxury Responsive Grid */}
                          <div className="admin-cat-cards-grid">
                            {filteredMains.map((cat) => {
                              const catProducts = rows.filter((p) =>
                                isSareeInCat(p, cat, categories),
                              );
                              const totalStock = catProducts.reduce(
                                (s, p) => s + (Number(p.stock_on_hand) || 0),
                                0,
                              );
                              const thumb =
                                cat.image_path ||
                                catProducts.find((p) => p.image_path)?.image_path ||
                                "/assets/brand-logo.png";

                              return (
                                <div
                                  key={cat.id}
                                  className="admin-cat-card"
                                  onClick={() =>
                                    router.push(
                                      `/admin/products?category=${encodeURIComponent(cat.slug || cat.name.toLowerCase())}`,
                                    )
                                  }
                                >
                                  <div className="admin-cat-card-thumb-wrap">
                                    <img
                                      src={thumb}
                                      alt={cat.name}
                                      className="admin-cat-card-thumb"
                                    />
                                    <span
                                      className={`admin-cat-status-badge ${cat.active !== false ? "active" : "inactive"}`}
                                    >
                                      {cat.active !== false ? "Active" : "Hidden"}
                                    </span>
                                  </div>

                                  <div className="admin-cat-card-body">
                                    <div className="admin-cat-card-head">
                                      <h3 className="admin-cat-card-title">{cat.name}</h3>
                                      <span className="admin-cat-card-count">
                                        {catProducts.length}{" "}
                                        {catProducts.length === 1 ? "Saree" : "Sarees"}
                                      </span>
                                    </div>
                                    <p className="admin-cat-card-desc">
                                      {cat.description ||
                                        `Explore all handloom ${cat.name} sarees in stock.`}
                                    </p>
                                    <div className="admin-cat-card-footer">
                                      <span className="admin-cat-stock-info">
                                        {totalStock} units in stock
                                      </span>
                                      <span className="admin-cat-view-link">
                                        View Collection →
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })()
                  ) : (
                    // FLAT ALL SAREES TABLE
                    <div>
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          marginBottom: 16,
                        }}
                      >
                        <button
                          type="button"
                          className="button button-outline"
                          onClick={() => setViewAllFlatTable(false)}
                        >
                          ← Back to Category Cards
                        </button>
                        <button
                          type="button"
                          className="button gold-btn"
                          onClick={() => {
                            setEditingProduct(null);
                            setProductModalOpen(true);
                          }}
                        >
                          Add Saree ＋
                        </button>
                      </div>
                      <DataTable
                        columns={productColumns}
                        data={rows}
                        searchKey={["name", "sku", "saree_type", "fabric", "colour"]}
                        searchPlaceholder="Search sarees by name, SKU, weave or colour..."
                        exportFileName="magarantham_sarees_catalogue"
                        title="All Sarees Master Catalogue"
                        actions={
                          <div style={{ display: "flex", gap: "8px" }}>
                            <button
                              type="button"
                              className="button button-outline"
                              onClick={() => {
                                setStockModalProductId("");
                                setStockModalOpen(true);
                              }}
                            >
                              Stock Adjust
                            </button>
                          </div>
                        }
                      />
                    </div>
                  )}
                </div>
              )}

              {/* INVENTORY / STOCK MANAGEMENT */}
              {(section === "inventory" ||
                section === "stock-movements" ||
                section === "low-stock") && (
                  <div>
                    <div
                      style={{
                        display: "flex",
                        gap: 8,
                        marginBottom: 16,
                        borderBottom: "1px solid var(--erp-border, #EAD5C0)",
                        paddingBottom: 8,
                      }}
                    >
                      <button
                        type="button"
                        className={`button ${inventoryTab === "all" ? "" : "button-outline"}`}
                        onClick={() => setInventoryTab("all")}
                      >
                        All Stock Balances
                      </button>
                      <button
                        type="button"
                        className={`button ${inventoryTab === "low" ? "" : "button-outline"}`}
                        onClick={() => setInventoryTab("low")}
                      >
                        Low Stock Alerts
                      </button>
                    </div>

                    <DataTable
                      columns={inventoryColumns}
                      data={
                        inventoryTab === "low"
                          ? rows.filter(
                            (r) =>
                              (r.stock_on_hand ?? 0) - (r.reserved ?? 0) <=
                              (r.min_stock_level ?? 0),
                          )
                          : rows
                      }
                      searchKey={["name", "sku"]}
                      searchPlaceholder="Search inventory by product name or SKU..."
                      exportFileName="magarantham_inventory_stock"
                      title="Stock Ledger & Valuation"
                      actions={
                        <button
                          type="button"
                          className="button"
                          onClick={() => {
                            setStockModalProductId("");
                            setStockModalOpen(true);
                          }}
                        >
                          Record Stock Movement ＋
                        </button>
                      }
                    />
                  </div>
                )}

              {/* ORDERS SECTION */}
              {section === "orders" && <OrdersDashboard />}

              {/* STAFF & ACCOUNTS SECTION */}
              {(section === "staff" ||
                section === "admin-accounts" ||
                section === "staff-permissions") && (
                  <div>
                    {profile.role === "superadmin" && (
                      <form
                        className="form-panel"
                        style={{ marginBottom: 28 }}
                        onSubmit={async (e) => {
                          e.preventDefault();
                          const formEl = e.currentTarget;
                          const f = new FormData(formEl);
                          const okRes = await mutate("/api/auth/billing", {
                            name: f.get("name"),
                            email: f.get("email"),
                            phone: f.get("phone") || "",
                            password: f.get("password"),
                          });
                          if (okRes) formEl.reset();
                        }}
                      >
                        <h3 style={{ color: "var(--erp-burgundy, #800020)" }}>
                          Create Billing User Account
                        </h3>
                        <p style={{ color: "var(--erp-text-muted, #6e5854)", marginBottom: 16 }}>
                          Billing users can log in directly to the POS Billing Register to scan sarees, print bills, and view their own bills. Store settings and staff controls remain Super Administrator only.
                        </p>
                        <div className="form-grid">
                          <label>
                            Billing User Name *
                            <input
                              name="name"
                              minLength={2}
                              maxLength={80}
                              required
                              placeholder="e.g. K. Revathi"
                            />
                          </label>
                          <label>
                            Email Address *
                            <input
                              name="email"
                              type="email"
                              required
                              placeholder="billing@magarantham.com"
                            />
                          </label>
                          <label>
                            Phone Number (Optional)
                            <input
                              name="phone"
                              type="text"
                              maxLength={25}
                              placeholder="+91 98765 43210"
                            />
                          </label>
                          <label>
                            Password *
                            <input
                              name="password"
                              type="password"
                              minLength={6}
                              maxLength={128}
                              required
                              autoComplete="new-password"
                              placeholder="Enter password"
                            />
                          </label>
                        </div>
                        <div style={{ marginTop: 16 }}>
                          <button disabled={busy} className="button">
                            {busy ? "Creating Billing User..." : "+ Create Billing User"}
                          </button>
                        </div>
                      </form>
                    )}

                    <h3 style={{ marginBottom: 16, color: "var(--erp-maroon, #650019)" }}>
                      Active Staff & Role Permissions Matrix
                    </h3>

                    {rows.map((p) => (
                      <StaffEditor
                        key={p.id}
                        row={p}
                        self={profile.id}
                        busy={busy}
                        save={(data) => mutate("/api/admin/profiles", data)}
                        onResetPassword={(userId, password) =>
                          mutate("/api/auth/staff-password", {
                            user_id: userId,
                            password,
                          })
                        }
                        onDelete={() => setDeletingStaff(p)}
                      />
                    ))}

                    {deletingStaff && (
                      <div
                        className="luxury-modal-overlay"
                        onClick={() => !busy && setDeletingStaff(null)}
                        role="dialog"
                        aria-modal="true"
                      >
                        <div
                          className="luxury-modal-card"
                          style={{ maxWidth: 460 }}
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="modal-header">
                            <div>
                              <span className="modal-eyebrow">✦ STAFF ACCESS CONTROL</span>
                              <h2 className="modal-title">Delete Staff Account</h2>
                            </div>
                            <button
                              type="button"
                              className="modal-close-btn"
                              disabled={busy}
                              onClick={() => setDeletingStaff(null)}
                              aria-label="Close"
                            >
                              ✕
                            </button>
                          </div>
                          <div className="modal-form-body">
                            <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                              Delete account{" "}
                              <strong>{deletingStaff.display_name || deletingStaff.email}</strong>{" "}
                              ({deletingStaff.email})? This removes their login access permanently.
                            </p>
                            <div className="modal-actions-footer">
                              <button
                                type="button"
                                className="button outline-btn"
                                disabled={busy}
                                onClick={() => setDeletingStaff(null)}
                              >
                                Cancel
                              </button>
                              <button
                                type="button"
                                className="button"
                                style={{ background: "#B91C1C", borderColor: "#B91C1C" }}
                                disabled={busy}
                                onClick={() => void confirmDeleteStaff()}
                              >
                                {busy ? "Deleting..." : "Delete Account"}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

              {/* AUDIT LOG SECTION */}
              {section === "audit" && (
                <div>
                  <DataTable
                    columns={[
                      {
                        key: "created_at",
                        header: "Timestamp",
                        render: (r) => (
                          <div>
                            <strong>
                              {new Date(r.created_at).toLocaleString("en-IN", {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })}
                            </strong>
                          </div>
                        ),
                        sortable: true,
                        exportValue: (r) => r.created_at,
                      },
                      {
                        key: "action",
                        header: "Operation / Action",
                        render: (r) => (
                          <span
                            style={{
                              fontFamily: "monospace",
                              padding: "2px 6px",
                              background: "var(--erp-peach, #F8DFCA)",
                              borderRadius: 4,
                              color: "var(--erp-burgundy, #800020)",
                              fontWeight: 600,
                            }}
                          >
                            {r.action}
                          </span>
                        ),
                        sortable: true,
                      },
                      {
                        key: "entity",
                        header: "Entity Affected",
                        render: (r) => (
                          <div>
                            <strong>{r.entity}</strong>
                            {r.entity_id && (
                              <small
                                style={{
                                  display: "block",
                                  color: "var(--erp-text-muted, #6e5854)",
                                  fontSize: 10,
                                }}
                              >
                                {r.entity_id}
                              </small>
                            )}
                          </div>
                        ),
                        sortable: true,
                      },
                      {
                        key: "actor_id",
                        header: "Staff Actor",
                        render: (r) => (
                          <span>{r.actor_id ? `${r.actor_id.slice(0, 8)}...` : "System / Scheduled"}</span>
                        ),
                      },
                    ]}
                    data={rows}
                    searchKey={["action", "entity"]}
                    searchPlaceholder="Search activity logs..."
                    exportFileName="magarantham_audit_trail"
                    title="Operational Activity Logs"
                  />
                </div>
              )}

              {/* FESTIVAL OFFERS DYNAMIC TARGETING & PROMOTIONS */}
              {section === "offers" && (
                <FestivalOffersManager onRefresh={load} />
              )}

              {section === "banners" && <BannersManager />}

              {section === "settings" && profile.role === "superadmin" && <MessageTemplatesEditor notice={notice} />}

              {/* GENERAL ADMIN FORMS (Banners, Shipping, Bulk, Coupons, Leaves, Settings) */}
              {form && section !== "products" && section !== "offers" && section !== "banners" && (
                <div>
                  {section !== "settings" && section !== "bulk" && (
                    <div style={{ marginBottom: 16 }}>
                      <button
                        className="button"
                        onClick={() =>
                          setSelected({
                            ...Object.fromEntries(
                              form.fields.map((f) => [
                                f.key,
                                f.nullable
                                  ? null
                                  : f.type === "checkbox"
                                    ? false
                                    : f.type === "number"
                                      ? 0
                                      : f.options?.[0] || "",
                              ]),
                            ),
                            ...form.defaults,
                          })
                        }
                      >
                        Add {form.title} ＋
                      </button>
                    </div>
                  )}

                  {selected && (
                    <form className="form-panel" onSubmit={save} style={{ marginBottom: 24 }}>
                      <h2 style={{ color: "var(--erp-burgundy, #800020)" }}>
                        {section === "settings"
                          ? "Store Configuration & Tax Settings"
                          : selected.id
                            ? "Edit Details"
                            : "Add New Record"}
                      </h2>
                      <div className="form-grid">
                        {form.fields.map((f) => (
                          <FieldInput
                            key={f.key}
                            field={
                              f.key === "subcategory_id"
                                ? {
                                  ...f,
                                  choices: categories
                                    .filter((c) => c.parent_id)
                                    .map((c) => ({
                                      value: c.id,
                                      label: `${categories.find((m) => m.id === c.parent_id)?.name ||
                                        ""
                                        } / ${c.name}`,
                                    })),
                                }
                                : f
                            }
                            value={selected[f.key]}
                            onChange={(v) => setSelected({ ...selected, [f.key]: v })}
                          />
                        ))}
                      </div>

                      <div className="button-row" style={{ marginTop: 20 }}>
                        <button className="button" disabled={busy}>
                          Save {section === "settings" ? "Settings" : "Changes"}
                        </button>
                        {section !== "settings" && (
                          <button
                            type="button"
                            className="text-link"
                            onClick={() => setSelected(null)}
                          >
                            Cancel
                          </button>
                        )}
                      </div>
                    </form>
                  )}

                  {section !== "settings" && (
                    <div className="data-table">
                      <table style={{ minWidth: 680 }}>
                        <thead>
                          <tr>
                            <th style={{ minWidth: 160, whiteSpace: "nowrap" }}>Name / Code</th>
                            <th style={{ minWidth: 220, whiteSpace: "nowrap" }}>Details</th>
                            <th style={{ minWidth: 110, whiteSpace: "nowrap" }}>Status</th>
                            <th style={{ minWidth: 110, whiteSpace: "nowrap" }}>Action</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((r) => (
                            <tr key={r.id}>
                              <td>
                                <strong>{r.name || r.title || r.code}</strong>
                                <small style={{ display: "block", color: "var(--erp-text-muted)" }}>
                                  {r.sku || r.phone || r.code || ""}
                                </small>
                              </td>
                              <td>
                                {section === "offers" || section === "coupons"
                                  ? `${r.discount_bps ? `${r.discount_bps / 100}%` : r.discount_amount_paise ? money(r.discount_amount_paise) : "Active offer"}`
                                  : section === "leaves"
                                    ? `${r.leave_type} · ${r.start_date} to ${r.end_date} (${r.days} days)`
                                    : section === "shipping"
                                      ? r.url_template
                                      : r.subtitle || r.kind || "—"}
                              </td>
                              <td>
                                {r.published === false ||
                                  r.active === false ||
                                  r.enabled === false
                                  ? "Inactive"
                                  : "Active"}
                              </td>
                              <td>
                                <button className="text-link" onClick={() => edit(r)}>
                                  Edit
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!rows.length && (
                        <p style={{ padding: 24, textAlign: "center", color: "#6e5854" }}>
                          No records found.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Delete Saree Confirmation Modal (non-blocking) */}
              {deletingProduct && (
                <div
                  className="luxury-modal-overlay"
                  onClick={() => !busy && setDeletingProduct(null)}
                  role="dialog"
                  aria-modal="true"
                >
                  <div
                    className="luxury-modal-card"
                    style={{ maxWidth: 460 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="modal-header">
                      <div>
                        <span className="modal-eyebrow">✦ CATALOGUE MANAGEMENT</span>
                        <h2 className="modal-title">Delete Saree</h2>
                      </div>
                      <button
                        type="button"
                        className="modal-close-btn"
                        disabled={busy}
                        onClick={() => setDeletingProduct(null)}
                        aria-label="Close"
                      >
                        ✕
                      </button>
                    </div>
                    <div className="modal-form-body">
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                        Are you sure you want to delete{" "}
                        <strong>{deletingProduct.name}</strong> (
                        <code>{deletingProduct.sku}</code>)? This will remove it from
                        your website and POS catalogue.
                      </p>
                      <div className="modal-actions-footer">
                        <button
                          type="button"
                          className="button outline-btn"
                          disabled={busy}
                          onClick={() => setDeletingProduct(null)}
                        >
                          Cancel
                        </button>
                        <button
                          type="button"
                          className="button"
                          style={{ background: "#B91C1C", borderColor: "#B91C1C" }}
                          disabled={busy}
                          onClick={() => void confirmDeleteProduct()}
                        >
                          {busy ? "Deleting..." : "Delete Saree"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* Stock Modal for quick adjustments */}
              {stockModalOpen && (
                <StockModal
                  productId={stockModalProductId}
                  products={rows.map((r) => ({
                    id: r.id,
                    name: r.name,
                    sku: r.sku,
                    stock_on_hand: r.stock_on_hand ?? 0,
                  }))}
                  onClose={() => {
                    setStockModalOpen(false);
                    setStockModalProductId("");
                  }}
                  onSaved={() => {
                    setStockModalOpen(false);
                    setStockModalProductId("");
                    void load();
                  }}
                />
              )}

              {nextPage !== null && (
                <div style={{ marginTop: 24 }}>
                  <button
                    className="button button-outline"
                    disabled={busy}
                    onClick={() => void load(nextPage)}
                  >
                    Load More Records
                  </button>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}

function StaffEditor({
  row: r,
  self,
  busy,
  save,
  onResetPassword,
  onDelete,
}: {
  row: Row;
  self: string;
  busy: boolean;
  save: (v: unknown) => Promise<boolean>;
  onResetPassword: (userId: string, password: string) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [permissions, setPermissions] = useState<string[]>(r.permissions || []);
  const [suspended, setSuspended] = useState<boolean>(r.suspended || false);
  const [resetOpen, setResetOpen] = useState(false);
  const [newPassword, setNewPassword] = useState("");

  return (
    <form
      className="form-panel"
      style={{ marginBottom: 16 }}
      onSubmit={(e) => {
        e.preventDefault();
        void save({ user_id: r.id, permissions, suspended });
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <h3 style={{ margin: 0, color: "var(--erp-burgundy, #800020)" }}>
            {r.display_name || r.email}
          </h3>
          <p style={{ margin: "4px 0", color: "var(--erp-text-muted, #6e5854)" }}>
            {r.email} · Role: <strong>{r.role}</strong>
          </p>
        </div>
        <span
          style={{
            padding: "3px 10px",
            borderRadius: 12,
            fontSize: 12,
            fontWeight: 600,
            background: suspended ? "#FEE2E2" : "#DCFCE7",
            color: suspended ? "#991B1B" : "#166534",
          }}
        >
          {suspended ? "Suspended" : "Active"}
        </span>
      </div>

      <div className="permission-grid" style={{ marginTop: 16, marginBottom: 16 }}>
        {capabilities.map((c) => (
          <label className="check" key={c}>
            <input
              type="checkbox"
              checked={permissions.includes(c)}
              disabled={r.role !== "manager" || r.id === self}
              onChange={(e) =>
                setPermissions(
                  e.target.checked
                    ? [...permissions, c]
                    : permissions.filter((p) => p !== c),
                )
              }
            />
            {c}
          </label>
        ))}
      </div>

      {resetOpen && (
        <div
          style={{
            marginBottom: 14,
            padding: 14,
            borderRadius: 10,
            background: "var(--erp-cream, #FFF8EF)",
            border: "1px solid var(--erp-border, #EAD5C0)",
            display: "flex",
            gap: 10,
            alignItems: "flex-end",
            flexWrap: "wrap",
          }}
        >
          <label className="input-group" style={{ flex: "1 1 220px", margin: 0 }}>
            <span>Set New Password (min 6 characters)</span>
            <input
              type="password"
              minLength={6}
              maxLength={128}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
              autoComplete="new-password"
            />
          </label>
          <button
            type="button"
            className="button gold-btn mini-btn"
            disabled={busy || newPassword.length < 6}
            onClick={async () => {
              const okRes = await onResetPassword(r.id, newPassword);
              if (okRes) {
                setNewPassword("");
                setResetOpen(false);
              }
            }}
          >
            Update Password
          </button>
          <button
            type="button"
            className="button outline-btn mini-btn"
            onClick={() => {
              setNewPassword("");
              setResetOpen(false);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <label className="check" style={{ margin: 0 }}>
          <input
            type="checkbox"
            checked={suspended}
            disabled={r.id === self}
            onChange={(e) => setSuspended(e.target.checked)}
          />
          Suspend Account Access
        </label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {r.id !== self && r.role !== "superadmin" && (
            <>
              <button
                type="button"
                disabled={busy}
                className="button button-outline"
                style={{ padding: "6px 14px" }}
                onClick={() => setResetOpen((v) => !v)}
              >
                {resetOpen ? "Hide Password Reset" : "Reset Password"}
              </button>
              <button
                type="button"
                disabled={busy}
                className="button button-outline"
                style={{ padding: "6px 14px", color: "#B91C1C", borderColor: "#FCA5A5" }}
                onClick={onDelete}
              >
                Delete Account
              </button>
            </>
          )}
          <button
            disabled={busy || r.id === self}
            className="button button-outline"
            style={{ padding: "6px 14px" }}
          >
            Save Permissions & Status
          </button>
        </div>
      </div>
    </form>
  );
}
