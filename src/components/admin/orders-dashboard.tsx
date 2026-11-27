"use client";
import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { money, statusLabel } from "@/lib/core";
import { api } from "../api";

type OrderSummary = {
  totalOrders: number;
  newOrders: number;
  processingOrders: number;
  shippedOrders: number;
  deliveredOrders: number;
  cancelledOrders: number;
  totalRevenuePaise: number;
};

type OrderRow = {
  id: string;
  number: number;
  customer_phone?: string;
  status: string;
  payment_status: string;
  channel: string;
  total_paise: number;
  item_count: number;
  created_at: string;
  address?: { name?: string; phone?: string; city?: string };
  profiles?: { email?: string; display_name?: string };
};

const ORDER_STATUSES = [
  "awaiting_payment",
  "confirmed",
  "packing",
  "shipped",
  "delivered",
  "cancelled",
  "expired",
  "return_requested",
  "returned",
];

const PAYMENT_STATUSES = [
  "pending",
  "submitted",
  "paid",
  "failed",
  "late_paid",
  "refund_pending",
  "refunded",
];

function badgeStyle(kind: string): React.CSSProperties {
  const k = kind.toLowerCase();
  if (k === "paid" || k === "delivered" || k === "confirmed") {
    return { background: "#ECFDF5", color: "#065F46", border: "1px solid #A7F3D0" };
  }
  if (k === "packing" || k === "shipped" || k === "submitted") {
    return { background: "#EFF6FF", color: "#1E40AF", border: "1px solid #BFDBFE" };
  }
  if (k === "cancelled" || k === "failed" || k === "expired") {
    return { background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA" };
  }
  return { background: "#FFFBEB", color: "#92400E", border: "1px solid #FDE68A" };
}

export function OrdersDashboard() {
  const router = useRouter();
  const [summary, setSummary] = useState<OrderSummary | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [paymentStatus, setPaymentStatus] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  async function load(targetPage = page) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (status) params.set("status", status);
      if (paymentStatus) params.set("payment_status", paymentStatus);
      if (fromDate) params.set("from", fromDate);
      if (toDate) params.set("to", toDate);
      params.set("page", String(targetPage));
      params.set("limit", "100");

      const res = await api<{
        summary: OrderSummary;
        orders: OrderRow[];
        page: number;
        totalPages: number;
        totalCount: number;
      }>(`/api/admin/orders/summary?${params.toString()}`);

      setSummary(res.summary);
      setOrders(res.orders || []);
      setPage(res.page || 1);
      setTotalPages(res.totalPages || 1);
      setTotalCount(res.totalCount || 0);
    } catch (err) {
      setError((err as Error).message || "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(1);
  }, [status, paymentStatus, fromDate, toDate]);

  const cards = [
    { label: "Total Orders", value: summary?.totalOrders ?? 0, accent: "#800020" },
    { label: "New Orders", value: summary?.newOrders ?? 0, accent: "#B45309" },
    { label: "Processing Orders", value: summary?.processingOrders ?? 0, accent: "#1D4ED8" },
    { label: "Dispatched Orders", value: summary?.shippedOrders ?? 0, accent: "#0369A1" },
    { label: "Delivered Orders", value: summary?.deliveredOrders ?? 0, accent: "#15803D" },
    { label: "Cancelled Orders", value: summary?.cancelledOrders ?? 0, accent: "#B91C1C" },
    {
      label: "Total Revenue",
      value: money(summary?.totalRevenuePaise ?? 0),
      accent: "#6B1724",
    },
  ];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* 7 Summary KPI Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
          gap: 14,
        }}
      >
        {cards.map((c) => (
          <div
            key={c.label}
            style={{
              background: "#FFFFFF",
              border: "1px solid #EAD5C0",
              borderRadius: 12,
              padding: "16px 18px",
              boxShadow: "0 2px 8px rgba(107, 23, 36, 0.04)",
              borderTop: `3px solid ${c.accent}`,
            }}
          >
            <div style={{ fontSize: 12, color: "#6B7280", fontWeight: 600 }}>
              {c.label}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: c.accent,
                marginTop: 6,
              }}
            >
              {loading && !summary ? "—" : c.value}
            </div>
          </div>
        ))}
      </div>

      {/* Filters Bar */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #EAD5C0",
          borderRadius: 12,
          padding: 16,
          display: "flex",
          flexWrap: "wrap",
          gap: 12,
          alignItems: "flex-end",
        }}
      >
        <div style={{ flex: "1 1 220px" }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>
            Search Orders
          </label>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void load(1);
            }}
            placeholder="Order ID (#MS-...), customer name, or mobile..."
            style={{ height: 40, borderRadius: 8 }}
          />
        </div>

        <div style={{ width: 155 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>
            Order Status
          </label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            style={{ height: 40, borderRadius: 8 }}
          >
            <option value="">All Statuses</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div style={{ width: 155 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>
            Payment Status
          </label>
          <select
            value={paymentStatus}
            onChange={(e) => setPaymentStatus(e.target.value)}
            style={{ height: 40, borderRadius: 8 }}
          >
            <option value="">All Payments</option>
            {PAYMENT_STATUSES.map((p) => (
              <option key={p} value={p}>
                {p.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div style={{ width: 140 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>
            From Date
          </label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={{ height: 40, borderRadius: 8 }}
          />
        </div>

        <div style={{ width: 140 }}>
          <label style={{ display: "block", fontSize: 11, fontWeight: 600, color: "#4B5563", marginBottom: 4 }}>
            To Date
          </label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={{ height: 40, borderRadius: 8 }}
          />
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            type="button"
            onClick={() => void load(1)}
            className="ms-btn ms-btn-primary ms-btn-sm"
            style={{ height: 40, padding: "0 16px" }}
          >
            Search
          </button>
          <button
            type="button"
            onClick={() => {
              setQ("");
              setStatus("");
              setPaymentStatus("");
              setFromDate("");
              setToDate("");
              setTimeout(() => void load(1), 0);
            }}
            className="ms-btn ms-btn-ghost ms-btn-sm"
            style={{ height: 40, padding: "0 14px" }}
          >
            Reset
          </button>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            color: "#991B1B",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {/* Orders Table */}
      <div
        style={{
          background: "#FFFFFF",
          border: "1px solid #EAD5C0",
          borderRadius: 12,
          overflow: "hidden",
          boxShadow: "0 2px 10px rgba(0,0,0,0.03)",
        }}
      >
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "#FAF5EE", borderBottom: "1px solid #EAD5C0", textAlign: "left" }}>
                <th style={{ padding: "12px 16px", color: "#6B1724", fontWeight: 700 }}>Order ID</th>
                <th style={{ padding: "12px 16px", color: "#6B1724", fontWeight: 700 }}>Customer</th>
                <th style={{ padding: "12px 16px", color: "#6B1724", fontWeight: 700 }}>Mobile</th>
                <th style={{ padding: "12px 16px", color: "#6B1724", fontWeight: 700 }}>Items</th>
                <th style={{ padding: "12px 16px", color: "#6B1724", fontWeight: 700 }}>Amount</th>
                <th style={{ padding: "12px 16px", color: "#6B1724", fontWeight: 700 }}>Payment</th>
                <th style={{ padding: "12px 16px", color: "#6B1724", fontWeight: 700 }}>Status</th>
                <th style={{ padding: "12px 16px", color: "#6B1724", fontWeight: 700 }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #F3EAE0" }}>
                    <td colSpan={8} style={{ padding: "16px", color: "#9CA3AF" }}>
                      Loading orders…
                    </td>
                  </tr>
                ))
              ) : orders.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ padding: "40px 16px", textAlign: "center", color: "#6B7280" }}>
                    No orders match your current filters.
                  </td>
                </tr>
              ) : (
                orders.map((o) => {
                  const custName = o.address?.name || o.profiles?.display_name || "Customer";
                  const phone = o.customer_phone || o.address?.phone || "—";
                  return (
                    <tr
                      key={o.id}
                      onClick={() => router.push(`/admin/orders/${o.id}`)}
                      style={{
                        borderBottom: "1px solid #F3EAE0",
                        cursor: "pointer",
                        transition: "background 0.15s ease",
                      }}
                    >
                      <td style={{ padding: "14px 16px", fontWeight: 700, color: "#800020" }}>
                        #MS-{o.number}
                        <div style={{ fontSize: 11, fontWeight: 400, color: "#6B7280", marginTop: 2 }}>
                          {new Date(o.created_at).toLocaleDateString("en-IN", {
                            day: "2-digit",
                            month: "short",
                            year: "numeric",
                          })}
                        </div>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <div style={{ fontWeight: 600, color: "#1F2937" }}>{custName}</div>
                        {o.profiles?.email && (
                          <div style={{ fontSize: 11, color: "#6B7280" }}>{o.profiles.email}</div>
                        )}
                      </td>
                      <td style={{ padding: "14px 16px", color: "#374151" }}>{phone}</td>
                      <td style={{ padding: "14px 16px", fontWeight: 600 }}>{o.item_count}</td>
                      <td style={{ padding: "14px 16px", fontWeight: 700, color: "#1F2937" }}>
                        {money(o.total_paise)}
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            ...badgeStyle(o.payment_status),
                            padding: "4px 9px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: "capitalize",
                            display: "inline-block",
                          }}
                        >
                          {o.payment_status.replaceAll("_", " ")}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px" }}>
                        <span
                          style={{
                            ...badgeStyle(o.status),
                            padding: "4px 9px",
                            borderRadius: 999,
                            fontSize: 11,
                            fontWeight: 600,
                            textTransform: "capitalize",
                            display: "inline-block",
                          }}
                        >
                          {statusLabel(o.status)}
                        </span>
                      </td>
                      <td style={{ padding: "14px 16px" }} onClick={(e) => e.stopPropagation()}>
                        <Link
                          href={`/admin/orders/${o.id}`}
                          className="text-link"
                          style={{ fontWeight: 600, color: "#800020" }}
                        >
                          Open Order ↗
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        <div
          style={{
            padding: "12px 16px",
            borderTop: "1px solid #EAD5C0",
            background: "#FAF5EE",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            fontSize: 12,
            color: "#4B5563",
          }}
        >
          <span>
            Showing <strong>{orders.length}</strong> {orders.length === 1 ? "order" : "orders"}
            {totalCount > orders.length ? ` (of ${totalCount} total)` : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
