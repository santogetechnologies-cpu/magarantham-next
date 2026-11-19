"use client";
import React, { useState } from "react";
import { api } from "../api";

export function StockModal({
  productId,
  productName,
  currentStock = 0,
  products = [],
  onClose,
  onSaved,
}: {
  productId?: string;
  productName?: string;
  currentStock?: number;
  products?: { id: string; name: string; sku: string; stock_on_hand: number }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [selectedProductId, setSelectedProductId] = useState(
    productId || products[0]?.id || "",
  );
  const [adjustmentType, setAdjustmentType] = useState<
    "stock_in" | "stock_out" | "adjustment" | "transfer" | "damaged" | "returned"
  >("stock_in");
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState("Inward goods from weaver workshop");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const selectedProd = products.find((p) => p.id === selectedProductId);
  const stockBase = selectedProd ? selectedProd.stock_on_hand : currentStock;

  // Compute delta based on adjustment type
  const isNegative =
    adjustmentType === "stock_out" ||
    adjustmentType === "damaged" ||
    adjustmentType === "transfer";
  const delta = isNegative ? -Math.abs(quantity) : Math.abs(quantity);
  const newStock = Math.max(0, stockBase + delta);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (!selectedProductId) {
      setError("Please select a product.");
      return;
    }
    if (quantity <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }
    if (stockBase + delta < 0) {
      setError("Stock cannot be negative without special administrator authorization.");
      return;
    }

    setSaving(true);
    try {
      await api("/api/admin/inventory", {
        product_id: selectedProductId,
        delta,
        reason: `${adjustmentType.toUpperCase()}: ${reason}`,
        notes,
        adjustment_type: adjustmentType,
      });

      onSaved();
    } catch (err) {
      setError((err as Error).message || "Stock adjustment failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="luxury-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="luxury-modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <span className="modal-eyebrow">✦ STOCK MANAGEMENT</span>
            <h2 className="modal-title">Inventory Stock Operation</h2>
          </div>
          <button type="button" className="modal-close-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {error && <div className="modal-error-banner" role="alert">{error}</div>}

        <form onSubmit={handleSubmit} className="modal-form-body">
          {products.length > 0 && !productId ? (
            <label className="input-group">
              <span>Select Saree / Product *</span>
              <select
                value={selectedProductId}
                onChange={(e) => setSelectedProductId(e.target.value)}
                required
              >
                {products.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.sku}) &middot; In Stock: {p.stock_on_hand}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="selected-product-box">
              <span className="box-label">Target Product</span>
              <span className="box-val">{productName || selectedProd?.name || "Selected Saree"}</span>
            </div>
          )}

          <div className="stock-preview-grid">
            <div className="stock-calc-card">
              <span className="calc-label">Current Stock</span>
              <span className="calc-value">{stockBase} pcs</span>
            </div>
            <div className="stock-calc-card delta">
              <span className="calc-label">Delta ({isNegative ? "-" : "+"})</span>
              <span className={`calc-value ${isNegative ? "negative" : "positive"}`}>
                {delta > 0 ? `+${delta}` : delta} pcs
              </span>
            </div>
            <div className="stock-calc-card result">
              <span className="calc-label">New Balance</span>
              <span className="calc-value">{newStock} pcs</span>
            </div>
          </div>

          <label className="input-group">
            <span>Operation Type</span>
            <select
              value={adjustmentType}
              onChange={(e) => {
                const val = e.target.value as any;
                setAdjustmentType(val);
                if (val === "stock_in") setReason("Inward goods from weaver workshop");
                if (val === "stock_out") setReason("Store floor allocation or sample issue");
                if (val === "damaged") setReason("Defective fabric / zari damage quarantine");
                if (val === "returned") setReason("Customer return verification accepted");
                if (val === "transfer") setReason("Showroom branch stock transfer");
                if (val === "adjustment") setReason("Quarterly physical audit discrepancy");
              }}
            >
              <option value="stock_in">Stock In (+ Inward Receiving)</option>
              <option value="stock_out">Stock Out (- Floor Dispense)</option>
              <option value="adjustment">Manual Adjustment (+ / - Audit Reconciliation)</option>
              <option value="transfer">Stock Transfer (- Showroom Transfer)</option>
              <option value="damaged">Damaged Stock (- Damaged Goods Write-off)</option>
              <option value="returned">Returned Stock (+ Customer Return Restock)</option>
            </select>
          </label>

          <label className="input-group">
            <span>Quantity (Pieces) *</span>
            <input
              type="number"
              min="1"
              max="10000"
              required
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value)))}
            />
          </label>

          <label className="input-group">
            <span>Primary Reason *</span>
            <input
              type="text"
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Received shipment invoice #1042"
            />
          </label>

          <label className="input-group">
            <span>Internal Audit Notes (Optional)</span>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Additional invoice reference, batch number, or condition notes..."
            />
          </label>

          <div className="modal-actions-footer">
            <button type="button" className="button outline-btn" onClick={onClose} disabled={saving}>
              Cancel
            </button>
            <button type="submit" className="button gold-btn" disabled={saving}>
              {saving ? "Posting Ledger Transaction..." : "Commit Stock Adjustment"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
