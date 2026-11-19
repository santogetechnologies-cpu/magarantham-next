"use client";
import React from "react";
import Link from "next/link";
import { money } from "@/lib/core";

export type OverviewData = {
  profile?: {
    display_name?: string;
    role?: string;
    email?: string;
  };
  orders?: number | null;
  available?: number | null;
  stats?: {
    totalProducts?: number;
    totalStockQuantity?: number;
    lowStockProducts?: number;
    outOfStockProducts?: number;
    totalEmployees?: number;
    presentToday?: number;
    absentToday?: number;
    activeOffers?: number;
    todaySales?: number;
    monthlySales?: number;
  };
  visualizations?: {
    dailySales?: {
      date: string;
      label: string;
      online: number;
      pos: number;
      total: number;
    }[];
    stockDistribution?: {
      category: string;
      count: number;
      stock: number;
    }[];
    attendanceOverview?: {
      total: number;
      present: number;
      absent: number;
      onLeave: number;
    };
    lowStockAlerts?: {
      id: string;
      name: string;
      sku: string;
      category: string;
      stock_on_hand: number;
      min_stock_level: number;
      price_paise: number;
      image_path: string;
    }[];
    recentOrders?: {
      id: string;
      number: number;
      total_paise: number;
      status: string;
      payment_status: string;
      channel: string;
      created_at: string;
    }[];
    recentMovements?: {
      id: string;
      product_id: string;
      delta: number;
      reason: string;
      created_at: string;
      products?: {
        name: string;
        sku: string;
      };
    }[];
  };
};

export function DashboardOverview({
  data,
  onAdjustStock,
}: {
  data: OverviewData | null;
  onAdjustStock?: (productId: string) => void;
}) {
  if (!data) {
    return (
      <div className="dashboard-loading-skeleton">
        <div className="skeleton-hero" />
        <div className="skeleton-grid-cards">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  const stats = data.stats || {};
  const viz = data.visualizations || {};
  const dailySales = viz.dailySales || [];
  const stockDist = viz.stockDistribution || [];
  const attendance = viz.attendanceOverview || {
    total: stats.totalEmployees || 0,
    present: stats.presentToday || 0,
    absent: stats.absentToday || 0,
    onLeave: 0,
  };
  const lowStock = viz.lowStockAlerts || [];
  const recentOrders = viz.recentOrders || [];
  const recentMovements = viz.recentMovements || [];

  // Compute daily sales chart dimensions
  const maxDaily = Math.max(
    1,
    ...dailySales.map((d) => d.total || 0),
  );
  const chartHeight = 160;
  const chartWidth = 600;

  // Compute stock distribution max
  const maxStockCat = Math.max(1, ...stockDist.map((c) => c.stock || 0));

  return (
    <div className="luxury-dashboard-overview">
      {/* Editorial Welcome Header */}
      <div className="dashboard-hero-header">
        <div className="hero-titles">
          <p className="hero-eyebrow">
            ✦ MAGARANTHAM SILKS &middot; RETAIL ENTERPRISE OPERATIONS
          </p>
          <h2 className="hero-main-title">
            Executive Operations Dashboard
          </h2>
          <p className="hero-meta-subtitle">
            Synchronized Real-Time Data &middot; Online Store &amp; In-Store POS &middot;{" "}
            {new Date().toLocaleDateString("en-IN", {
              weekday: "long",
              year: "numeric",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <div className="hero-actions">
          <Link href="/admin/products?action=new" className="hero-btn hero-btn-primary">
            <span>+ Add New Saree</span>
          </Link>
          <Link href="/admin/inventory?action=adjust" className="hero-btn hero-btn-secondary">
            <span>Stock Adjustment</span>
          </Link>
          <Link href="/admin/pos" className="hero-btn hero-btn-ghost">
            <span>Open POS Register</span>
            <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </div>

      {/* 10 Real Statistics KPI Grid */}
      <section className="kpi-section" aria-label="Key Performance Indicators">
        <div className="kpi-grid">
          {/* 1. Total Products */}
          <div className="kpi-card">
            <div className="kpi-top">
              <span className="kpi-label">Total Sarees</span>
              <span className="kpi-icon">👘</span>
            </div>
            <div className="kpi-value">{stats.totalProducts ?? 0}</div>
            <div className="kpi-footer">
              <span className="kpi-hint">Catalogue variants</span>
              <Link href="/admin/products" className="kpi-link">
                View &rarr;
              </Link>
            </div>
          </div>

          {/* 2. Total Stock Quantity */}
          <div className="kpi-card accent-card">
            <div className="kpi-top">
              <span className="kpi-label">Total Stock Pieces</span>
              <span className="kpi-icon">📦</span>
            </div>
            <div className="kpi-value">{stats.totalStockQuantity ?? 0}</div>
            <div className="kpi-footer">
              <span className="kpi-hint">
                {data.available ?? stats.totalStockQuantity ?? 0} available for sale
              </span>
              <Link href="/admin/inventory" className="kpi-link">
                Ledger &rarr;
              </Link>
            </div>
          </div>

          {/* 3. Low Stock Products */}
          <div className={`kpi-card ${(stats.lowStockProducts ?? 0) > 0 ? "warning-border" : ""}`}>
            <div className="kpi-top">
              <span className="kpi-label">Low Stock Sarees</span>
              <span className="kpi-icon">⚠️</span>
            </div>
            <div className="kpi-value warning-text">{stats.lowStockProducts ?? 0}</div>
            <div className="kpi-footer">
              <span className="kpi-hint">&le; 3 units threshold</span>
              <Link href="/admin/inventory?tab=low" className="kpi-link">
                Alerts &rarr;
              </Link>
            </div>
          </div>

          {/* 4. Out of Stock Products */}
          <div className={`kpi-card ${(stats.outOfStockProducts ?? 0) > 0 ? "critical-border" : ""}`}>
            <div className="kpi-top">
              <span className="kpi-label">Out of Stock</span>
              <span className="kpi-icon">🚫</span>
            </div>
            <div className="kpi-value critical-text">{stats.outOfStockProducts ?? 0}</div>
            <div className="kpi-footer">
              <span className="kpi-hint">Requires replenishment</span>
              <Link href="/admin/inventory?tab=out" className="kpi-link">
                Restock &rarr;
              </Link>
            </div>
          </div>

          {/* 5. Total Employees */}
          <div className="kpi-card">
            <div className="kpi-top">
              <span className="kpi-label">Total Staff</span>
              <span className="kpi-icon">👥</span>
            </div>
            <div className="kpi-value">{stats.totalEmployees ?? 0}</div>
            <div className="kpi-footer">
              <span className="kpi-hint">Active workforce</span>
              <Link href="/admin/employees" className="kpi-link">
                Directory &rarr;
              </Link>
            </div>
          </div>

          {/* 6. Present Today */}
          <div className="kpi-card success-card">
            <div className="kpi-top">
              <span className="kpi-label">Present Today</span>
              <span className="kpi-icon">✅</span>
            </div>
            <div className="kpi-value success-text">{stats.presentToday ?? 0}</div>
            <div className="kpi-footer">
              <span className="kpi-hint">Marked on shift</span>
              <Link href="/admin/attendance" className="kpi-link">
                Register &rarr;
              </Link>
            </div>
          </div>

          {/* 7. Absent Today */}
          <div className="kpi-card">
            <div className="kpi-top">
              <span className="kpi-label">Absent / Off</span>
              <span className="kpi-icon">⏳</span>
            </div>
            <div className="kpi-value">{stats.absentToday ?? 0}</div>
            <div className="kpi-footer">
              <span className="kpi-hint">Not checked in</span>
              <Link href="/admin/attendance" className="kpi-link">
                Review &rarr;
              </Link>
            </div>
          </div>

          {/* 8. Active Offers */}
          <div className="kpi-card">
            <div className="kpi-top">
              <span className="kpi-label">Active Offers &amp; Coupons</span>
              <span className="kpi-icon">🎟️</span>
            </div>
            <div className="kpi-value">{stats.activeOffers ?? 0}</div>
            <div className="kpi-footer">
              <span className="kpi-hint">Running promotional campaigns</span>
              <Link href="/admin/offers" className="kpi-link">
                Offers &rarr;
              </Link>
            </div>
          </div>

          {/* 9. Today's Sales */}
          <div className="kpi-card gold-border-card">
            <div className="kpi-top">
              <span className="kpi-label">Today&apos;s Sales</span>
              <span className="kpi-icon">₹</span>
            </div>
            <div className="kpi-value gold-text">
              {money(stats.todaySales || 0)}
            </div>
            <div className="kpi-footer">
              <span className="kpi-hint">Online &amp; POS Gross</span>
              <Link href="/admin/sales-reports" className="kpi-link">
                Details &rarr;
              </Link>
            </div>
          </div>

          {/* 10. Monthly Sales */}
          <div className="kpi-card gold-border-card">
            <div className="kpi-top">
              <span className="kpi-label">Monthly Revenue</span>
              <span className="kpi-icon">💰</span>
            </div>
            <div className="kpi-value gold-text">
              {money(stats.monthlySales || 0)}
            </div>
            <div className="kpi-footer">
              <span className="kpi-hint">Month-to-date total</span>
              <Link href="/admin/reports" className="kpi-link">
                Report &rarr;
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* Visualizations Section */}
      <section className="visualizations-grid">
        {/* Daily Sales Chart */}
        <div className="viz-panel chart-panel">
          <div className="viz-header">
            <div>
              <h3 className="viz-title">Daily Sales Trend (7 Days)</h3>
              <p className="viz-subtitle">Omnichannel revenue (Storefront + POS)</p>
            </div>
            <span className="badge-luxury">Real-Time</span>
          </div>

          <div className="svg-chart-container">
            {dailySales.length > 0 ? (
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="sales-trend-svg"
                preserveAspectRatio="none"
              >
                <defs>
                  <linearGradient id="salesGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#800020" stopOpacity="0.35" />
                    <stop offset="100%" stopColor="#C49A52" stopOpacity="0.02" />
                  </linearGradient>
                </defs>

                {/* Grid horizontal guidelines */}
                {[0.25, 0.5, 0.75, 1].map((pct, i) => (
                  <line
                    key={i}
                    x1="40"
                    y1={chartHeight - 30 - (chartHeight - 50) * pct}
                    x2={chartWidth - 20}
                    y2={chartHeight - 30 - (chartHeight - 50) * pct}
                    stroke="#EAD5C0"
                    strokeDasharray="4 4"
                    strokeWidth="1"
                  />
                ))}

                {/* Area & Line path */}
                {(() => {
                  const points = dailySales.map((d, idx) => {
                    const x = 50 + (idx / Math.max(1, dailySales.length - 1)) * (chartWidth - 80);
                    const y = chartHeight - 35 - ((d.total || 0) / maxDaily) * (chartHeight - 55);
                    return { x, y, ...d };
                  });

                  const lineD = points.reduce(
                    (acc, pt, i) => `${acc} ${i === 0 ? "M" : "L"} ${pt.x} ${pt.y}`,
                    "",
                  );

                  const areaD = `${lineD} L ${points[points.length - 1]?.x || 0} ${
                    chartHeight - 30
                  } L ${points[0]?.x || 0} ${chartHeight - 30} Z`;

                  return (
                    <>
                      <path d={areaD} fill="url(#salesGrad)" />
                      <path
                        d={lineD}
                        fill="none"
                        stroke="#800020"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                      {points.map((pt, i) => (
                        <g key={i}>
                          <circle
                            cx={pt.x}
                            cy={pt.y}
                            r="4"
                            fill="#C49A52"
                            stroke="#FFF8EF"
                            strokeWidth="2"
                          />
                          <text
                            x={pt.x}
                            y={chartHeight - 12}
                            textAnchor="middle"
                            fontSize="10"
                            fill="#815F50"
                          >
                            {pt.label}
                          </text>
                        </g>
                      ))}
                    </>
                  );
                })()}
              </svg>
            ) : (
              <div className="empty-chart-fallback">
                <p>No sales recorded in the past 7 days yet.</p>
              </div>
            )}
          </div>
        </div>

        {/* Stock Distribution by Category */}
        <div className="viz-panel distribution-panel">
          <div className="viz-header">
            <div>
              <h3 className="viz-title">Stock by Saree Category</h3>
              <p className="viz-subtitle">Inventory distribution across weaves</p>
            </div>
            <Link href="/admin/categories" className="text-link">
              All categories &rarr;
            </Link>
          </div>

          <div className="category-bars-list">
            {stockDist.length > 0 ? (
              stockDist.map((item, idx) => {
                const pct = Math.round((item.stock / maxStockCat) * 100);
                return (
                  <div key={idx} className="category-bar-row">
                    <div className="cat-meta-row">
                      <span className="cat-name">{item.category}</span>
                      <span className="cat-stock-stat">
                        <strong>{item.stock}</strong> pieces &middot; {item.count} styles
                      </span>
                    </div>
                    <div className="cat-progress-track">
                      <div
                        className="cat-progress-fill"
                        style={{
                          width: `${pct}%`,
                          backgroundColor:
                            idx === 0
                              ? "#800020"
                              : idx === 1
                                ? "#C49A52"
                                : idx === 2
                                  ? "#650019"
                                  : "#A27731",
                        }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <p className="empty-state-text">No category stock data available.</p>
            )}
          </div>
        </div>

        {/* Attendance Breakdown */}
        <div className="viz-panel attendance-panel">
          <div className="viz-header">
            <div>
              <h3 className="viz-title">Staff Attendance (Today)</h3>
              <p className="viz-subtitle">Daily floor &amp; billing deployment</p>
            </div>
            <Link href="/admin/attendance" className="text-link">
              Manage &rarr;
            </Link>
          </div>

          <div className="attendance-pill-stats">
            <div className="att-box present">
              <span className="att-number">{attendance.present}</span>
              <span className="att-label">Present</span>
            </div>
            <div className="att-box absent">
              <span className="att-number">{attendance.absent}</span>
              <span className="att-label">Absent / Off</span>
            </div>
            <div className="att-box leave">
              <span className="att-number">{attendance.onLeave}</span>
              <span className="att-label">On Leave</span>
            </div>
            <div className="att-box total">
              <span className="att-number">{attendance.total}</span>
              <span className="att-label">Total Staff</span>
            </div>
          </div>

          <div className="attendance-progress-stacked">
            {attendance.total > 0 ? (
              <>
                <div
                  className="bar-seg present-bar"
                  style={{
                    width: `${(attendance.present / attendance.total) * 100}%`,
                  }}
                  title="Present"
                />
                <div
                  className="bar-seg leave-bar"
                  style={{
                    width: `${(attendance.onLeave / attendance.total) * 100}%`,
                  }}
                  title="On Leave"
                />
                <div
                  className="bar-seg absent-bar"
                  style={{
                    width: `${(attendance.absent / attendance.total) * 100}%`,
                  }}
                  title="Absent"
                />
              </>
            ) : (
              <div className="bar-seg empty-bar" style={{ width: "100%" }} />
            )}
          </div>
        </div>
      </section>

      {/* Actionable Tables Grid */}
      <section className="dashboard-tables-grid">
        {/* Low Stock Alerts */}
        <div className="table-widget-panel">
          <div className="widget-header">
            <div className="widget-title-group">
              <span className="widget-badge-alert">Alert</span>
              <h3>Low Stock Inventory</h3>
            </div>
            <Link href="/admin/inventory" className="text-link">
              Open Inventory &rarr;
            </Link>
          </div>

          <div className="table-responsive-wrapper">
            <table className="luxury-table">
              <thead>
                <tr>
                  <th>Saree / Style</th>
                  <th>SKU</th>
                  <th>Category</th>
                  <th>Stock</th>
                  <th>Min Level</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {lowStock.length > 0 ? (
                  lowStock.map((item) => (
                    <tr key={item.id}>
                      <td className="product-title-cell">
                        <img
                          src={item.image_path || "/assets/brand-logo.png"}
                          alt={item.name}
                          className="table-thumb"
                        />
                        <span className="table-product-name">{item.name}</span>
                      </td>
                      <td className="sku-cell"><code>{item.sku}</code></td>
                      <td>{item.category}</td>
                      <td>
                        <span
                          className={`stock-badge ${
                            item.stock_on_hand === 0 ? "out" : "low"
                          }`}
                        >
                          {item.stock_on_hand} pcs
                        </span>
                      </td>
                      <td>{item.min_stock_level || 3} pcs</td>
                      <td>
                        {onAdjustStock ? (
                          <button
                            type="button"
                            className="button mini-btn"
                            onClick={() => onAdjustStock(item.id)}
                          >
                            + Stock In
                          </button>
                        ) : (
                          <Link
                            href={`/admin/inventory?product=${item.id}`}
                            className="button mini-btn"
                          >
                            Adjust
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="table-empty-cell">
                      &check; All inventory levels are healthy! No low stock alerts.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Orders */}
        <div className="table-widget-panel">
          <div className="widget-header">
            <div className="widget-title-group">
              <span className="widget-badge-gold">Orders</span>
              <h3>Recent Saree Orders</h3>
            </div>
            <Link href="/admin/orders" className="text-link">
              View All Orders &rarr;
            </Link>
          </div>

          <div className="table-responsive-wrapper">
            <table className="luxury-table">
              <thead>
                <tr>
                  <th>Order #</th>
                  <th>Channel</th>
                  <th>Amount</th>
                  <th>Payment</th>
                  <th>Status</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {recentOrders.length > 0 ? (
                  recentOrders.map((ord) => (
                    <tr key={ord.id}>
                      <td>
                        <Link
                          href={`/admin/orders/${ord.id}`}
                          className="order-link-bold"
                        >
                          #{ord.number}
                        </Link>
                      </td>
                      <td>
                        <span className="channel-tag">{ord.channel.toUpperCase()}</span>
                      </td>
                      <td className="money-cell">{money(ord.total_paise)}</td>
                      <td>
                        <span
                          className={`pill-status ${
                            ord.payment_status === "paid"
                              ? "status-paid"
                              : "status-pending"
                          }`}
                        >
                          {ord.payment_status}
                        </span>
                      </td>
                      <td>
                        <span className="status-label-cap">
                          {ord.status.replace("_", " ")}
                        </span>
                      </td>
                      <td className="date-cell">
                        {new Date(ord.created_at).toLocaleDateString("en-IN", {
                          month: "short",
                          day: "numeric",
                        })}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="table-empty-cell">
                      No customer orders placed yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Recent Stock Movements */}
        <div className="table-widget-panel full-width">
          <div className="widget-header">
            <div className="widget-title-group">
              <span className="widget-badge-neutral">Ledger</span>
              <h3>Recent Stock Movement Audit Trail</h3>
            </div>
            <Link href="/admin/inventory" className="text-link">
              Full Ledger &rarr;
            </Link>
          </div>

          <div className="table-responsive-wrapper">
            <table className="luxury-table">
              <thead>
                <tr>
                  <th>Product Saree</th>
                  <th>SKU</th>
                  <th>Adjustment (Delta)</th>
                  <th>Reason</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {recentMovements.length > 0 ? (
                  recentMovements.map((mov) => (
                    <tr key={mov.id}>
                      <td className="font-medium">
                        {mov.products?.name || "Silk Saree"}
                      </td>
                      <td>
                        <code>{mov.products?.sku || mov.product_id.slice(0, 8)}</code>
                      </td>
                      <td>
                        <span
                          className={`delta-badge ${
                            mov.delta > 0 ? "positive" : "negative"
                          }`}
                        >
                          {mov.delta > 0 ? `+${mov.delta}` : mov.delta} pcs
                        </span>
                      </td>
                      <td>{mov.reason}</td>
                      <td className="date-cell">
                        {new Date(mov.created_at).toLocaleString("en-IN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={5} className="table-empty-cell">
                      No stock movement ledger records recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}
