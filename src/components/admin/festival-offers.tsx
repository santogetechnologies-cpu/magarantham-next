// src/components/admin/festival-offers.tsx
// Magarantham Silks: Luxury Festival Offers & Dynamic Target Management UI

"use client";

import React, { useState, useEffect, useMemo } from "react";
import { api } from "../api";
import { money } from "@/lib/core";
import { EnhancedOffer, OfferTargetRecord, OfferTargetType } from "@/lib/offers";

type CategoryItem = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  active: boolean;
};

type ProductItem = {
  id: string;
  name: string;
  sku: string;
  category: string;
  subcategory_id?: string | null;
  image_path: string;
  price_paise: number;
};

export function FestivalOffersManager({
  onRefresh,
}: {
  onRefresh?: () => void;
}) {
  const [offers, setOffers] = useState<EnhancedOffer[]>([]);
  const [loading, setLoading] = useState(true);
  const [categories, setCategories] = useState<CategoryItem[]>([]);
  const [products, setProducts] = useState<ProductItem[]>([]);

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "scheduled" | "expired">("all");
  const [targetFilter, setTargetFilter] = useState<"all" | OfferTargetType>("all");

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingOffer, setEditingOffer] = useState<EnhancedOffer | null>(null);
  const [saving, setSaving] = useState(false);
  const [modalError, setModalError] = useState("");

  // Delete State
  const [deletingOffer, setDeletingOffer] = useState<EnhancedOffer | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Form State
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [code, setCode] = useState("");
  const [kind, setKind] = useState<"percent" | "fixed">("percent");
  const [discountValue, setDiscountValue] = useState<number | string>(15);
  const [minPurchaseRupees, setMinPurchaseRupees] = useState<number | string>(0);
  const [maxDiscountRupees, setMaxDiscountRupees] = useState<number | string>("");
  const [maxUses, setMaxUses] = useState<number | string>("");
  const [perCustomerLimit, setPerCustomerLimit] = useState<number | string>(1);
  const [active, setActive] = useState(true);
  const [priority, setPriority] = useState<number | string>(10);
  const [applyInPos, setApplyInPos] = useState(false);
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  // Target State
  const [targetType, setTargetType] = useState<OfferTargetType>("category");
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [selectedSubcategoryParentId, setSelectedSubcategoryParentId] = useState<string>("");
  const [selectedSubcategoryIds, setSelectedSubcategoryIds] = useState<string[]>([]);
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [productSearch, setProductSearch] = useState("");

  // Load Offers, Categories & Products
  async function loadData() {
    setLoading(true);
    try {
      const [offersRes, catsRes, prodsRes] = await Promise.all([
        api<{ rows: EnhancedOffer[] }>("/api/admin/offers?page=0"),
        api<{ rows: CategoryItem[] }>("/api/erp/product_categories?page=0"),
        api<{ rows: ProductItem[] }>("/api/admin/products?page=0&include_archived=false"),
      ]);

      if (offersRes?.rows) setOffers(offersRes.rows);
      if (catsRes?.rows) setCategories(catsRes.rows);
      if (prodsRes?.rows) setProducts(prodsRes.rows);
    } catch (e) {
      console.error("Failed to load offers data:", e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const mainCategories = useMemo(
    () => categories.filter((c) => !c.parent_id && c.active !== false),
    [categories],
  );

  const subcategoriesForParent = useMemo(() => {
    if (!selectedSubcategoryParentId) return [];
    return categories.filter(
      (c) =>
        c.parent_id === selectedSubcategoryParentId &&
        c.active !== false &&
        c.name.toLowerCase() !== "all styles",
    );
  }, [categories, selectedSubcategoryParentId]);

  // Set default parent for subcategories when opening form
  useEffect(() => {
    if (mainCategories.length > 0 && !selectedSubcategoryParentId) {
      setSelectedSubcategoryParentId(mainCategories[0].id);
    }
  }, [mainCategories, selectedSubcategoryParentId]);

  // Filtered Products for Picker
  const filteredProductsForPicker = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return products.slice(0, 50);
    return products
      .filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q),
      )
      .slice(0, 50);
  }, [products, productSearch]);

  // Dashboard Stats
  const stats = useMemo(() => {
    const now = Date.now();
    let total = offers.length;
    let activeCount = 0;
    let scheduledCount = 0;
    let expiredCount = 0;
    let totalUses = 0;

    for (const o of offers) {
      totalUses += o.used_count || 0;
      const start = o.starts_at ? new Date(o.starts_at).getTime() : null;
      const end = o.ends_at ? new Date(o.ends_at).getTime() : null;

      if (!o.active) {
        // Inactive
      } else if (start && start > now) {
        scheduledCount++;
      } else if (end && end <= now) {
        expiredCount++;
      } else {
        activeCount++;
      }
    }

    return { total, activeCount, scheduledCount, expiredCount, totalUses };
  }, [offers]);

  // Open Create Modal
  function handleOpenCreate() {
    setEditingOffer(null);
    setTitle("");
    setDescription("");
    setCode("");
    setKind("percent");
    setDiscountValue(15);
    setMinPurchaseRupees(0);
    setMaxDiscountRupees("");
    setMaxUses("");
    setPerCustomerLimit(1);
    setActive(true);
    setPriority(10);
    setApplyInPos(false);
    setStartsAt("");
    setEndsAt("");
    setTargetType("category");
    setSelectedCategoryIds(mainCategories[0] ? [mainCategories[0].id] : []);
    setSelectedSubcategoryParentId(mainCategories[0]?.id || "");
    setSelectedSubcategoryIds([]);
    setSelectedProductIds([]);
    setModalError("");
    setModalOpen(true);
  }

  // Open Edit Modal
  function handleOpenEdit(offer: EnhancedOffer) {
    setEditingOffer(offer);
    setTitle(offer.title);
    setDescription(offer.description || "");
    setCode(offer.code || "");
    setKind(offer.kind);
    setDiscountValue(
      offer.kind === "percent"
        ? offer.value
        : Math.round(offer.value / 100),
    );
    setMinPurchaseRupees(offer.min_subtotal_paise ? Math.round(offer.min_subtotal_paise / 100) : 0);
    setMaxDiscountRupees(
      offer.max_discount_paise ? Math.round(offer.max_discount_paise / 100) : "",
    );
    setMaxUses(offer.max_uses ?? "");
    setPerCustomerLimit(offer.per_customer_limit || 1);
    setActive(offer.active);
    setPriority(offer.priority || 0);
    setApplyInPos(offer.apply_in_pos === true);

    // Format local datetime strings for input
    setStartsAt(
      offer.starts_at
        ? new Date(offer.starts_at).toISOString().slice(0, 16)
        : "",
    );
    setEndsAt(
      offer.ends_at
        ? new Date(offer.ends_at).toISOString().slice(0, 16)
        : "",
    );

    setTargetType(offer.target_type || "all");

    // Populate targets
    const targets = offer.targets || [];
    const catIds = targets
      .filter((t) => t.target_type === "category" && t.category_id)
      .map((t) => t.category_id!);
    const subIds = targets
      .filter((t) => t.target_type === "subcategory" && t.subcategory_id)
      .map((t) => t.subcategory_id!);
    const prodIds = targets
      .filter((t) => t.target_type === "product" && t.product_id)
      .map((t) => t.product_id!);

    setSelectedCategoryIds(catIds);
    setSelectedSubcategoryIds(subIds);
    setSelectedProductIds(prodIds);

    // Detect parent for subcategories if selected
    if (subIds.length > 0) {
      const firstSub = categories.find((c) => c.id === subIds[0]);
      if (firstSub?.parent_id) {
        setSelectedSubcategoryParentId(firstSub.parent_id);
      }
    }

    setModalError("");
    setModalOpen(true);
  }

  // Save Offer
  async function handleSaveOffer(e: React.FormEvent) {
    e.preventDefault();
    setModalError("");

    if (!title.trim()) {
      setModalError("Offer title is required.");
      return;
    }

    const valNum = Number(discountValue);
    if (isNaN(valNum) || valNum <= 0) {
      setModalError("Please enter a valid discount value greater than 0.");
      return;
    }
    if (kind === "percent" && valNum > 90) {
      setModalError("Percentage discount cannot exceed 90%.");
      return;
    }

    // Validation for targets
    const targetsToSave: OfferTargetRecord[] = [];
    if (targetType === "category") {
      if (selectedCategoryIds.length === 0) {
        setModalError("Please select at least one main category for the offer.");
        return;
      }
      for (const cid of selectedCategoryIds) {
        targetsToSave.push({
          offer_id: editingOffer?.id || "",
          target_type: "category",
          category_id: cid,
        });
      }
    } else if (targetType === "subcategory") {
      if (selectedSubcategoryIds.length === 0) {
        setModalError("Please select at least one subcategory for the offer.");
        return;
      }
      for (const sid of selectedSubcategoryIds) {
        targetsToSave.push({
          offer_id: editingOffer?.id || "",
          target_type: "subcategory",
          subcategory_id: sid,
        });
      }
    } else if (targetType === "product") {
      if (selectedProductIds.length === 0) {
        setModalError("Please select at least one product for the offer.");
        return;
      }
      for (const pid of selectedProductIds) {
        targetsToSave.push({
          offer_id: editingOffer?.id || "",
          target_type: "product",
          product_id: pid,
        });
      }
    }

    const minSubtotalPaise = Math.round(Number(minPurchaseRupees || 0) * 100);
    const maxDiscountPaise = maxDiscountRupees ? Math.round(Number(maxDiscountRupees) * 100) : null;
    const finalValue = kind === "percent" ? valNum : Math.round(valNum * 100);

    setSaving(true);
    try {
      await api("/api/admin/offers", {
        id: editingOffer?.id || null,
        data: {
          title: title.trim(),
          description: description.trim(),
          code: code.trim() ? code.trim().toUpperCase() : null,
          kind,
          value: finalValue,
          min_subtotal_paise: minSubtotalPaise,
          max_discount_paise: maxDiscountPaise,
          max_uses: maxUses ? Number(maxUses) : null,
          per_customer_limit: Number(perCustomerLimit || 1),
          active,
          starts_at: startsAt ? new Date(startsAt).toISOString() : null,
          ends_at: endsAt ? new Date(endsAt).toISOString() : null,
          target_type: targetType,
          priority: Number(priority || 0),
          apply_in_pos: !code.trim() && applyInPos,
        },
        targets: targetsToSave,
      });

      setModalOpen(false);
      await loadData();
      if (onRefresh) onRefresh();
    } catch (err) {
      setModalError((err as Error).message || "Failed to save offer.");
    } finally {
      setSaving(false);
    }
  }

  // Toggle Active directly from table
  async function handleToggleActive(offer: EnhancedOffer) {
    try {
      await api("/api/admin/offers", {
        id: offer.id,
        data: {
          ...offer,
          active: !offer.active,
        },
        targets: offer.targets || [],
      });
      await loadData();
      if (onRefresh) onRefresh();
    } catch (e) {
      alert(`Could not toggle status: ${(e as Error).message}`);
    }
  }

  // Confirm Delete
  async function handleDeleteConfirm() {
    if (!deletingOffer) return;
    setDeleting(true);
    try {
      await api(`/api/admin/offers?id=${deletingOffer.id}`, undefined, "DELETE");
      setDeletingOffer(null);
      await loadData();
      if (onRefresh) onRefresh();
    } catch (e) {
      alert(`Delete failed: ${(e as Error).message}`);
    } finally {
      setDeleting(false);
    }
  }

  // Filtered Offer List
  const filteredOffers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const now = Date.now();

    return offers.filter((o) => {
      // Search
      if (q) {
        const matchesTitle = o.title.toLowerCase().includes(q);
        const matchesCode = o.code ? o.code.toLowerCase().includes(q) : false;
        if (!matchesTitle && !matchesCode) return false;
      }

      // Target filter
      if (targetFilter !== "all" && o.target_type !== targetFilter) {
        return false;
      }

      // Status filter
      if (statusFilter !== "all") {
        const start = o.starts_at ? new Date(o.starts_at).getTime() : null;
        const end = o.ends_at ? new Date(o.ends_at).getTime() : null;

        if (statusFilter === "active") {
          if (!o.active) return false;
          if (start && start > now) return false;
          if (end && end <= now) return false;
        } else if (statusFilter === "scheduled") {
          if (!o.active || !start || start <= now) return false;
        } else if (statusFilter === "expired") {
          if (!end || end > now) return false;
        }
      }

      return true;
    });
  }, [offers, searchQuery, statusFilter, targetFilter]);

  // Live Preview Calculation
  const previewSamplePrice = 5000;
  const previewDiscountAmount =
    kind === "percent"
      ? Math.round((previewSamplePrice * Number(discountValue || 0)) / 100)
      : Number(discountValue || 0);
  const previewCappedDiscount = maxDiscountRupees
    ? Math.min(previewDiscountAmount, Number(maxDiscountRupees))
    : previewDiscountAmount;
  const previewEffectivePrice = Math.max(0, previewSamplePrice - previewCappedDiscount);

  return (
    <div className="cat-hierarchy-root">
      <div className="ms-callout" style={{ marginBottom: 18 }}>
        <span className="ms-callout-icon" aria-hidden="true">i</span>
        <div>
          <strong>Choose where each offer works.</strong> Offers are taken off online checkout for the categories,
          subcategories or sarees you target. Turn on <em>Apply in POS billing too</em> in an offer to also take it off
          shop bills; you can switch it on or off any time by editing the offer. Coupon-code offers stay online only. When
          several offers match, the customer gets the biggest one.
        </div>
      </div>
      {/* ------------------------------------------------------------- */}
      {/* HEADER & ACTIONS                                              */}
      {/* ------------------------------------------------------------- */}
      <div className="cat-level-header" style={{ marginBottom: 20 }}>
        <div>
          <span className="eyebrow" style={{ color: "#C49A52", fontWeight: 700 }}>
            OFFERS &amp; PROMOTIONS ENGINE
          </span>
          <h1 className="cat-level-title" style={{ color: "#800020", margin: "4px 0" }}>
            Festival Offers &amp; Discounts
          </h1>
          <p className="cat-level-desc">
            Create high-converting Category, Subcategory, and Product-specific promotional offers with automatic customer discounts.
          </p>
        </div>
        <div className="cat-level-actions">
          <button
            type="button"
            className="button gold-btn"
            onClick={handleOpenCreate}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "10px 20px",
              fontWeight: 700,
              fontSize: 14,
            }}
          >
            <span>✨</span>
            <span>+ Create Festival Offer</span>
          </button>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* SUMMARY KPI CARDS                                             */}
      {/* ------------------------------------------------------------- */}
      <div className="cat-stats-summary-grid" style={{ marginBottom: 24 }}>
        <div className="cat-kpi-card">
          <span className="cat-kpi-label">Total Offers</span>
          <div className="cat-kpi-val" style={{ color: "#800020" }}>
            {stats.total}
          </div>
          <span className="cat-kpi-sub">All active &amp; scheduled promotions</span>
        </div>

        <div className="cat-kpi-card">
          <span className="cat-kpi-label">Active Now</span>
          <div className="cat-kpi-val" style={{ color: "#166534" }}>
            {stats.activeCount}
          </div>
          <span className="cat-kpi-sub">Live on customer storefront</span>
        </div>

        <div className="cat-kpi-card">
          <span className="cat-kpi-label">Scheduled</span>
          <div className="cat-kpi-val" style={{ color: "#1E40AF" }}>
            {stats.scheduledCount}
          </div>
          <span className="cat-kpi-sub">Upcoming festival launches</span>
        </div>

        <div className="cat-kpi-card">
          <span className="cat-kpi-label">Expired</span>
          <div className="cat-kpi-val" style={{ color: "#64748B" }}>
            {stats.expiredCount}
          </div>
          <span className="cat-kpi-sub">Past promotional campaigns</span>
        </div>

        <div className="cat-kpi-card">
          <span className="cat-kpi-label">Total Redemptions</span>
          <div className="cat-kpi-val" style={{ color: "#C49A52" }}>
            {stats.totalUses}
          </div>
          <span className="cat-kpi-sub">Orders saved with discounts</span>
        </div>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* FILTERS & SEARCH BAR                                          */}
      {/* ------------------------------------------------------------- */}
      <div
        style={{
          display: "flex",
          gap: 12,
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
          background: "#FFFDF9",
          border: "1px solid #EAD5C0",
          padding: "12px 18px",
          borderRadius: 8,
          marginBottom: 20,
        }}
      >
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", flex: "1 1 320px" }}>
          <input
            type="text"
            placeholder="Search by offer title or coupon code..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="ap-input"
            style={{ maxWidth: 360, height: 38 }}
          />

          <select
            value={targetFilter}
            onChange={(e) => setTargetFilter(e.target.value as any)}
            className="ap-select"
            style={{ width: "auto", height: 38 }}
          >
            <option value="all">All Target Types</option>
            <option value="category">Category-wise</option>
            <option value="subcategory">Subcategory-wise</option>
            <option value="product">Product-wise</option>
            <option value="all">Storewide (All Sarees)</option>
          </select>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="ap-select"
            style={{ width: "auto", height: 38 }}
          >
            <option value="all">All Statuses</option>
            <option value="active">Active Now</option>
            <option value="scheduled">Scheduled</option>
            <option value="expired">Expired</option>
          </select>
        </div>

        <span style={{ fontSize: 13, color: "#800020", fontWeight: 600 }}>
          Showing {filteredOffers.length} of {offers.length} offers
        </span>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* OFFERS DATA TABLE                                             */}
      {/* ------------------------------------------------------------- */}
      <div className="cat-table-wrap">
        <table className="cat-table">
          <thead>
            <tr>
              <th style={{ width: 220 }}>Offer Campaign</th>
              <th style={{ width: 140 }}>Target Level</th>
              <th style={{ width: 140 }}>Discount Value</th>
              <th style={{ width: 130 }}>Eligibility</th>
              <th style={{ width: 160 }}>Timeline</th>
              <th style={{ width: 100 }}>Priority</th>
              <th style={{ width: 110 }}>Status</th>
              <th style={{ width: 120 }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: 36 }}>
                  <div className="spinner-gold" style={{ margin: "0 auto 12px" }} />
                  <p style={{ color: "#800020", fontWeight: 600 }}>Loading festival offers...</p>
                </td>
              </tr>
            ) : filteredOffers.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ textAlign: "center", padding: 48 }}>
                  <span style={{ fontSize: 36, display: "block", marginBottom: 8 }}>🎁</span>
                  <p style={{ fontSize: 16, fontWeight: 700, color: "#800020" }}>
                    No festival offers found
                  </p>
                  <p style={{ fontSize: 13, color: "#666", maxWidth: 400, margin: "6px auto 16px" }}>
                    Create attractive festival discounts targeting specific saree categories, subcategories, or high-value products.
                  </p>
                  <button type="button" className="button gold-btn" onClick={handleOpenCreate}>
                    + Create First Offer
                  </button>
                </td>
              </tr>
            ) : (
              filteredOffers.map((o) => {
                const now = Date.now();
                const start = o.starts_at ? new Date(o.starts_at).getTime() : null;
                const end = o.ends_at ? new Date(o.ends_at).getTime() : null;
                const isScheduled = o.active && start && start > now;
                const isExpired = end && end <= now;
                const isLive = o.active && !isScheduled && !isExpired;

                const targetCount = o.targets?.length || 0;

                return (
                  <tr key={o.id}>
                    {/* Offer Title & Code */}
                    <td>
                      <div>
                        <strong style={{ color: "#800020", fontSize: 14, display: "block" }}>
                          {o.title}
                        </strong>
                        {o.code ? (
                          <span
                            style={{
                              display: "inline-block",
                              marginTop: 4,
                              background: "#FEF3C7",
                              color: "#92400E",
                              padding: "2px 6px",
                              borderRadius: 4,
                              fontWeight: 700,
                              fontSize: 11,
                              border: "1px dashed #D97706",
                            }}
                          >
                            🎟️ {o.code}
                          </span>
                        ) : (
                          <span style={{ fontSize: 11, color: "#166534", fontWeight: 600 }}>
                            ⚡ Auto-applied in store
                          </span>
                        )}
                        {o.description && (
                          <small style={{ display: "block", color: "#666", marginTop: 2, fontSize: 11 }}>
                            {o.description}
                          </small>
                        )}
                      </div>
                    </td>

                    {/* Target Level */}
                    <td>
                      <div>
                        <span
                          className="cat-status-pill"
                          style={{
                            background:
                              o.target_type === "product"
                                ? "#FDF2F8"
                                : o.target_type === "subcategory"
                                  ? "#EFF6FF"
                                  : o.target_type === "category"
                                    ? "#F0FDF4"
                                    : "#FBF7F0",
                            color:
                              o.target_type === "product"
                                ? "#BE185D"
                                : o.target_type === "subcategory"
                                  ? "#1D4ED8"
                                  : o.target_type === "category"
                                    ? "#15803D"
                                    : "#800020",
                            fontWeight: 700,
                          }}
                        >
                          {o.target_type === "product"
                            ? "🎯 Product-wise"
                            : o.target_type === "subcategory"
                              ? "📂 Subcategory"
                              : o.target_type === "category"
                                ? "🏷️ Category-wise"
                                : "🌐 All Sarees"}
                        </span>
                        {o.target_type !== "all" && (
                          <span style={{ display: "block", fontSize: 11, color: "#666", marginTop: 2 }}>
                            {targetCount} {o.target_type}{targetCount === 1 ? "" : "s"} assigned
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Discount Value */}
                    <td>
                      <div style={{ fontWeight: 800, color: "#800020", fontSize: 15 }}>
                        {o.kind === "percent" ? (
                          <span>{o.value}% OFF</span>
                        ) : (
                          <span>₹{Math.round(o.value / 100)} OFF</span>
                        )}
                        {o.max_discount_paise && (
                          <span style={{ display: "block", fontSize: 11, fontWeight: 500, color: "#666" }}>
                            Max {money(o.max_discount_paise)}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Eligibility & Usage */}
                    <td>
                      <div style={{ fontSize: 12 }}>
                        {o.min_subtotal_paise > 0 ? (
                          <span style={{ color: "#475569" }}>
                            Min {money(o.min_subtotal_paise)}
                          </span>
                        ) : (
                          <span style={{ color: "#166534" }}>No min purchase</span>
                        )}
                        <span style={{ display: "block", color: "#666", fontSize: 11, marginTop: 2 }}>
                          Used: <strong>{o.used_count}</strong>
                          {o.max_uses ? ` / ${o.max_uses}` : " times"}
                        </span>
                      </div>
                    </td>

                    {/* Timeline */}
                    <td>
                      <div style={{ fontSize: 11, color: "#475569" }}>
                        <div>
                          Start: {o.starts_at ? new Date(o.starts_at).toLocaleDateString("en-IN") : "Immediate"}
                        </div>
                        <div>
                          End: {o.ends_at ? new Date(o.ends_at).toLocaleDateString("en-IN") : "Never expires"}
                        </div>
                      </div>
                    </td>

                    {/* Priority */}
                    <td>
                      <span
                        style={{
                          display: "inline-block",
                          padding: "2px 8px",
                          borderRadius: 12,
                          background: "#FBF7F0",
                          border: "1px solid #D4B99F",
                          fontWeight: 700,
                          fontSize: 12,
                          color: "#800020",
                        }}
                      >
                        ⭐ {o.priority}
                      </span>
                      <span className={`fo-channel ${!o.code && o.apply_in_pos ? "both" : ""}`}>
                        {!o.code && o.apply_in_pos ? "POS + Online" : "Online only"}
                      </span>
                    </td>

                    {/* Status Pill */}
                    <td>
                      <button
                        type="button"
                        onClick={() => handleToggleActive(o)}
                        title="Click to toggle offer active/inactive"
                        style={{ background: "none", border: "none", cursor: "pointer", padding: 0 }}
                      >
                        <span
                          className="cat-status-pill"
                          style={{
                            background: isLive
                              ? "#DCFCE7"
                              : isScheduled
                                ? "#EFF6FF"
                                : isExpired
                                  ? "#F1F5F9"
                                  : "#FEE2E2",
                            color: isLive
                              ? "#166534"
                              : isScheduled
                                ? "#1E40AF"
                                : isExpired
                                  ? "#475569"
                                  : "#991B1B",
                            cursor: "pointer",
                          }}
                        >
                          {isLive
                            ? "Active"
                            : isScheduled
                              ? "Scheduled"
                              : isExpired
                                ? "Expired"
                                : "Inactive"}
                        </span>
                      </button>
                    </td>

                    {/* Actions */}
                    <td>
                      <div style={{ display: "flex", gap: 10 }}>
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => handleOpenEdit(o)}
                          style={{ fontWeight: 600, color: "#800020" }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="text-link"
                          style={{ color: "#B91C1C", fontWeight: 600 }}
                          onClick={() => setDeletingOffer(o)}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* ------------------------------------------------------------- */}
      {/* CREATE / EDIT OFFER MODAL                                     */}
      {/* ------------------------------------------------------------- */}
      {modalOpen && (
        <div className="cat-modal-backdrop" onClick={() => !saving && setModalOpen(false)}>
          <div
            className="cat-modal-card"
            style={{ maxWidth: 860, width: "95%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <form onSubmit={handleSaveOffer}>
              <div className="cat-modal-header" style={{ borderBottom: "1px solid #EAD5C0" }}>
                <div>
                  <h2 style={{ color: "#800020", margin: 0 }}>
                    {editingOffer ? "Edit Festival Offer" : "Create New Festival Offer"}
                  </h2>
                  <p style={{ margin: "4px 0 0", fontSize: 13, color: "#666" }}>
                    Configure targeting rules, discount values, and preview customer live view.
                  </p>
                </div>
                <button
                  type="button"
                  className="cat-close-btn"
                  onClick={() => !saving && setModalOpen(false)}
                >
                  ✕
                </button>
              </div>

              <div className="cat-modal-body" style={{ maxHeight: "72vh", overflowY: "auto" }}>
                {modalError && (
                  <div className="ap-error-banner" style={{ marginBottom: 16 }}>
                    <strong>Error:</strong> {modalError}
                  </div>
                )}

                {/* 1. Basic Offer Details */}
                <fieldset style={{ border: "1px solid #EAD5C0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <legend style={{ padding: "0 8px", color: "#800020", fontWeight: 700, fontSize: 14 }}>
                    1. Campaign Details
                  </legend>

                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <label className="ap-field" style={{ flex: "2 1 280px" }}>
                      <span className="ap-label">
                        Offer Title <em className="ap-req">*</em>
                      </span>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Diwali Dhamaka 20% OFF or Bridal Silk Special"
                        value={title}
                        onChange={(e) => setTitle(e.target.value)}
                        className="ap-input"
                      />
                    </label>

                    <label className="ap-field" style={{ flex: "1 1 180px" }}>
                      <span className="ap-label">
                        Coupon Code <small>(Optional - blank for auto-discount)</small>
                      </span>
                      <input
                        type="text"
                        placeholder="e.g. DIWALI20"
                        value={code}
                        onChange={(e) => setCode(e.target.value.toUpperCase())}
                        className="ap-input"
                        style={{ textTransform: "uppercase", fontWeight: 700 }}
                      />
                    </label>
                  </div>

                  <label className="ap-field" style={{ marginTop: 10 }}>
                    <span className="ap-label">Offer Description / Customer Note</span>
                    <input
                      type="text"
                      placeholder="e.g. Special festive celebration discount applied on all pure zari sarees."
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      className="ap-input"
                    />
                  </label>
                </fieldset>

                {/* 2. TARGET SELECTION (Category / Subcategory / Product / All) */}
                <fieldset style={{ border: "1px solid #C49A52", borderRadius: 8, padding: 16, marginBottom: 20, background: "#FFFDF9" }}>
                  <legend style={{ padding: "0 8px", color: "#800020", fontWeight: 700, fontSize: 14 }}>
                    2. Targeting Selection <em className="ap-req">*</em>
                  </legend>

                  {/* Target Type Radio Buttons */}
                  <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
                    {[
                      { type: "category", label: "Category-wise", icon: "🏷️", desc: "Applies to all products under selected categories" },
                      { type: "subcategory", label: "Subcategory-wise", icon: "📂", desc: "Applies only to selected subcategories" },
                      { type: "product", label: "Product-wise", icon: "🎯", desc: "Applies strictly to selected sarees" },
                      { type: "all", label: "All Sarees (Storewide)", icon: "🌐", desc: "Applies across all products" },
                    ].map((opt) => (
                      <button
                        key={opt.type}
                        type="button"
                        onClick={() => setTargetType(opt.type as OfferTargetType)}
                        style={{
                          flex: "1 1 180px",
                          padding: "10px 14px",
                          borderRadius: 6,
                          textAlign: "left",
                          border: targetType === opt.type ? "2px solid #800020" : "1px solid #EAD5C0",
                          background: targetType === opt.type ? "#F8EBDD" : "#FFFFFF",
                          cursor: "pointer",
                          transition: "all 0.15s ease",
                        }}
                      >
                        <div style={{ fontWeight: 700, color: "#800020", fontSize: 13 }}>
                          {opt.icon} {opt.label}
                        </div>
                        <div style={{ fontSize: 11, color: "#666", marginTop: 2 }}>{opt.desc}</div>
                      </button>
                    ))}
                  </div>

                  {/* TARGET PICKER: Category-wise */}
                  {targetType === "category" && (
                    <div style={{ background: "#FFFFFF", padding: 14, borderRadius: 6, border: "1px solid #EAD5C0" }}>
                      <span className="ap-label" style={{ marginBottom: 8, display: "block" }}>
                        Select Active Main Categories:
                      </span>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8 }}>
                        {mainCategories.map((cat) => {
                          const isChecked = selectedCategoryIds.includes(cat.id);
                          return (
                            <label
                              key={cat.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 8,
                                padding: "6px 10px",
                                borderRadius: 4,
                                background: isChecked ? "#DCFCE7" : "#FBF7F0",
                                border: isChecked ? "1px solid #166534" : "1px solid #EAD5C0",
                                cursor: "pointer",
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => {
                                  if (e.target.checked) {
                                    setSelectedCategoryIds([...selectedCategoryIds, cat.id]);
                                  } else {
                                    setSelectedCategoryIds(selectedCategoryIds.filter((id) => id !== cat.id));
                                  }
                                }}
                              />
                              <span style={{ fontSize: 13, fontWeight: isChecked ? 700 : 500, color: "#800020" }}>
                                {cat.name}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* TARGET PICKER: Subcategory-wise */}
                  {targetType === "subcategory" && (
                    <div style={{ background: "#FFFFFF", padding: 14, borderRadius: 6, border: "1px solid #EAD5C0" }}>
                      <label className="ap-field" style={{ marginBottom: 12 }}>
                        <span className="ap-label">1. Choose Main Category:</span>
                        <select
                          value={selectedSubcategoryParentId}
                          onChange={(e) => setSelectedSubcategoryParentId(e.target.value)}
                          className="ap-select"
                        >
                          {mainCategories.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>

                      <span className="ap-label" style={{ marginBottom: 8, display: "block" }}>
                        2. Select Subcategories:
                      </span>
                      {subcategoriesForParent.length === 0 ? (
                        <p style={{ color: "#888", fontSize: 13 }}>
                          No subcategories found under this main category.
                        </p>
                      ) : (
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                          {subcategoriesForParent.map((sub) => {
                            const isChecked = selectedSubcategoryIds.includes(sub.id);
                            return (
                              <label
                                key={sub.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 8,
                                  padding: "6px 10px",
                                  borderRadius: 4,
                                  background: isChecked ? "#DCFCE7" : "#FBF7F0",
                                  border: isChecked ? "1px solid #166534" : "1px solid #EAD5C0",
                                  cursor: "pointer",
                                }}
                              >
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setSelectedSubcategoryIds([...selectedSubcategoryIds, sub.id]);
                                    } else {
                                      setSelectedSubcategoryIds(selectedSubcategoryIds.filter((id) => id !== sub.id));
                                    }
                                  }}
                                />
                                <span style={{ fontSize: 13, fontWeight: isChecked ? 700 : 500, color: "#800020" }}>
                                  {sub.name}
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* TARGET PICKER: Product-wise */}
                  {targetType === "product" && (
                    <div style={{ background: "#FFFFFF", padding: 14, borderRadius: 6, border: "1px solid #EAD5C0" }}>
                      <div style={{ display: "flex", gap: 10, marginBottom: 12 }}>
                        <input
                          type="text"
                          placeholder="Search product by name, SKU, or category..."
                          value={productSearch}
                          onChange={(e) => setProductSearch(e.target.value)}
                          className="ap-input"
                          style={{ height: 36 }}
                        />
                      </div>

                      <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #EAD5C0", borderRadius: 4 }}>
                        {filteredProductsForPicker.length === 0 ? (
                          <p style={{ padding: 14, color: "#888", textAlign: "center" }}>
                            No matching products found.
                          </p>
                        ) : (
                          filteredProductsForPicker.map((prod) => {
                            const isChecked = selectedProductIds.includes(prod.id);
                            return (
                              <label
                                key={prod.id}
                                style={{
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "space-between",
                                  padding: "8px 12px",
                                  borderBottom: "1px solid #F1F5F9",
                                  background: isChecked ? "#DCFCE7" : "#FFFFFF",
                                  cursor: "pointer",
                                }}
                              >
                                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedProductIds([...selectedProductIds, prod.id]);
                                      } else {
                                        setSelectedProductIds(selectedProductIds.filter((id) => id !== prod.id));
                                      }
                                    }}
                                  />
                                  {prod.image_path && (
                                    <img
                                      src={prod.image_path}
                                      alt={prod.name}
                                      style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 4 }}
                                    />
                                  )}
                                  <div>
                                    <div style={{ fontWeight: 600, color: "#800020", fontSize: 13 }}>
                                      {prod.name}
                                    </div>
                                    <small style={{ color: "#666" }}>
                                      {prod.category} · SKU: {prod.sku}
                                    </small>
                                  </div>
                                </div>
                                <strong style={{ color: "#800020" }}>
                                  {money(prod.price_paise)}
                                </strong>
                              </label>
                            );
                          })
                        )}
                      </div>
                      <span style={{ fontSize: 12, color: "#800020", fontWeight: 600, marginTop: 8, display: "block" }}>
                        Selected: {selectedProductIds.length} sarees
                      </span>
                    </div>
                  )}
                </fieldset>

                {/* 3. DISCOUNT VALUES & RULES */}
                <fieldset style={{ border: "1px solid #EAD5C0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <legend style={{ padding: "0 8px", color: "#800020", fontWeight: 700, fontSize: 14 }}>
                    3. Discount Configuration &amp; Priority
                  </legend>

                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    {/* Discount Type */}
                    <label className="ap-field" style={{ flex: "1 1 160px" }}>
                      <span className="ap-label">Discount Type</span>
                      <select
                        value={kind}
                        onChange={(e) => setKind(e.target.value as "percent" | "fixed")}
                        className="ap-select"
                      >
                        <option value="percent">Percentage (%)</option>
                        <option value="fixed">Fixed Amount (₹)</option>
                      </select>
                    </label>

                    {/* Discount Value */}
                    <label className="ap-field" style={{ flex: "1 1 160px" }}>
                      <span className="ap-label">
                        Discount Value {kind === "percent" ? "(%)" : "(₹)"} <em className="ap-req">*</em>
                      </span>
                      <input
                        type="number"
                        min="1"
                        max={kind === "percent" ? 90 : 50000}
                        required
                        value={discountValue}
                        onChange={(e) => setDiscountValue(e.target.value)}
                        className="ap-input"
                        style={{ fontWeight: 700, color: "#800020" }}
                      />
                    </label>

                    {/* Min Purchase (₹) */}
                    <label className="ap-field" style={{ flex: "1 1 160px" }}>
                      <span className="ap-label">Min Purchase (₹)</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="0 (no minimum)"
                        value={minPurchaseRupees}
                        onChange={(e) => setMinPurchaseRupees(e.target.value)}
                        className="ap-input"
                      />
                    </label>

                    {/* Max Discount Limit (₹) */}
                    <label className="ap-field" style={{ flex: "1 1 160px" }}>
                      <span className="ap-label">Max Discount Cap (₹)</span>
                      <input
                        type="number"
                        min="0"
                        placeholder="e.g. 2000 (optional)"
                        value={maxDiscountRupees}
                        onChange={(e) => setMaxDiscountRupees(e.target.value)}
                        className="ap-input"
                      />
                    </label>
                  </div>

                  <div className="fo-pos-toggle">
                    <label className="ms-switch">
                      <input
                        type="checkbox"
                        checked={applyInPos && !code.trim()}
                        disabled={Boolean(code.trim())}
                        onChange={(e) => setApplyInPos(e.target.checked)}
                      />
                      <span className="ms-switch-track" aria-hidden="true" />
                      <span>
                        <strong>Apply in POS billing too</strong>
                        <small>
                          {code.trim()
                            ? "Coupon-code offers are online only. Remove the code to use this offer at the counter."
                            : applyInPos
                              ? "Taken off shop bills and online orders for the targeted sarees."
                              : "Off: online orders only. Turn on to also take it off shop bills."}
                        </small>
                      </span>
                    </label>
                  </div>

                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10 }}>
                    {/* Priority */}
                    <label className="ap-field" style={{ flex: "1 1 160px" }}>
                      <span className="ap-label">
                        Priority Level <small>(Higher = Takes precedence)</small>
                      </span>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        value={priority}
                        onChange={(e) => setPriority(e.target.value)}
                        className="ap-input"
                        style={{ fontWeight: 700 }}
                      />
                    </label>

                    {/* Max Usage Limit */}
                    <label className="ap-field" style={{ flex: "1 1 160px" }}>
                      <span className="ap-label">Total Max Uses</span>
                      <input
                        type="number"
                        min="1"
                        placeholder="Unlimited"
                        value={maxUses}
                        onChange={(e) => setMaxUses(e.target.value)}
                        className="ap-input"
                      />
                    </label>

                    {/* Per Customer Limit */}
                    <label className="ap-field" style={{ flex: "1 1 160px" }}>
                      <span className="ap-label">Uses Per Customer</span>
                      <input
                        type="number"
                        min="1"
                        value={perCustomerLimit}
                        onChange={(e) => setPerCustomerLimit(e.target.value)}
                        className="ap-input"
                      />
                    </label>

                    {/* Active Checkbox */}
                    <label className="checkbox-item" style={{ marginTop: 28 }}>
                      <input
                        type="checkbox"
                        checked={active}
                        onChange={(e) => setActive(e.target.checked)}
                      />
                      <span style={{ fontWeight: 700, color: "#800020" }}>Active &amp; Published</span>
                    </label>
                  </div>
                </fieldset>

                {/* 4. SCHEDULE TIMELINE */}
                <fieldset style={{ border: "1px solid #EAD5C0", borderRadius: 8, padding: 16, marginBottom: 20 }}>
                  <legend style={{ padding: "0 8px", color: "#800020", fontWeight: 700, fontSize: 14 }}>
                    4. Campaign Schedule (Optional)
                  </legend>

                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                    <label className="ap-field" style={{ flex: "1 1 200px" }}>
                      <span className="ap-label">Start Date &amp; Time</span>
                      <input
                        type="datetime-local"
                        value={startsAt}
                        onChange={(e) => setStartsAt(e.target.value)}
                        className="ap-input"
                      />
                    </label>

                    <label className="ap-field" style={{ flex: "1 1 200px" }}>
                      <span className="ap-label">Expiry Date &amp; Time</span>
                      <input
                        type="datetime-local"
                        value={endsAt}
                        onChange={(e) => setEndsAt(e.target.value)}
                        className="ap-input"
                      />
                    </label>
                  </div>
                </fieldset>

                {/* 5. LIVE CUSTOMER STOREFRONT PREVIEW */}
                <div
                  style={{
                    background: "#FBF7F0",
                    border: "2px dashed #C49A52",
                    borderRadius: 8,
                    padding: 16,
                    marginBottom: 10,
                  }}
                >
                  <span className="eyebrow" style={{ color: "#C49A52", fontWeight: 700, margin: 0 }}>
                    ✨ LIVE CUSTOMER CARD PREVIEW
                  </span>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 16,
                      marginTop: 10,
                      background: "#FFFFFF",
                      padding: 12,
                      borderRadius: 6,
                      border: "1px solid #EAD5C0",
                    }}
                  >
                    <div
                      style={{
                        width: 70,
                        height: 70,
                        borderRadius: 6,
                        background: "#800020",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#FFFFFF",
                        fontWeight: 700,
                        fontSize: 20,
                        flexShrink: 0,
                      }}
                    >
                      🥻
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <h4 style={{ margin: 0, color: "#800020", fontSize: 15 }}>
                          {title || "Festival Special Saree"}
                        </h4>
                        <span
                          style={{
                            background: "#800020",
                            color: "#FFFFFF",
                            padding: "2px 8px",
                            borderRadius: 12,
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {kind === "percent" ? `${discountValue}% OFF` : `₹${discountValue} OFF`}
                        </span>
                      </div>
                      <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
                        Sample ₹5,000 Saree → Customer Pays:{" "}
                        <strong style={{ color: "#166534", fontSize: 14 }}>
                          ₹{previewEffectivePrice.toLocaleString("en-IN")}
                        </strong>{" "}
                        <del style={{ color: "#999", marginLeft: 6 }}>₹5,000</del>{" "}
                        <span style={{ color: "#B45309", fontWeight: 600 }}>
                          (Customer Saves ₹{previewCappedDiscount.toLocaleString("en-IN")})
                        </span>
                      </div>
                      <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>
                        Target:{" "}
                        <strong>
                          {targetType === "category"
                            ? `${selectedCategoryIds.length} Categories`
                            : targetType === "subcategory"
                              ? `${selectedSubcategoryIds.length} Subcategories`
                              : targetType === "product"
                                ? `${selectedProductIds.length} Products`
                                : "Storewide"}
                        </strong>{" "}
                        · Priority: <strong>{priority}</strong>
                        {Number(minPurchaseRupees) > 0 && ` · Min ₹${minPurchaseRupees}`}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="cat-modal-footer" style={{ borderTop: "1px solid #EAD5C0" }}>
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={saving}
                  onClick={() => setModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button gold-btn"
                  disabled={saving}
                  style={{ minWidth: 140 }}
                >
                  {saving ? "Saving Offer..." : editingOffer ? "Update Offer" : "Save Offer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* DELETE CONFIRMATION MODAL                                     */}
      {/* ------------------------------------------------------------- */}
      {deletingOffer && (
        <div className="luxury-modal-overlay" onClick={() => !deleting && setDeletingOffer(null)}>
          <div className="luxury-modal-card" style={{ maxWidth: 440 }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 style={{ color: "#800020", margin: 0 }}>Delete Festival Offer?</h3>
              <button type="button" className="close-btn" onClick={() => !deleting && setDeletingOffer(null)}>
                ✕
              </button>
            </div>
            <div style={{ padding: "16px 24px" }}>
              <p style={{ margin: "0 0 12px", color: "#444", fontSize: 14 }}>
                Are you sure you want to permanently delete the campaign{" "}
                <strong style={{ color: "#800020" }}>"{deletingOffer.title}"</strong>?
              </p>
              <p style={{ margin: 0, fontSize: 12, color: "#666" }}>
                This will remove the promotional discount from all targeted sarees immediately.
              </p>
            </div>
            <div className="modal-actions">
              <button
                type="button"
                className="button outline-btn"
                disabled={deleting}
                onClick={() => setDeletingOffer(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="button delete-btn"
                disabled={deleting}
                onClick={handleDeleteConfirm}
              >
                {deleting ? "Deleting..." : "Delete Offer"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
