"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { compressImage, validateImageFile } from "@/lib/image-compress";
import { ColourStockEditor } from "./colour-stock-editor";

export type ProductFormData = {
  id?: string;
  name: string;
  sku: string;
  barcode: string | null;
  slug: string;
  category: string;
  subcategory_id: string | null;
  saree_type: string;
  fabric: string;
  colour: string;
  design: string;
  description: string;
  image_path: string;
  purchase_price_paise: number;
  price_paise: number;
  compare_at_price_paise: number;
  sale_unit?: string;
  discount_percent: number;
  stock_on_hand?: number;
  min_stock_level: number;
  published: boolean;
  featured: boolean;
  archived: boolean;
};

type CategoryOption = {
  id: string;
  parent_id?: string | null;
  name: string;
  slug?: string;
  active?: boolean;
  image_path?: string;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function uniqueSuffix(): string {
  return Math.random().toString(36).slice(2, 6);
}

export function ProductModal({
  product,
  categories = [],
  onClose,
  onSaved,
}: {
  product?: Partial<ProductFormData> | null;
  categories: CategoryOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  // After the first save of a new saree the screen switches to editing it (to set colours).
  const [savedId, setSavedId] = useState<string | null>(product?.id || null);
  useEffect(() => setSavedId(product?.id || null), [product?.id]);
  const isEditing = Boolean(savedId);

  const [internalCategories, setInternalCategories] = useState<CategoryOption[]>(
    categories && categories.length > 0 ? categories : [],
  );

  useEffect(() => {
    if (categories && categories.length > 0) {
      setInternalCategories(categories);
    } else {
      api<{ rows: CategoryOption[] }>("/api/erp/product_categories?page=0")
        .then((res) => {
          if (res?.rows?.length) setInternalCategories(res.rows);
        })
        .catch(() => { });
    }
  }, [categories]);

  const mainCategories = useMemo(
    () => internalCategories.filter((c) => !c.parent_id && c.active !== false),
    [internalCategories],
  );

  const initialCategory = useMemo(() => {
    if (product?.subcategory_id) {
      const sub = internalCategories.find((c) => c.id === product.subcategory_id);
      if (sub?.parent_id) {
        const parent = internalCategories.find((c) => c.id === sub.parent_id);
        if (parent) return parent.name;
      }
    }
    return product?.category || mainCategories[0]?.name || "Kanchipuram";
  }, [product, internalCategories, mainCategories]);

  const [productName, setProductName] = useState(
    product?.name || (product?.category ? `${product.category} Silk Saree` : ""),
  );
  const [description, setDescription] = useState(product?.description || "");
  const [category, setCategory] = useState(initialCategory);
  const [subcategoryId, setSubcategoryId] = useState<string>(product?.subcategory_id || "");
  const [newSubcategoryName, setNewSubcategoryName] = useState("");
  const [showNewSubcategoryInput, setShowNewSubcategoryInput] = useState(false);
  const [fabric, setFabric] = useState(product?.fabric || "");
  const [saleUnit, setSaleUnit] = useState(product?.sale_unit || "piece");
  const [design, setDesign] = useState(product?.design || "Traditional Zari Border");
  const [basePriceRupees, setBasePriceRupees] = useState(
    product?.price_paise ? String(product.price_paise / 100) : "",
  );
  const [purchasePriceRupees, setPurchasePriceRupees] = useState(
    product?.purchase_price_paise ? String(product.purchase_price_paise / 100) : "",
  );
  const [minStockLevel, setMinStockLevel] = useState<number | string>(
    product?.min_stock_level !== undefined ? product.min_stock_level : 0,
  );
  const [stockInput, setStockInput] = useState<number | string>(
    product?.stock_on_hand !== undefined ? product.stock_on_hand : 1,
  );
  const [published, setPublished] = useState(product?.published ?? true);
  const [featured, setFeatured] = useState(product?.featured ?? false);
  const [mainImage, setMainImage] = useState(product?.image_path || "");
  const [mainUploading, setMainUploading] = useState(false);

  // Sync state if product changes
  useEffect(() => {
    if (product) {
      if (product.name) setProductName(product.name);
      else if (product.category) setProductName(`${product.category} Silk Saree`);
      if (product.description !== undefined) setDescription(product.description);
      if (product.fabric) setFabric(product.fabric);
      setSaleUnit(product.sale_unit || "piece");
      if (product.design) setDesign(product.design);
      if (product.price_paise) setBasePriceRupees(String(product.price_paise / 100));
      if (product.purchase_price_paise) setPurchasePriceRupees(String(product.purchase_price_paise / 100));
      if (product.min_stock_level !== undefined) setMinStockLevel(product.min_stock_level);
      if (product.stock_on_hand !== undefined) setStockInput(product.stock_on_hand);
      if (product.published !== undefined) setPublished(product.published);
      if (product.featured !== undefined) setFeatured(product.featured);
      if (product.image_path) setMainImage(product.image_path);
      if (product.category) setCategory(product.category);
      if (product.subcategory_id) setSubcategoryId(product.subcategory_id);
    } else {
      setProductName("");
      setDescription("");
      setBasePriceRupees("");
      setPurchasePriceRupees("");
      setMinStockLevel(0);
      setStockInput(1);
      setMainImage("");
      if (mainCategories[0]?.name) setCategory(mainCategories[0].name);
      setSubcategoryId("");
    }
  }, [product, mainCategories]);

  // Sync category if product arrives late
  useEffect(() => {
    if (!category && initialCategory) {
      setCategory(initialCategory);
    }
  }, [initialCategory, category]);

  // Selected Main Category Object with resilient fallback & slug matching
  const selectedMainObj = useMemo(() => {
    const catClean = (category || "").trim().toLowerCase();
    const catSlug = catClean.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    return (
      mainCategories.find(
        (m) =>
          m.name.toLowerCase() === catClean ||
          (m.slug && m.slug.toLowerCase() === catClean) ||
          (m.slug && m.slug.toLowerCase() === catSlug) ||
          m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") === catSlug,
      ) ||
      mainCategories[0] ||
      null
    );
  }, [mainCategories, category]);

  // Subcategories strictly belonging to the selected main category
  const existingSubcategories = useMemo(() => {
    if (!selectedMainObj) return [];
    return internalCategories.filter(
      (c) =>
        c.parent_id === selectedMainObj.id &&
        c.active !== false &&
        c.name.toLowerCase() !== "all styles",
    );
  }, [internalCategories, selectedMainObj]);

  // Automatically select the first subcategory if none selected
  useEffect(() => {
    if (existingSubcategories.length > 0 && !subcategoryId) {
      setSubcategoryId(existingSubcategories[0].id);
    }
  }, [existingSubcategories, subcategoryId]);

  const [barcode, setBarcode] = useState(product?.barcode || "");
  const [compareRupees, setCompareRupees] = useState(
    product?.compare_at_price_paise ? String(product.compare_at_price_paise / 100) : "",
  );
  const [notice, setNotice] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const mainFileRef = useRef<HTMLInputElement>(null);

  async function compressAndUpload(file: File): Promise<string> {
    const validation = validateImageFile(file);
    if (!validation.valid) {
      throw new Error("Please choose a valid JPG, PNG, or WebP image.");
    }
    const compressed = await compressImage(file, {
      maxSizeKB: 60,
      minSizeKB: 1,
      maxWidth: 1200,
      maxHeight: 1200,
      preferFormat: "image/webp",
    });
    const formData = new FormData();
    formData.append("kind", "product");
    formData.append("file", compressed.file);
    const res = await fetch("/api/uploads", {
      method: "POST",
      body: formData,
    });
    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.message || data.error || "Image upload failed.");
    }
    return String(data.url);
  }

  async function handleMainImageSelected(file: File) {
    setError("");
    setMainUploading(true);
    try {
      const url = await compressAndUpload(file);
      setMainImage(url);
    } catch (err) {
      setError((err as Error).message || "Unable to upload image.");
    } finally {
      setMainUploading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    let trimmedName = productName.trim();
    if (!trimmedName) {
      trimmedName = `${selectedMainObj?.name || category || "Kanchipuram"} Silk Saree`;
      setProductName(trimmedName);
    }

    const finalCatName = selectedMainObj?.name || category || "Kanchipuram";

    // Determine final subcategory ID
    let finalSubcategoryId = subcategoryId;
    if (showNewSubcategoryInput && newSubcategoryName.trim()) {
      try {
        const newSubSlug = slugify(`${finalCatName}-${newSubcategoryName.trim()}`);
        const res = await api<{ id: string }>("/api/erp/product_categories", {
          id: null,
          data: {
            parent_id: selectedMainObj?.id,
            name: newSubcategoryName.trim().slice(0, 80),
            slug: newSubSlug,
            active: true,
          },
        });
        if (res?.id) {
          finalSubcategoryId = res.id;
        }
      } catch (subErr) {
        setError(`Could not create subcategory: ${(subErr as Error).message}`);
        return;
      }
    }

    // If still no subcategory, check if there is an "All styles" subcategory or use first
    if (!finalSubcategoryId && selectedMainObj?.id) {
      const defaultSub = internalCategories.find(
        (c) => c.parent_id === selectedMainObj.id && c.name.toLowerCase() === "all styles",
      );
      if (defaultSub) finalSubcategoryId = defaultSub.id;
      else if (existingSubcategories.length > 0) finalSubcategoryId = existingSubcategories[0].id;
    }

    // Ensure valid UUID or null for subcategory_id so database constraint/zod is always satisfied
    const validSubId =
      finalSubcategoryId &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(finalSubcategoryId))
        ? String(finalSubcategoryId)
        : null;

    const basePriceNum = Number(String(basePriceRupees || "").replace(/,/g, ""));
    if (!basePriceNum || isNaN(basePriceNum) || basePriceNum <= 0) {
      setError("Selling Price (₹) is required and must be greater than ₹0.");
      return;
    }
    const pricePaise = Math.round(basePriceNum * 100);
    const purchasePriceNum = purchasePriceRupees ? Number(String(purchasePriceRupees).replace(/,/g, "")) : 0;
    if (isNaN(purchasePriceNum) || purchasePriceNum < 0) {
      setError("Purchase Cost (₹) cannot be negative.");
      return;
    }
    const compareNum = compareRupees ? Number(String(compareRupees).replace(/,/g, "")) : 0;
    const finalMinStock = Math.max(0, parseInt(String(minStockLevel || 0), 10) || 0);
    const startPieces = Math.max(0, parseInt(String(stockInput || 0), 10) || 0);
    const code = barcode.trim();
    if (code && !/^[ -~]{1,48}$/.test(code)) {
      setError("Barcode can use letters, numbers and symbols only (max 48).");
      return;
    }

    setSaving(true);
    try {
      const catPrefix = slugify(finalCatName).slice(0, 4).toUpperCase() || "SAR";
      const rawSlug = product?.slug || `${slugify(trimmedName) || "saree"}-${uniqueSuffix()}`;
      const baseSlug = slugify(rawSlug).slice(0, 118).replace(/-+$/, "");
      const sku =
        product?.sku ||
        `MS-${catPrefix}-${slugify(trimmedName).slice(0, 5).toUpperCase()}-${uniqueSuffix().toUpperCase()}`;

      const saved = await api<{ id: string }>("/api/admin/products", {
        id: savedId,
        data: {
          name: trimmedName,
          sku,
          // One barcode per individual saree (all its colours share it). Defaults to the SKU.
          barcode: code || sku,
          slug: baseSlug,
          category: finalCatName,
          subcategory_id: validSubId,
          saree_type: product?.saree_type || finalCatName,
          fabric: fabric.trim(),
          design: design.trim(),
          description: description.trim(),
          image_path: mainImage.trim(),
          purchase_price_paise: Math.round(purchasePriceNum * 100),
          price_paise: pricePaise,
          compare_at_price_paise: Math.round((compareNum || 0) * 100),
          ...(saleUnit !== "piece" || (product?.sale_unit && product.sale_unit !== "piece") ? { sale_unit: saleUnit } : {}),
          discount_percent: product?.discount_percent || 0,
          min_stock_level: finalMinStock,
          published: Boolean(published),
          featured: Boolean(featured),
          archived: false,
        },
      });
      const id = saved?.id || savedId;
      if (!id) throw new Error("Saree saved, but no ID was returned.");
      if (!savedId) {
        // New saree: record its pieces (colour undefined until set below), then stay open for colours.
        if (startPieces > 0) {
          await api("/api/admin/colours", { product_id: id, rows: [], total: startPieces, reason: "Opening stock (new saree)" });
        }
        setBarcode(code || sku);
        setSavedId(id);
        setNotice("Saree saved. Now split its pieces by colour and add a photo per colour to show it on the website.");
        return;
      }
      onSaved();
    } catch (err) {
      setError((err as Error).message || "Failed to save saree.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="ap-page-root" onSubmit={handleSave} noValidate>
      <input
        ref={mainFileRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleMainImageSelected(file);
        }}
      />

      {/* Top Header Bar */}
      <div className="ap-header-bar">
        <div>
          <h1 className="ap-title">{isEditing ? "Edit Saree" : "Add Saree"}</h1>
          <p className="ap-subtitle">
            Main Category → Sub Category → Saree (one barcode, one price) → Colours
          </p>
        </div>

        <div className="ap-header-actions">
          <button
            type="button"
            className="button outline-btn ap-cancel-btn"
            disabled={saving}
            onClick={() => (savedId && !product?.id ? onSaved() : onClose())}
          >
            Cancel
          </button>
            <button
              type="submit"
              className="button ap-save-btn"
              disabled={saving || mainUploading}
            >
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
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span>{saving ? "Saving Saree..." : isEditing ? "Save & Close" : "Save & Set Colours"}</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="ap-error-banner" role="alert">
          <span>⚠️ {error}</span>
        </div>
      )}

      <>
      {/* 2-Column Form Layout */}
      <div className="ap-columns-grid">
        {/* LEFT COLUMN: Main Cover Photo */}
        <section className="ap-card ap-photo-card">
          <h2 className="ap-photo-heading">Saree Cover Photo</h2>
          <div className="ap-photo-preview-wrap">
            {mainImage ? (
              <img
                src={mainImage}
                alt={productName || "Saree cover"}
                className="ap-photo-preview-img"
              />
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  height: "100%",
                  minHeight: 220,
                  color: "#800020",
                  background: "#FBF7F0",
                  gap: 10,
                  cursor: "pointer",
                }}
                onClick={() => mainFileRef.current?.click()}
              >
                <span style={{ fontSize: 32, opacity: 0.6 }}>📷</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#800020" }}>
                  Upload Saree Photo
                </span>
                <span style={{ fontSize: 11, color: "#666" }}>
                  PNG, JPG or WEBP
                </span>
              </div>
            )}
            {mainUploading && (
              <div className="ap-photo-loading" role="status">
                <span className="spinner-gold" />
                <span>Optimizing Image...</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="ap-change-img-btn"
            disabled={mainUploading}
            onClick={() => mainFileRef.current?.click()}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z" />
              <circle cx="12" cy="13" r="3" />
            </svg>
            <span>{mainUploading ? "Optimizing Image..." : "Change Image"}</span>
          </button>
        </section>

        {/* RIGHT COLUMN: Hierarchy, Details & Physical Pieces */}
        <div className="ap-right-col">
          {/* Card 1: Product Name, Main Category & Subcategory */}
          <section className="ap-card ap-details-card">
            <label className="ap-field">
              <span className="ap-label">
                Product Name <em className="ap-req">*</em>
              </span>
              <input
                type="text"
                required
                placeholder="e.g. Kanchipuram Purple Gold Zari Saree"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                className="ap-input"
              />
            </label>

            {/* LEVEL 1 & LEVEL 2: DYNAMIC CATEGORY HIERARCHY */}
            <div className="ap-category-flags-row" style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {/* Level 1: Main Category */}
              <label className="ap-field" style={{ flex: "1 1 200px" }}>
                <span className="ap-label">
                  1. Main Category <em className="ap-req">*</em>
                </span>
                <select
                  value={category}
                  required
                  onChange={(e) => {
                    setCategory(e.target.value);
                    setSubcategoryId("");
                    setShowNewSubcategoryInput(false);
                  }}
                  className="ap-select"
                >
                  <option value="" disabled>-- Select Main Category --</option>
                  {mainCategories.map((m) => (
                    <option key={m.id} value={m.name}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>

              {/* Level 2: Sub Category */}
              <label className="ap-field" style={{ flex: "1 1 200px" }}>
                <span className="ap-label">
                  2. Sub Category <em className="ap-req">*</em>
                </span>
                <select
                  value={showNewSubcategoryInput ? "__new__" : subcategoryId}
                  required={!showNewSubcategoryInput}
                  onChange={(e) => {
                    if (e.target.value === "__new__") {
                      setShowNewSubcategoryInput(true);
                    } else {
                      setShowNewSubcategoryInput(false);
                      setSubcategoryId(e.target.value);
                    }
                  }}
                  className="ap-select"
                >
                  <option value="" disabled>-- Select {category} Subcategory --</option>
                  {existingSubcategories.map((sub) => (
                    <option key={sub.id} value={sub.id}>
                      {sub.name}
                    </option>
                  ))}
                  <option value="__new__">＋ Add New Subcategory...</option>
                </select>
              </label>

              <div className="ap-flags-group" style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={published}
                    onChange={(e) => setPublished(e.target.checked)}
                  />
                  <span>Published</span>
                </label>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={featured}
                    onChange={(e) => setFeatured(e.target.checked)}
                  />
                  <span>Featured</span>
                </label>
              </div>
            </div>

            {/* Inline New Subcategory Input if requested */}
            {showNewSubcategoryInput && (
              <div
                style={{
                  background: "#FBF7F0",
                  padding: "10px 14px",
                  borderRadius: 6,
                  border: "1px dashed #C49A52",
                  marginTop: 6,
                }}
              >
                <label className="ap-field" style={{ margin: 0 }}>
                  <span className="ap-label" style={{ color: "#800020" }}>
                    New Subcategory for {category}:
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input
                      type="text"
                      placeholder="e.g. Pure Zari, Korvai, Bridal Kanchipuram..."
                      value={newSubcategoryName}
                      onChange={(e) => setNewSubcategoryName(e.target.value)}
                      className="ap-input"
                    />
                    <button
                      type="button"
                      className="button outline-btn"
                      onClick={() => setShowNewSubcategoryInput(false)}
                      style={{ padding: "4px 10px", fontSize: 12 }}
                    >
                      Cancel
                    </button>
                  </div>
                </label>
              </div>
            )}

            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
              <label className="ap-field" style={{ flex: "1 1 140px" }}>
                <span className="ap-label">Sold per</span>
                <select value={saleUnit} onChange={(e) => setSaleUnit(e.target.value)} className="ap-input">
                  {["piece", "set", "pair", "metre", "pack", "dozen", "box"].map((u) => (
                    <option key={u} value={u}>{u[0].toUpperCase() + u.slice(1)}</option>
                  ))}
                </select>
              </label>
              <label className="ap-field" style={{ flex: "1 1 180px" }}>
                <span className="ap-label">Fabric</span>
                <input
                  type="text"
                  placeholder="e.g. Pure Mulberry Silk"
                  value={fabric}
                  onChange={(e) => setFabric(e.target.value)}
                  className="ap-input"
                />
              </label>

              <label className="ap-field" style={{ flex: "1 1 180px" }}>
                <span className="ap-label">Design / Weave</span>
                <input
                  type="text"
                  placeholder="e.g. Traditional Zari Border"
                  value={design}
                  onChange={(e) => setDesign(e.target.value)}
                  className="ap-input"
                />
              </label>
            </div>

            <label className="ap-field" style={{ marginTop: 10 }}>
              <span className="ap-label">Description</span>
              <textarea
                rows={2}
                placeholder="Traditional Kanchipuram silk saree with rich zari work and elegant border."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="ap-textarea"
              />
            </label>
          </section>

          {/* Card 2: price, barcode and pieces (one barcode + one price per individual saree) */}
          <section className="ap-card">
            <h2 className="ap-variants-title">Price, barcode &amp; pieces</h2>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
              <label className="ap-field" style={{ flex: "1 1 150px" }}>
                <span className="ap-label">Selling Price (₹) <em className="ap-req">*</em></span>
                <input type="number" min="0" className="ap-input" value={basePriceRupees} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setBasePriceRupees(e.target.value)} />
              </label>
              <label className="ap-field" style={{ flex: "1 1 150px" }}>
                <span className="ap-label">Purchase Cost (₹)</span>
                <input type="number" min="0" className="ap-input" value={purchasePriceRupees} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setPurchasePriceRupees(e.target.value)} />
              </label>
              <label className="ap-field" style={{ flex: "1 1 150px" }}>
                <span className="ap-label">MRP / Compare-at (₹)</span>
                <input type="number" min="0" className="ap-input" value={compareRupees} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setCompareRupees(e.target.value)} />
              </label>
            </div>
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
              <label className="ap-field" style={{ flex: "2 1 220px" }}>
                <span className="ap-label">Barcode (one for all colours of this saree)</span>
                <input type="text" className="ap-input" placeholder="Leave blank to use the SKU" value={barcode} maxLength={48} onChange={(e) => setBarcode(e.target.value)} />
              </label>
              {!isEditing && (
                <label className="ap-field" style={{ flex: "1 1 140px" }}>
                  <span className="ap-label">Pieces received</span>
                  <input type="number" min="0" className="ap-input" value={stockInput} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setStockInput(e.target.value)} />
                </label>
              )}
              <label className="ap-field" style={{ flex: "1 1 140px" }}>
                <span className="ap-label">Low-stock alert at</span>
                <input type="number" min="0" className="ap-input" value={minStockLevel} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setMinStockLevel(e.target.value)} />
              </label>
            </div>
            {product?.sku && <p className="cs-help" style={{ marginTop: 8 }}>SKU: <code>{product.sku}</code></p>}
          </section>

          {/* Card 3: colour split */}
          <section className="ap-card ap-variants-card">
            <div className="ap-variants-header">
              <div>
                <h2 className="ap-variants-title">Colours &amp; stock</h2>
                <p className="ap-variants-subtitle">
                  Example: 10 pieces = 3 Green + 5 Red + 2 Violet. Unknown colours stay undefined (POS only) until you set them.
                </p>
              </div>
            </div>
            {notice && <div className="cs-help" style={{ background: "#ECFDF5", color: "#065F46", padding: 10, borderRadius: 8, marginBottom: 10 }}>{notice}</div>}
            {savedId ? (
              <ColourStockEditor productId={savedId} notice={setNotice} />
            ) : (
              <p className="cs-help">Save the saree first; then split its pieces by colour and add a photo for each colour here.</p>
            )}
          </section>
        </div>
      </div>

      {/* Sticky Bottom Actions Bar - Ensures Save & Cancel are always accessible */}
      <div className="ap-sticky-footer-bar">
        <div className="ap-sticky-footer-info">
          {error ? (
            <div className="ap-footer-error" role="alert">
              <span className="ap-footer-error-icon">⚠️</span>
              <span>{error}</span>
            </div>
          ) : (
            <div className="ap-footer-stats">
              {basePriceRupees && Number(basePriceRupees) > 0 && (
                <span className="cat-count-pill" style={{ background: "#FEF3C7", color: "#92400E" }}>
                  Selling Price: ₹{basePriceRupees}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="ap-header-actions">
          <button
            type="button"
            className="button outline-btn ap-cancel-btn"
            disabled={saving}
            onClick={() => (savedId && !product?.id ? onSaved() : onClose())}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button ap-save-btn"
            disabled={saving || mainUploading}
          >
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
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span>{saving ? "Saving Saree..." : isEditing ? "Save & Close" : "Save & Set Colours"}</span>
          </button>
        </div>
      </div>
      </>
    </form>
  );
}
