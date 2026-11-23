'use client';
import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { Profile, money } from '@/lib/core';
import { api } from '../api';
import { AdminSidebar } from '../admin/sidebar';
import { AdminTopbar } from '../admin/topbar';
import { Receipt } from './pos';

type Row = Record<string, any>;

export function POSBillingDashboard({ profile }: { profile: Profile }) {
  const [data, setData] = useState<Row | null>(null);
  const [catalog, setCatalog] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [selectedBill, setSelectedBill] = useState<Row | null>(null);
  const [sareeSearch, setSareeSearch] = useState('');

  async function loadData() {
    setLoading(true);
    try {
      const overviewRes = await api<Row>('/api/admin/overview');
      setData(overviewRes);
      setError('');
    } catch (e) {
      setError((e as Error).message || 'Failed to load cashier dashboard.');
    } finally {
      setLoading(false);
    }
  }

  async function loadCatalog() {
    try {
      const res = await api<Row>('/api/erp/pos');
      setCatalog(res.products || []);
    } catch {
      // non-blocking
    }
  }

  useEffect(() => {
    void loadData();
    void loadCatalog();
  }, []);

  const cashier = data?.cashier;
  const emp = cashier?.employee;
  const todayBills: Row[] = cashier?.todayBills || [];

  const filteredCatalog = useMemo(() => {
    if (!sareeSearch.trim()) return catalog.slice(0, 8);
    const q = sareeSearch.toLowerCase().trim();
    return catalog
      .filter(
        (p) =>
          String(p.name || '').toLowerCase().includes(q) ||
          String(p.sku || '').toLowerCase().includes(q) ||
          String(p.category || '').toLowerCase().includes(q) ||
          String(p.category_name || '').toLowerCase().includes(q) ||
          String(p.barcode || '').toLowerCase().includes(q),
      )
      .slice(0, 12);
  }, [catalog, sareeSearch]);

  const todayFormatted = new Date().toLocaleDateString('en-IN', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

  return (
    <div className="luxury-admin-shell">
      <AdminSidebar
        currentSection=""
        profile={profile}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />

      <div className="luxury-admin-viewport">
        <AdminTopbar
          section="dashboard"
          profile={profile}
          onOpenSidebar={() => setSidebarOpen(true)}
        />

        <main className="luxury-admin-main">
          {/* Cashier Welcome Hero */}
          <div className="dashboard-hero-header" style={{ marginBottom: 28 }}>
            <div className="hero-titles">
              <p className="hero-eyebrow">
                ✦ மகரந்தம் சில்க்ஸ் &middot; RETAIL POS COUNTER &middot; CASHIER DESK
              </p>
              <h1
                className="hero-main-title"
                style={{
                  fontFamily: 'var(--serif)',
                  fontSize: 32,
                  margin: '4px 0 8px',
                  color: '#FFFFFF',
                  letterSpacing: '-0.3px',
                }}
              >
                Cashier Billing Dashboard
              </h1>
              <p className="hero-meta-subtitle" style={{ fontSize: 14, color: '#FDE8D3' }}>
                <strong style={{ color: '#FFFFFF' }}>{emp?.name || profile.display_name || 'Cashier'}</strong>{' '}
                {emp?.code ? `(Staff Code: ${emp.code})` : ''} &middot;{' '}
                <span style={{ color: '#34D399', fontWeight: 600 }}>
                  ● Shift Active &amp; Ready
                </span>{' '}
                &middot; {todayFormatted}
              </p>
            </div>

            <div className="hero-actions" style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Link
                href="/admin/pos"
                className="button gold-btn"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 22px',
                  fontSize: 15,
                  fontWeight: 700,
                  boxShadow: '0 4px 12px rgba(196, 154, 82, 0.25)',
                }}
              >
                <span>⚡ Open POS Billing Register</span>
                <span aria-hidden="true">&rarr;</span>
              </Link>
              <Link href="/admin/expenses" className="button outline-btn">
                <span>💵 Record Shop Expense</span>
              </Link>
              <button
                type="button"
                className="button outline-btn"
                onClick={() => {
                  void loadData();
                  void loadCatalog();
                }}
                disabled={loading}
              >
                ↻ Refresh
              </button>
            </div>
          </div>

          {error && (
            <div role="alert" className="notice" style={{ marginBottom: 20 }}>
              {error}
            </div>
          )}

          {/* 6 Real-time Shift KPIs */}
          <section style={{ marginBottom: 32 }}>
            <h2
              style={{
                fontFamily: 'var(--serif)',
                fontSize: 20,
                color: 'var(--erp-maroon)',
                margin: '0 0 16px',
              }}
            >
              Today&apos;s Shift Collection &amp; Performance
            </h2>
            <div className="sp-kpi-grid">
              <div className="sp-kpi-card" style={{ borderLeft: '4px solid var(--erp-gold)' }}>
                <span>Today&apos;s Billed Revenue</span>
                <strong style={{ fontSize: 26, color: 'var(--erp-maroon)' }}>
                  {money(Number(cashier?.todayRevenuePaise || 0))}
                </strong>
                <small>Gross sales completed by you today</small>
              </div>

              <div className="sp-kpi-card" style={{ borderLeft: '4px solid #15803D' }}>
                <span>Bills Generated</span>
                <strong style={{ fontSize: 26, color: '#15803D' }}>
                  {cashier?.todayBillsCount ?? 0}
                </strong>
                <small>Receipts issued during this shift</small>
              </div>

              <div className="sp-kpi-card" style={{ borderLeft: '4px solid #0284C7' }}>
                <span>Cash in Drawer</span>
                <strong style={{ fontSize: 26, color: '#0284C7' }}>
                  {money(Number(cashier?.cashTendersPaise || 0))}
                </strong>
                <small>Physical cash tenders collected</small>
              </div>

              <div className="sp-kpi-card" style={{ borderLeft: '4px solid #7C3AED' }}>
                <span>UPI / Digital Received</span>
                <strong style={{ fontSize: 26, color: '#7C3AED' }}>
                  {money(Number(cashier?.upiTendersPaise || 0))}
                </strong>
                <small>QR / UPI direct payments</small>
              </div>

              <div className="sp-kpi-card" style={{ borderLeft: '4px solid #D97706' }}>
                <span>Card Swipes</span>
                <strong style={{ fontSize: 26, color: '#D97706' }}>
                  {money(Number(cashier?.cardTendersPaise || 0))}
                </strong>
                <small>Debit / Credit POS swipes</small>
              </div>

              <div className="sp-kpi-card" style={{ borderLeft: '4px solid var(--erp-maroon)' }}>
                <span>Sarees Sold Today</span>
                <strong style={{ fontSize: 26, color: 'var(--erp-maroon)' }}>
                  {cashier?.totalUnitsSold ?? 0}
                </strong>
                <small>Total saree units handed to customers</small>
              </div>
            </div>
          </section>

          {/* Quick Action Tiles */}
          <section style={{ marginBottom: 36 }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              <div
                style={{
                  background: '#FFFFFF',
                  border: '1px solid var(--erp-border)',
                  borderRadius: 12,
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 24 }}>⚡</span>
                    <strong style={{ fontSize: 17, color: 'var(--erp-maroon)' }}>
                      In-Store POS Register
                    </strong>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--erp-text-muted)' }}>
                    Scan sarees, apply discounts, choose split tender payment, and print 80mm GST
                    thermal receipts.
                  </p>
                </div>
                <div style={{ marginTop: 16 }}>
                  <Link href="/admin/pos" className="button gold-btn" style={{ width: '100%', textAlign: 'center' }}>
                    Open POS Register &rarr;
                  </Link>
                </div>
              </div>

              <div
                style={{
                  background: '#FFFFFF',
                  border: '1px solid var(--erp-border)',
                  borderRadius: 12,
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 24 }}>💵</span>
                    <strong style={{ fontSize: 17, color: 'var(--erp-maroon)' }}>
                      Counter Cash Expenses
                    </strong>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--erp-text-muted)' }}>
                    Record petty-cash vouchers for customer refreshments, tea, delivery, or shop
                    maintenance.
                  </p>
                </div>
                <div style={{ marginTop: 16 }}>
                  <Link href="/admin/expenses" className="button outline-btn" style={{ width: '100%', textAlign: 'center' }}>
                    Record Expense &rarr;
                  </Link>
                </div>
              </div>

              <div
                style={{
                  background: '#FFFFFF',
                  border: '1px solid var(--erp-border)',
                  borderRadius: 12,
                  padding: 20,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                    <span style={{ fontSize: 24 }}>📋</span>
                    <strong style={{ fontSize: 17, color: 'var(--erp-maroon)' }}>
                      Today&apos;s Roll Call Status
                    </strong>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--erp-text-muted)' }}>
                    Roll call record: <strong>{cashier?.attendanceStatus || 'Marked Present'}</strong>.
                    Working shift: {emp?.daily_minutes ? `${emp.daily_minutes / 60} hrs scheduled` : 'Full Day'}.
                  </p>
                </div>
                <div style={{ marginTop: 16 }}>
                  <span
                    className="pill-status status-paid"
                    style={{ display: 'inline-block', width: '100%', textAlign: 'center', padding: '8px 12px' }}
                  >
                    ✓ Checked In for Today&apos;s Shift
                  </span>
                </div>
              </div>
            </div>
          </section>

          {/* Today's Billed Receipts Table */}
          <section style={{ marginBottom: 36 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <h2
                  style={{
                    fontFamily: 'var(--serif)',
                    fontSize: 22,
                    color: 'var(--erp-maroon)',
                    margin: 0,
                  }}
                >
                  Today&apos;s Issued Bills ({todayBills.length})
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--erp-text-muted)' }}>
                  All sales processed by you during today&apos;s shift. Click any bill to reprint
                  thermal receipt.
                </p>
              </div>

              <Link href="/admin/pos" className="button mini-btn">
                + New Customer Bill
              </Link>
            </div>

            {todayBills.length > 0 ? (
              <div className="table-widget-panel">
                <div className="table-responsive-wrapper">
                  <table className="luxury-table">
                    <thead>
                      <tr>
                        <th>Invoice / Bill No</th>
                        <th>Customer</th>
                        <th>Sarees Billed</th>
                        <th className="money-cell">Total (₹)</th>
                        <th>Payment Mode</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {todayBills.map((b) => {
                        const billItems = Array.isArray(b.items) ? b.items : [];
                        const tenders = Array.isArray(b.tenders) ? b.tenders : [];
                        const payModes = tenders.length
                          ? tenders
                              .map((t: any) => String(t.method || '').toUpperCase())
                              .join(' + ')
                          : 'CASH';

                        return (
                          <tr key={b.id}>
                            <td>
                              <strong style={{ color: 'var(--erp-maroon)', fontSize: 14 }}>
                                {b.invoice_no}
                              </strong>
                              <small
                                style={{
                                  display: 'block',
                                  color: 'var(--erp-text-muted)',
                                  marginTop: 2,
                                }}
                              >
                                {new Date(b.created_at).toLocaleTimeString('en-IN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  timeZone: 'Asia/Kolkata',
                                })}
                              </small>
                            </td>

                            <td>
                              <strong>{b.customer_name || 'Walk-in Customer'}</strong>
                              {b.customer_phone && (
                                <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                                  {b.customer_phone}
                                </small>
                              )}
                            </td>

                            <td>
                              {billItems.length > 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                                  {billItems.map((it: any, idx: number) => (
                                    <span key={idx} style={{ fontSize: 13 }}>
                                      <strong style={{ color: 'var(--erp-maroon)' }}>
                                        {it.name}
                                      </strong>
                                      <span style={{ color: 'var(--erp-text-muted)' }}>
                                        {' '}
                                        &times; {it.quantity}
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              ) : (
                                '—'
                              )}
                            </td>

                            <td className="money-cell">
                              <strong style={{ fontSize: 14 }}>{money(b.total_paise)}</strong>
                              {Number(b.discount_paise || 0) > 0 && (
                                <small style={{ display: 'block', color: '#15803D' }}>
                                  Disc: &minus;{money(Number(b.discount_paise))}
                                </small>
                              )}
                            </td>

                            <td>
                              <span
                                style={{
                                  fontWeight: 600,
                                  fontSize: 12,
                                  color: 'var(--erp-text)',
                                  background: 'var(--erp-ivory-warm)',
                                  padding: '3px 8px',
                                  borderRadius: 4,
                                  border: '1px solid var(--erp-border)',
                                }}
                              >
                                {payModes}
                              </span>
                            </td>

                            <td>
                              <span
                                className={`pill-status ${
                                  b.status === 'completed' ? 'status-paid' : 'status-pending'
                                }`}
                                style={{ fontSize: 11 }}
                              >
                                {b.status}
                              </span>
                            </td>

                            <td>
                              <button
                                type="button"
                                className="button outline-btn mini-btn"
                                onClick={() => setSelectedBill(b)}
                              >
                                🖨️ Reprint Bill
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div
                style={{
                  background: '#FFFFFF',
                  border: '1px dashed var(--erp-border)',
                  borderRadius: 12,
                  padding: '40px 20px',
                  textAlign: 'center',
                }}
              >
                <div style={{ fontSize: 36, marginBottom: 12 }}>🧾</div>
                <h3
                  style={{
                    fontFamily: 'var(--serif)',
                    fontSize: 20,
                    margin: '0 0 6px',
                    color: 'var(--erp-maroon)',
                  }}
                >
                  No Bills Issued Yet for this Shift
                </h3>
                <p style={{ margin: '0 0 16px', color: 'var(--erp-text-muted)', fontSize: 14 }}>
                  Launch the POS register to start billing walk-in customers and print receipts.
                </p>
                <Link href="/admin/pos" className="button gold-btn">
                  Open POS Register Now &rarr;
                </Link>
              </div>
            )}
          </section>

          {/* Quick Live Saree Catalogue & Stock Lookup */}
          <section style={{ marginBottom: 32 }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 12,
                marginBottom: 16,
              }}
            >
              <div>
                <h2
                  style={{
                    fontFamily: 'var(--serif)',
                    fontSize: 22,
                    color: 'var(--erp-maroon)',
                    margin: 0,
                  }}
                >
                  Live Saree Price &amp; Stock Lookup
                </h2>
                <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--erp-text-muted)' }}>
                  Search live in-store stock and pricing to answer customer inquiries at the counter.
                </p>
              </div>

              <div className="datatable-search-box" style={{ minWidth: 280 }}>
                <span className="search-symbol">🔍</span>
                <input
                  type="search"
                  value={sareeSearch}
                  onChange={(e) => setSareeSearch(e.target.value)}
                  placeholder="Search by saree name, SKU, or category..."
                  className="datatable-search-input"
                />
              </div>
            </div>

            {filteredCatalog.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
                  gap: 16,
                }}
              >
                {filteredCatalog.map((p) => {
                  const stock = Number(p.stock_on_hand ?? 0);
                  const inStock = stock > 0;

                  return (
                    <div
                      key={p.id}
                      style={{
                        background: '#FFFFFF',
                        border: '1px solid var(--erp-border)',
                        borderRadius: 10,
                        padding: 14,
                        display: 'flex',
                        gap: 14,
                        alignItems: 'center',
                      }}
                    >
                      <img
                        src={p.image_path || '/assets/brand-logo.png'}
                        alt={p.name}
                        style={{
                          width: 58,
                          height: 58,
                          borderRadius: 8,
                          objectFit: 'cover',
                          background: 'var(--erp-ivory-warm)',
                          border: '1px solid var(--erp-border)',
                        }}
                      />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <strong
                          style={{
                            display: 'block',
                            fontSize: 14,
                            color: 'var(--erp-maroon)',
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {p.name}
                        </strong>
                        <small
                          style={{
                            display: 'block',
                            color: 'var(--erp-text-muted)',
                            fontSize: 11,
                          }}
                        >
                          {p.category_name || p.category || 'Saree'} &middot; {p.sku}
                        </small>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            marginTop: 6,
                          }}
                        >
                          <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--erp-gold)' }}>
                            {money(p.price_paise)}
                          </span>
                          <span
                            className={`pill-status ${inStock ? 'status-paid' : 'status-pending'}`}
                            style={{ fontSize: 10, padding: '2px 7px' }}
                          >
                            {inStock ? `${stock} in stock` : 'Out of Stock'}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div
                style={{
                  background: '#FFFFFF',
                  border: '1px dashed var(--erp-border)',
                  borderRadius: 10,
                  padding: '30px 20px',
                  textAlign: 'center',
                  color: 'var(--erp-text-muted)',
                  fontSize: 14,
                }}
              >
                No sarees match &quot;{sareeSearch}&quot;.
              </div>
            )}
          </section>
        </main>
      </div>

      {/* Bill Reprint Dialog */}
      {selectedBill && (
        <div
          role="dialog"
          aria-modal="true"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.5)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => setSelectedBill(null)}
        >
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 12,
              padding: 24,
              maxWidth: 420,
              width: '100%',
              maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 16,
              }}
            >
              <h3 style={{ margin: 0, fontFamily: 'var(--serif)', color: 'var(--erp-maroon)' }}>
                Receipt &mdash; {selectedBill.invoice_no}
              </h3>
              <button
                type="button"
                onClick={() => setSelectedBill(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 20,
                  cursor: 'pointer',
                  color: 'var(--erp-text-muted)',
                }}
              >
                &times;
              </button>
            </div>

            <div
              style={{
                border: '1px solid var(--erp-border)',
                borderRadius: 8,
                padding: 16,
                background: '#FFFDF9',
                marginBottom: 20,
              }}
            >
              <Receipt sale={selectedBill} />
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button
                type="button"
                className="button outline-btn"
                onClick={() => setSelectedBill(null)}
              >
                Close
              </button>
              <button
                type="button"
                className="button gold-btn"
                onClick={() => window.print()}
              >
                🖨️ Print Receipt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
