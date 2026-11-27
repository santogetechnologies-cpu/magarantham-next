"use client";
import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { api } from "../api";
import { ProductModal, ProductFormData } from "./product-modal";
import { ImageUploader } from "./image-uploader";
import { ColourStock, money } from "@/lib/core";
import { ColourStockEditor } from "./colour-stock-editor";

export type CategoryRow = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  active: boolean;
  image_path?: string;
  description?: string;
  subcategory_count?: number;
  product_count?: number;
  piece_count?: number;
};

export type ProductRow = {
  id: string;
  name: string;
  sku: string;
  barcode?: string | null;
  slug: string;
  category: string;
  category_id?: string;
  subcategory_id?: string | null;
  subcategory_name?: string;
  saree_type?: string;
  fabric?: string;
  colour?: string;
  design?: string;
  description?: string;
  image_path?: string;
  price_paise: number;
  purchase_price_paise?: number;
  discount_percent?: number;
  stock_on_hand: number;
  reserved: number;
  min_stock_level?: number;
  published: boolean;
  featured: boolean;
  archived: boolean;
  colours?: ColourStock[];
  undefined_quantity?: number;
  online_ready?: boolean;
};

const COLOUR_PRESETS: { name: string; hex: string }[] = [
  { name: "Purple", hex: "#7C3AED" },
  { name: "Green", hex: "#2E7D32" },
  { name: "Red", hex: "#C62828" },
  { name: "Crimson Red", hex: "#B91C1C" },
  { name: "Maroon", hex: "#800020" },
  { name: "Beige", hex: "#D4A373" },
  { name: "Blue", hex: "#1D4ED8" },
  { name: "Gold", hex: "#C49A52" },
  { name: "Pink", hex: "#DB2777" },
  { name: "Magenta", hex: "#A21CAF" },
  { name: "Ivory", hex: "#E7DFD3" },
  { name: "Yellow", hex: "#CA8A04" },
  { name: "Teal", hex: "#0F766E" },
  { name: "Orange", hex: "#EA580C" },
  { name: "Terracotta", hex: "#B45309" },
  { name: "Wine", hex: "#650019" },
];

function colourHex(name?: string): string {
  const map: Record<string, string> = {
    purple: "#7C3AED",
    green: "#2E7D32",
    red: "#C62828",
    "crimson red": "#B91C1C",
    maroon: "#800020",
    beige: "#D4A373",
    blue: "#1D4ED8",
    gold: "#C49A52",
    pink: "#DB2777",
    magenta: "#A21CAF",
    ivory: "#E7DFD3",
    yellow: "#CA8A04",
    teal: "#0F766E",
    orange: "#EA580C",
    terracotta: "#B45309",
    wine: "#650019",
  };
  return map[(name || "").trim().toLowerCase()] || "#800020";
}

function makeSlug(text: string) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 110);
}

export function CatalogueHierarchyManager({
  onNotice,
}: {
  onNotice?: (msg: string) => void;
}) {
  const [categories, setCategories] = useState<CategoryRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [loading, setLoading] = useState(true);

  // 4-LEVEL DRILLDOWN STATE
  // Level 1: null (Main Categories view)
  // Level 2: selectedMainCategory
  // Level 3: selectedSubCategory
  // Level 4: selectedProduct (Individual Pieces view)
  const [selectedMainCategory, setSelectedMainCategory] = useState<CategoryRow | null>(null);
  const [selectedSubCategory, setSelectedSubCategory] = useState<CategoryRow | null>(null);
  const [selectedProduct, setSelectedProduct] = useState<ProductRow | null>(null);

  // Search states at each level
  const [mainSearch, setMainSearch] = useState("");
  const [subSearch, setSubSearch] = useState("");
  const [productSearch, setProductSearch] = useState("");

  // Modals
  const [categoryModal, setCategoryModal] = useState<{
    isOpen: boolean;
    isSub: boolean;
    parentId: string | null;
    id: string | null;
    name: string;
    slug: string;
    active: boolean;
    image_path: string;
    description: string;
  } | null>(null);

  const [productModalOpen, setProductModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Partial<ProductFormData> | null>(null);

  const [savingCategory, setSavingCategory] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Fetch Categories and Products
  async function reloadAll() {
    try {
      const all = async <T,>(path: string) => {
        const out: T[] = [];
        for (let page = 0; page < 50; page++) {
          const r = await api<{ rows: T[]; nextPage: number | null }>(`${path}?page=${page}`);
          out.push(...(r.rows || []));
          if (r.nextPage == null) break;
        }
        return out;
      };
      const [cats, prods] = await Promise.all([
        all<CategoryRow>("/api/erp/product_categories"),
        all<ProductRow>("/api/admin/products"),
      ]);
      setCategories(cats);
      setProducts(prods);
    } catch (e) {
      if (onNotice) onNotice((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void reloadAll();
  }, []);


  // Main Categories (parent_id is null)
  const mainCategories = useMemo(
    () => categories.filter((c) => !c.parent_id),
    [categories],
  );

  // Subcategories for selected Main Category
  const subCategoriesForMain = useMemo(() => {
    if (!selectedMainCategory) return [];
    return categories.filter((c) => c.parent_id === selectedMainCategory.id);
  }, [categories, selectedMainCategory]);

  // Products under selected Sub Category (or Main Category if viewing all)
  const productsForSub = useMemo(() => {
    if (!selectedSubCategory) {
      if (!selectedMainCategory) return [];
      // Products under main category
      return products.filter((p) => {
        if (p.category_id && String(p.category_id) === String(selectedMainCategory.id)) return true;
        if (p.category && p.category.trim().toLowerCase() === selectedMainCategory.name.trim().toLowerCase()) return true;
        const sub = categories.find((c) => String(c.id) === String(p.subcategory_id));
        if (sub && sub.parent_id === selectedMainCategory.id) return true;
        return false;
      });
    }
    return products.filter(
      (p) =>
        p.subcategory_id === selectedSubCategory.id ||
        (selectedMainCategory &&
          p.category.trim().toLowerCase() === selectedMainCategory.name.trim().toLowerCase() &&
          p.subcategory_name?.trim().toLowerCase() === selectedSubCategory.name.trim().toLowerCase()),
    );
  }, [products, selectedSubCategory, selectedMainCategory, categories]);

  // Statistics calculation for main categories
  const mainCatStats = useMemo(() => {
    const stats = new Map<string, { subCount: number; prodCount: number; pieceCount: number; thumb?: string }>();
    for (const m of mainCategories) {
      const subs = categories.filter((c) => c.parent_id === m.id);
      const prods = products.filter((p) => {
        if (p.category_id && String(p.category_id) === String(m.id)) return true;
        if (p.category && p.category.trim().toLowerCase() === m.name.trim().toLowerCase()) return true;
        const sub = categories.find((c) => String(c.id) === String(p.subcategory_id));
        return sub && sub.parent_id === m.id;
      });
      const pieceCount = prods.reduce((sum, p) => sum + (p.stock_on_hand || 0), 0);
      const thumb = m.image_path || prods.find((p) => p.image_path)?.image_path;
      stats.set(m.id, {
        subCount: subs.length,
        prodCount: prods.length,
        pieceCount,
        thumb,
      });
    }
    return stats;
  }, [mainCategories, categories, products]);

  // Statistics calculation for subcategories
  const subCatStats = useMemo(() => {
    const stats = new Map<string, { prodCount: number; pieceCount: number; thumb?: string }>();
    for (const s of subCategoriesForMain) {
      const prods = products.filter(
        (p) =>
          p.subcategory_id === s.id ||
          (p.subcategory_name && p.subcategory_name.trim().toLowerCase() === s.name.trim().toLowerCase()),
      );
      const pieceCount = prods.reduce((sum, p) => sum + (p.stock_on_hand || 0), 0);
      const thumb = s.image_path || prods.find((p) => p.image_path)?.image_path;
      stats.set(s.id, {
        prodCount: prods.length,
        pieceCount,
        thumb,
      });
    }
    return stats;
  }, [subCategoriesForMain, products]);

  // -------------------------------------------------------------
  // CATEGORY SAVE / DELETE HANDLERS
  // -------------------------------------------------------------
  async function handleSaveCategory(e: React.FormEvent) {
    e.preventDefault();
    if (!categoryModal) return;
    setSavingCategory(true);
    try {
      const trimmedName = categoryModal.name.trim();
      const finalSlug = makeSlug(categoryModal.slug) || makeSlug(trimmedName);
      const safeId = categoryModal.id && categoryModal.id.trim() ? categoryModal.id.trim() : null;
      const safeParentId = categoryModal.parentId && categoryModal.parentId.trim() ? categoryModal.parentId.trim() : null;

      await api("/api/erp/product_categories", {
        id: safeId,
        data: {
          parent_id: safeParentId,
          name: trimmedName,
          slug: finalSlug,
          active: Boolean(categoryModal.active),
          image_path: (categoryModal.image_path || "").trim(),
          description: (categoryModal.description || "").trim(),
        },
      });
      if (onNotice) {
        onNotice(
          safeId
            ? `"${trimmedName}" updated.`
            : `${categoryModal.isSub ? "Sub Category" : "Main Category"} "${trimmedName}" created.`,
        );
      }
      setCategoryModal(null);
      await reloadAll();
    } catch (err) {
      if (onNotice) onNotice((err as Error).message || "Could not save category.");
    } finally {
      setSavingCategory(false);
    }
  }

  async function handleDeleteCategory(cat: CategoryRow) {
    if (!confirm(`Are you sure you want to delete "${cat.name}"?`)) return;
    try {
      await api(`/api/erp/product_categories?id=${cat.id}`, undefined, "DELETE");
      if (onNotice) onNotice(`Category "${cat.name}" deleted.`);
      await reloadAll();
      if (selectedSubCategory?.id === cat.id) setSelectedSubCategory(null);
      if (selectedMainCategory?.id === cat.id) setSelectedMainCategory(null);
    } catch (err) {
      if (onNotice) onNotice((err as Error).message || "Delete failed.");
    }
  }

  // -------------------------------------------------------------
  async function handleDeleteProduct(p: ProductRow) {
    if (!confirm(`Permanently delete saree "${p.name}"?`)) return;
    try {
      await api(`/api/admin/products?id=${p.id}`, undefined, "DELETE");
      if (onNotice) onNotice("Saree permanently deleted.");
      await reloadAll();
      if (selectedProduct?.id === p.id) setSelectedProduct(null);
    } catch (err) {
      if (onNotice) onNotice((err as Error).message || "Delete failed.");
    }
  }

  return (
    <div className="cat-hierarchy-root">
      {/* ------------------------------------------------------------- */}
      {/* PROFESSIONAL BREADCRUMBS AT EVERY LEVEL                       */}
      {/* ------------------------------------------------------------- */}
      <nav className="cat-hierarchy-breadcrumbs" aria-label="Hierarchy Breadcrumbs">
        <div className="cat-breadcrumb-trail">
          <button
            type="button"
            className={`cat-crumb-btn ${!selectedMainCategory ? "current" : ""}`}
            onClick={() => {
              setSelectedMainCategory(null);
              setSelectedSubCategory(null);
              setSelectedProduct(null);
            }}
          >
            Saree Catalogue
          </button>

          {selectedMainCategory && (
            <>
              <span className="cat-crumb-sep">›</span>
              <button
                type="button"
                className={`cat-crumb-btn ${!selectedSubCategory && !selectedProduct ? "current" : ""}`}
                onClick={() => {
                  setSelectedSubCategory(null);
                  setSelectedProduct(null);
                }}
              >
                {selectedMainCategory.name}
              </button>
            </>
          )}

          {selectedSubCategory && (
            <>
              <span className="cat-crumb-sep">›</span>
              <button
                type="button"
                className={`cat-crumb-btn ${!selectedProduct ? "current" : ""}`}
                onClick={() => {
                  setSelectedProduct(null);
                }}
              >
                {selectedSubCategory.name}
              </button>
            </>
          )}

          {selectedProduct && (
            <>
              <span className="cat-crumb-sep">›</span>
              <span className="cat-crumb-text current">{selectedProduct.name}</span>
              <span className="cat-crumb-sep">›</span>
              <span className="cat-crumb-pill">Colours &amp; Stock</span>
            </>
          )}
        </div>

        {/* Back Button */}
        {(selectedProduct || selectedSubCategory || selectedMainCategory) && (
          <button
            type="button"
            className="button outline-btn cat-back-level-btn"
            onClick={() => {
              if (selectedProduct) setSelectedProduct(null);
              else if (selectedSubCategory) setSelectedSubCategory(null);
              else if (selectedMainCategory) setSelectedMainCategory(null);
            }}
          >
            ← Back to {selectedProduct ? (selectedSubCategory?.name || selectedMainCategory?.name) : selectedSubCategory ? selectedMainCategory?.name : "All Categories"}
          </button>
        )}
      </nav>

      {/* ------------------------------------------------------------- */}
      {/* LEVEL 4: INDIVIDUAL PHYSICAL PIECES MANAGEMENT                */}
      {/* ------------------------------------------------------------- */}
      {selectedProduct ? (
        <section className="cat-level-section">
          <div className="cat-level-header">
            <div className="cat-level-header-info">
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                <img
                  src={selectedProduct.image_path || selectedProduct.colours?.find((c) => c.image_path)?.image_path || "/assets/brand-logo.png"}
                  alt={selectedProduct.name}
                  style={{ width: 56, height: 56, objectFit: "cover", borderRadius: 8, border: "1px solid #EAD5C0" }}
                />
                <div>
                  <span className="eyebrow" style={{ margin: 0 }}>COLOURS &amp; STOCK</span>
                  <h1 className="cat-level-title">{selectedProduct.name}</h1>
                  <p className="cat-level-desc">
                    Barcode: <strong>{selectedProduct.barcode || selectedProduct.sku}</strong> · Price: {money(selectedProduct.price_paise)}
                    {selectedProduct.fabric ? ` · ${selectedProduct.fabric}` : ""}
                  </p>
                </div>
              </div>
            </div>
            <div className="cat-level-actions">
              <button
                type="button"
                className="button outline-btn"
                onClick={() => {
                  setEditingProduct(selectedProduct as any);
                  setProductModalOpen(true);
                }}
              >
                Edit Saree Details / Move Category
              </button>
            </div>
          </div>
          <div className="ap-card" style={{ padding: 18 }}>
            <ColourStockEditor key={selectedProduct.id} productId={selectedProduct.id} notice={onNotice} onSaved={() => void reloadAll()} />
          </div>
        </section>
      ) : selectedSubCategory ? (
        /* ------------------------------------------------------------- */
        /* LEVEL 3: PRODUCTS UNDER SELECTED SUBCATEGORY                  */
        /* ------------------------------------------------------------- */
        <section className="cat-level-section">
          <div className="cat-level-header">
            <div>
              <span className="eyebrow" style={{ margin: 0 }}>
                LEVEL 3: PRODUCTS IN {selectedMainCategory?.name.toUpperCase()} › {selectedSubCategory.name.toUpperCase()}
              </span>
              <h1 className="cat-level-title">{selectedSubCategory.name} Saree Products</h1>
              <p className="cat-level-desc">
                {selectedSubCategory.description || `Browse and manage saree designs belonging to ${selectedSubCategory.name}.`}
              </p>
            </div>
            <div className="cat-level-actions">
              <button
                type="button"
                className="button gold-btn"
                onClick={() => {
                  setEditingProduct({
                    category: selectedMainCategory?.name,
                    subcategory_id: selectedSubCategory.id,
                  });
                  setProductModalOpen(true);
                }}
              >
                ＋ Add Saree Product
              </button>
              <button
                type="button"
                className="button outline-btn"
                onClick={() => {
                  setCategoryModal({
                    isOpen: true,
                    isSub: true,
                    parentId: selectedMainCategory?.id || null,
                    id: selectedSubCategory.id,
                    name: selectedSubCategory.name,
                    slug: selectedSubCategory.slug,
                    active: selectedSubCategory.active,
                    image_path: selectedSubCategory.image_path || "",
                    description: selectedSubCategory.description || "",
                  });
                }}
              >
                Edit Subcategory
              </button>
            </div>
          </div>

          <div className="cat-table-tools">
            <input
              type="search"
              placeholder={`Search products in ${selectedSubCategory.name}...`}
              value={productSearch}
              onChange={(e) => setProductSearch(e.target.value)}
              className="cat-search-input"
            />
          </div>

          {productsForSub.length === 0 ? (
            <div className="cat-empty-state">
              <p>No sarees found under {selectedSubCategory.name}.</p>
              <button
                type="button"
                className="button gold-btn"
                onClick={() => {
                  setEditingProduct({
                    category: selectedMainCategory?.name,
                    subcategory_id: selectedSubCategory.id,
                  });
                  setProductModalOpen(true);
                }}
              >
                ＋ Add First Saree to {selectedSubCategory.name}
              </button>
            </div>
          ) : (
            <div className="cat-table-wrap">
              <table className="cat-table">
                <thead>
                  <tr>
                    <th>Saree Product</th>
                    <th>SKU</th>
                    <th>Fabric &amp; Design</th>
                    <th>Base Colour</th>
                    <th>Price</th>
                    <th>Available Stock</th>
                    <th>Colours</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {productsForSub
                    .filter((p) => {
                      const q = productSearch.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        p.name.toLowerCase().includes(q) ||
                        p.sku.toLowerCase().includes(q) ||
                        (p.colour && p.colour.toLowerCase().includes(q))
                      );
                    })
                    .map((prod) => (
                      <tr key={prod.id}>
                        <td>
                          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
                            <img
                              src={prod.image_path || "/assets/brand-logo.png"}
                              alt={prod.name}
                              style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 6, border: "1px solid #EAD5C0" }}
                            />
                            <div>
                              <strong style={{ color: "#800020", display: "block" }}>{prod.name}</strong>
                              <small style={{ color: "#666" }}>{prod.saree_type || prod.category}</small>
                            </div>
                          </div>
                        </td>
                        <td>
                          <code>{prod.sku}</code>
                        </td>
                        <td>
                          <span>{prod.fabric || "Pure Silk"}</span>
                          <small style={{ display: "block", color: "#666" }}>{prod.design || "Zari Border"}</small>
                        </td>
                        <td>
                          <div style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                            <span
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: "50%",
                                backgroundColor: colourHex(prod.colour),
                              }}
                            />
                            <span>{prod.colour || "—"}</span>
                          </div>
                        </td>
                        <td>
                          <strong style={{ color: "#800020" }}>{money(prod.price_paise)}</strong>
                        </td>
                        <td>
                          <span
                            className="cat-status-pill"
                            style={{
                              background: prod.stock_on_hand > (prod.min_stock_level ?? 0) ? "#DCFCE7" : "#FEE2E2",
                              color: prod.stock_on_hand > (prod.min_stock_level ?? 0) ? "#166534" : "#991B1B",
                            }}
                          >
                            {prod.stock_on_hand > 0 ? `${prod.stock_on_hand} in stock` : "Out of stock"}
                          </span>
                          <span style={{ display: "block", fontSize: 11, color: "#666", marginTop: 2 }}>
                            Min stock: {prod.min_stock_level ?? 0}
                          </span>
                        </td>
                        <td>
                          <button
                            type="button"
                            className="button outline-btn cat-manage-pieces-btn"
                            onClick={() => setSelectedProduct(prod)}
                          >
                            Colours &amp; Stock →
                          </button>
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 8 }}>
                            <button
                              type="button"
                              className="text-link"
                              onClick={() => {
                                setEditingProduct(prod as any);
                                setProductModalOpen(true);
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="text-link"
                              style={{ color: "#B91C1C" }}
                              onClick={() => handleDeleteProduct(prod)}
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      ) : selectedMainCategory ? (
        /* ------------------------------------------------------------- */
        /* LEVEL 2: SUBCATEGORIES UNDER SELECTED MAIN CATEGORY           */
        /* ------------------------------------------------------------- */
        <section className="cat-level-section">
          <div className="cat-level-header">
            <div>
              <span className="eyebrow" style={{ margin: 0 }}>
                LEVEL 2: SUBCATEGORIES IN {selectedMainCategory.name.toUpperCase()}
              </span>
              <h1 className="cat-level-title">{selectedMainCategory.name} Subcategories</h1>
              <p className="cat-level-desc">
                {selectedMainCategory.description || `Select a subcategory to manage its saree designs, or add new subcategories.`}
              </p>
            </div>
            <div className="cat-level-actions">
              <button
                type="button"
                className="button gold-btn"
                onClick={() => {
                  setCategoryModal({
                    isOpen: true,
                    isSub: true,
                    parentId: selectedMainCategory.id,
                    id: null,
                    name: "",
                    slug: "",
                    active: true,
                    image_path: "",
                    description: "",
                  });
                }}
              >
                ＋ Add Sub Category
              </button>
              <button
                type="button"
                className="button outline-btn"
                onClick={() => {
                  setCategoryModal({
                    isOpen: true,
                    isSub: false,
                    parentId: null,
                    id: selectedMainCategory.id,
                    name: selectedMainCategory.name,
                    slug: selectedMainCategory.slug,
                    active: selectedMainCategory.active,
                    image_path: selectedMainCategory.image_path || "",
                    description: selectedMainCategory.description || "",
                  });
                }}
              >
                Edit {selectedMainCategory.name}
              </button>
            </div>
          </div>

          <div className="cat-table-tools">
            <input
              type="search"
              placeholder={`Search subcategories in ${selectedMainCategory.name}...`}
              value={subSearch}
              onChange={(e) => setSubSearch(e.target.value)}
              className="cat-search-input"
            />
          </div>

          {subCategoriesForMain.length === 0 ? (
            <div className="cat-empty-state">
              <p>No subcategories created for {selectedMainCategory.name} yet.</p>
              <button
                type="button"
                className="button gold-btn"
                onClick={() => {
                  setCategoryModal({
                    isOpen: true,
                    isSub: true,
                    parentId: selectedMainCategory.id,
                    id: null,
                    name: "",
                    slug: "",
                    active: true,
                    image_path: "",
                    description: "",
                  });
                }}
              >
                ＋ Add First Sub Category
              </button>
            </div>
          ) : (
            <div className="cat-grid">
              {subCategoriesForMain
                .filter((sub) => {
                  const q = subSearch.trim().toLowerCase();
                  if (!q) return true;
                  return sub.name.toLowerCase().includes(q) || sub.slug.toLowerCase().includes(q);
                })
                .map((sub) => {
                  const stats = subCatStats.get(sub.id) || { prodCount: 0, pieceCount: 0 };
                  const cover = stats.thumb || sub.image_path || selectedMainCategory.image_path || "/assets/brand-logo.png";
                  return (
                    <div key={sub.id} className="cat-card-item">
                      <div className="cat-card-thumb-wrap" onClick={() => setSelectedSubCategory(sub)}>
                        <img src={cover} alt={sub.name} className="cat-card-thumb" />
                        <div className="cat-card-overlay" />
                        <span className="cat-card-count-badge">
                          {stats.prodCount} {stats.prodCount === 1 ? "Product" : "Products"}
                        </span>
                      </div>
                      <div className="cat-card-content">
                        <h2 className="cat-card-title" onClick={() => setSelectedSubCategory(sub)}>
                          {sub.name}
                        </h2>
                        <p className="cat-card-desc">
                          {sub.description || `Pure authentic styles under ${sub.name}.`}
                        </p>
                        <div className="cat-card-meta-row">
                          <span className="cat-meta-stock">Total Pieces: {stats.pieceCount}</span>
                          <span className={`cat-active-pill ${sub.active ? "active" : "inactive"}`}>
                            {sub.active ? "Active" : "Disabled"}
                          </span>
                        </div>
                        <div className="cat-card-footer">
                          <button
                            type="button"
                            className="button gold-btn cat-enter-btn"
                            onClick={() => setSelectedSubCategory(sub)}
                          >
                            Explore Products →
                          </button>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              className="button outline-btn cat-action-btn"
                              onClick={() => {
                                setCategoryModal({
                                  isOpen: true,
                                  isSub: true,
                                  parentId: selectedMainCategory.id,
                                  id: sub.id,
                                  name: sub.name,
                                  slug: sub.slug,
                                  active: sub.active,
                                  image_path: sub.image_path || "",
                                  description: sub.description || "",
                                });
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="button outline-btn cat-action-btn"
                              style={{ color: "#B91C1C" }}
                              onClick={() => handleDeleteCategory(sub)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      ) : (
        /* ------------------------------------------------------------- */
        /* LEVEL 1: MAIN CATEGORIES VISUAL CARDS                         */
        /* ------------------------------------------------------------- */
        <section className="cat-level-section">
          <div className="cat-level-header">
            <div>
              <span className="eyebrow" style={{ margin: 0 }}>
                LEVEL 1: SAREE MAIN CATEGORIES
              </span>
              <h1 className="cat-level-title">Saree Catalogue Categories</h1>
              <p className="cat-level-desc">
                Select a main category to drill down into Sub Categories, Products, and Individual Pieces.
              </p>
            </div>
            <div className="cat-level-actions">
              <button
                type="button"
                className="button gold-btn"
                onClick={() => {
                  setCategoryModal({
                    isOpen: true,
                    isSub: false,
                    parentId: null,
                    id: null,
                    name: "",
                    slug: "",
                    active: true,
                    image_path: "",
                    description: "",
                  });
                }}
              >
                ＋ Add Main Category
              </button>
            </div>
          </div>

          <div className="cat-table-tools">
            <input
              type="search"
              placeholder="Search main categories..."
              value={mainSearch}
              onChange={(e) => setMainSearch(e.target.value)}
              className="cat-search-input"
            />
          </div>

          {loading ? (
            <div className="cat-loading-state">Loading saree categories...</div>
          ) : (
            <div className="cat-grid">
              {mainCategories
                .filter((m) => {
                  const q = mainSearch.trim().toLowerCase();
                  if (!q) return true;
                  return m.name.toLowerCase().includes(q) || m.slug.toLowerCase().includes(q);
                })
                .map((mainCat) => {
                  const stats = mainCatStats.get(mainCat.id) || { subCount: 0, prodCount: 0, pieceCount: 0 };
                  const cover = stats.thumb || mainCat.image_path || "/assets/brand-logo.png";
                  return (
                    <div key={mainCat.id} className="cat-card-item">
                      <div className="cat-card-thumb-wrap" onClick={() => setSelectedMainCategory(mainCat)}>
                        <img src={cover} alt={mainCat.name} className="cat-card-thumb" />
                        <div className="cat-card-overlay" />
                        <span className="cat-card-count-badge">
                          {stats.subCount} {stats.subCount === 1 ? "Subcategory" : "Subcategories"}
                        </span>
                      </div>
                      <div className="cat-card-content">
                        <h2 className="cat-card-title" onClick={() => setSelectedMainCategory(mainCat)}>
                          {mainCat.name}
                        </h2>
                        <p className="cat-card-desc">
                          {mainCat.description || `Exclusive pure silk sarees from the ${mainCat.name} collection.`}
                        </p>
                        <div className="cat-card-meta-row">
                          <span className="cat-meta-stock">
                            {stats.prodCount} Products · {stats.pieceCount} Pieces
                          </span>
                          <span className={`cat-active-pill ${mainCat.active ? "active" : "inactive"}`}>
                            {mainCat.active ? "Active" : "Disabled"}
                          </span>
                        </div>
                        <div className="cat-card-footer">
                          <button
                            type="button"
                            className="button gold-btn cat-enter-btn"
                            onClick={() => setSelectedMainCategory(mainCat)}
                          >
                            Explore Subcategories →
                          </button>
                          <div style={{ display: "flex", gap: 6 }}>
                            <button
                              type="button"
                              className="button outline-btn cat-action-btn"
                              onClick={() => {
                                setCategoryModal({
                                  isOpen: true,
                                  isSub: false,
                                  parentId: null,
                                  id: mainCat.id,
                                  name: mainCat.name,
                                  slug: mainCat.slug,
                                  active: mainCat.active,
                                  image_path: mainCat.image_path || "",
                                  description: mainCat.description || "",
                                });
                              }}
                            >
                              Edit
                            </button>
                            <button
                              type="button"
                              className="button outline-btn cat-action-btn"
                              style={{ color: "#B91C1C" }}
                              onClick={() => handleDeleteCategory(mainCat)}
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      )}

      {/* ------------------------------------------------------------- */}
      {/* CATEGORY ADD / EDIT MODAL                                     */}
      {/* ------------------------------------------------------------- */}
      {categoryModal && (
        <div className="cat-modal-backdrop" onClick={() => setCategoryModal(null)}>
          <div className="cat-modal-card" onClick={(e) => e.stopPropagation()}>
            <form onSubmit={handleSaveCategory}>
              <div className="cat-modal-header">
                <h2>{categoryModal.id ? "Edit Category" : categoryModal.isSub ? "Add Sub Category" : "Add Main Category"}</h2>
                <button type="button" className="cat-close-btn" onClick={() => setCategoryModal(null)}>✕</button>
              </div>

              <div className="cat-modal-body">
                <label className="ap-field">
                  <span className="ap-label">Name <em className="ap-req">*</em></span>
                  <input
                    type="text"
                    required
                    value={categoryModal.name}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCategoryModal((prev) => prev ? { ...prev, name: val, slug: makeSlug(val) } : prev);
                    }}
                    className="ap-input"
                    placeholder="e.g. Kanchipuram or Pure Zari"
                  />
                </label>

                <label className="ap-field">
                  <span className="ap-label">URL Slug</span>
                  <input
                    type="text"
                    required
                    value={categoryModal.slug}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCategoryModal((prev) => prev ? { ...prev, slug: makeSlug(val) } : prev);
                    }}
                    className="ap-input"
                  />
                </label>

                <label className="ap-field">
                  <span className="ap-label">Description</span>
                  <textarea
                    rows={3}
                    value={categoryModal.description}
                    onChange={(e) => {
                      const val = e.target.value;
                      setCategoryModal((prev) => prev ? { ...prev, description: val } : prev);
                    }}
                    className="ap-textarea"
                    placeholder="Short description of this saree collection..."
                  />
                </label>

                <div className="ap-field">
                  <span className="ap-label">Category Image</span>
                  <ImageUploader
                    kind="media"
                    currentImageUrl={categoryModal.image_path}
                    onUploadComplete={(img: string) =>
                      setCategoryModal((prev) => (prev ? { ...prev, image_path: img } : prev))
                    }
                    label="Upload Category Cover Image"
                  />
                </div>

                <label className="checkbox-item" style={{ marginTop: 10 }}>
                  <input
                    type="checkbox"
                    checked={categoryModal.active}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setCategoryModal((prev) => prev ? { ...prev, active: checked } : prev);
                    }}
                  />
                  <span>Active &amp; Visible in Store</span>
                </label>
              </div>

              <div className="cat-modal-footer">
                <button type="button" className="button outline-btn" onClick={() => setCategoryModal(null)}>
                  Cancel
                </button>
                <button type="submit" className="button gold-btn" disabled={savingCategory}>
                  {savingCategory ? "Saving..." : "Save Category"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}


      {/* ------------------------------------------------------------- */}
      {/* PRODUCT ADD / EDIT MODAL                                      */}
      {/* ------------------------------------------------------------- */}
      {productModalOpen && (
        <ProductModal
          product={editingProduct}
          categories={categories}
          onClose={() => setProductModalOpen(false)}
          onSaved={() => {
            setProductModalOpen(false);
            if (onNotice) onNotice("Saree saved successfully.");
            void reloadAll();
          }}
        />
      )}
    </div>
  );
}
