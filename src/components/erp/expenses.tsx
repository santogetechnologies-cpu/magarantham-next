'use client';

import { useEffect, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { money, Profile } from '@/lib/core';
import { indiaDate } from '@/lib/barcode';
import { api } from '../api';
import { References, Row, useERP, downloadCSV } from './shared';

export function Expenses({
  refs,
  profile,
}: {
  refs: References;
  profile?: Profile;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [voiding, setVoiding] = useState<Row | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCat, setSelectedCat] = useState('all');
  const [selectedMethod, setSelectedMethod] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'pending' | 'posted' | 'rejected' | 'void'>('all');
  const [rejecting, setRejecting] = useState<Row | null>(null);
  const isOwner = profile?.role === 'superadmin';
  const [showLogForm, setShowLogForm] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [statusModalRow, setStatusModalRow] = useState<Row | null>(null);
  const [targetStatus, setTargetStatus] = useState<'posted' | 'pending' | 'rejected' | 'void'>('posted');
  const [statusReason, setStatusReason] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  function openStatusModal(row: Row, defaultStatus?: 'posted' | 'pending' | 'rejected' | 'void') {
    setStatusModalRow(row);
    setTargetStatus(defaultStatus || (row.status === 'void' ? 'posted' : (row.status as any) || 'posted'));
    setStatusReason(defaultStatus === 'void' ? (row.void_reason || '') : (row.review_note || ''));
  }

  async function handleSaveStatus(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!statusModalRow) return;
    if (targetStatus === 'void' && statusReason.trim().length < 3) {
      notice('Please provide a void reason (at least 3 characters).');
      return;
    }
    const res = await send(
      'expense_status',
      {
        id: statusModalRow.id,
        status: targetStatus,
        reason: statusReason.trim(),
      },
      load
    );
    if (res) {
      setStatusModalRow(null);
      setStatusReason('');
    }
  }

  async function handleQuickStatus(row: Row, status: 'posted' | 'pending' | 'rejected' | 'void', defaultReason?: string) {
    if (status === 'void') {
      openStatusModal(row, 'void');
      return;
    }
    await send(
      'expense_status',
      {
        id: row.id,
        status,
        reason: defaultReason || (status === 'posted' ? 'Approved by Admin' : 'Updated by Admin'),
      },
      load
    );
  }

  const { busy, send, notice } = useERP();

  async function load(page = 0) {
    try {
      const r = await api<Row>(`/api/erp/expenses?page=${page}`);
      setRows((old) => (page === 0 ? r.rows : [...old, ...r.rows]));
      setNext(r.nextPage);
    } catch (e) {
      notice((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  // Summary Metrics calculations
  const stats = useMemo(() => {
    const active = rows.filter((r) => r.status === 'posted');
    const totalAmountPaise = active.reduce((acc, r) => acc + (Number(r.amount_paise) || 0), 0);
    const cashPaise = active
      .filter((r) => r.method === 'cash')
      .reduce((acc, r) => acc + (Number(r.amount_paise) || 0), 0);
    const nonCashPaise = active
      .filter((r) => r.method !== 'cash')
      .reduce((acc, r) => acc + (Number(r.amount_paise) || 0), 0);
    const voidCount = rows.filter((r) => r.status === 'void').length;

    return {
      totalPaise: totalAmountPaise,
      cashPaise,
      nonCashPaise,
      postedCount: active.length,
      voidCount,
    };
  }, [rows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return rows.filter((r) => {
      // Category filter
      if (selectedCat !== 'all' && r.category_id !== selectedCat) return false;
      // Method filter
      if (selectedMethod !== 'all' && r.method !== selectedMethod) return false;
      // Status filter
      if (selectedStatus !== 'all' && r.status !== selectedStatus) return false;
      // Search term
      if (searchTerm.trim()) {
        const q = searchTerm.toLowerCase();
        const catName = refs.expense_categories?.find((c) => c.id === r.category_id)?.name?.toLowerCase() || '';
        const desc = (r.description || '').toLowerCase();
        const payee = (r.payee || '').toLowerCase();
        const ref = (r.reference || '').toLowerCase();
        const createdBy = (r.created_by_name || '').toLowerCase();
        const code = (r.created_by_code || '').toLowerCase();
        const role = (r.created_by_role || '').toLowerCase();

        return (
          desc.includes(q) ||
          payee.includes(q) ||
          ref.includes(q) ||
          catName.includes(q) ||
          createdBy.includes(q) ||
          code.includes(q) ||
          role.includes(q)
        );
      }
      return true;
    });
  }, [rows, selectedCat, selectedMethod, selectedStatus, searchTerm, refs.expense_categories]);

  function formatTime(isoString?: string) {
    if (!isoString) return '';
    try {
      const d = new Date(isoString);
      return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    } catch {
      return '';
    }
  }

  function handleExportCSV() {
    const headers = [
      'Expense Date',
      'Category',
      'Description',
      'Payee / Shop',
      'Amount (Rs)',
      'Payment Method',
      'Reference No',
      'Recorded By (User)',
      'Staff Code',
      'Staff Role / Designation',
      'Recorded At',
      'Status',
      'Source',
      'Voided By',
      'Void Reason',
    ];

    const data = filteredRows.map((r) => [
      r.expense_on,
      refs.expense_categories?.find((c) => c.id === r.category_id)?.name || 'General',
      r.description,
      r.payee || '—',
      (Number(r.amount_paise) || 0) / 100,
      r.method,
      r.reference || '—',
      r.created_by_name || 'Admin',
      r.created_by_code || '—',
      r.created_by_designation || r.created_by_role || 'Staff',
      r.created_at ? new Date(r.created_at).toLocaleString('en-IN') : '—',
      r.status,
      r.source,
      r.void_by_name || '—',
      r.void_reason || '—',
    ]);

    downloadCSV('shop-expenses-with-creator.csv', [headers, ...data]);
  }

  return (
    <div className="erp-module sp-premium-root">
      {/* Top Header & Actions */}
      <div className="sp-premium-header" style={{ marginBottom: 20 }}>
        <div>
          <h2 style={{ fontFamily: 'var(--serif)', fontSize: 26, margin: 0, color: 'var(--erp-maroon)' }}>
            Shop Operating Expenses &amp; Petty Cash
          </h2>
          <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--erp-text-muted)' }}>
            Record counter petty-cash, vendor payouts, and audit exactly which staff member created each expense.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <button
            type="button"
            className="button sp-btn-maroon"
            onClick={() => setShowLogForm((prev) => !prev)}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontWeight: 600 }}
          >
            <span>{showLogForm ? '✕ Close Form' : '+ Log New Expense'}</span>
          </button>
        </div>
      </div>

      {/* 4 Summary Cards */}
      <div className="sp-stats-grid" style={{ marginBottom: 24 }}>
        <div className="sp-stat-card">
          <div className="sp-stat-info">
            <span className="sp-stat-label">Total Outflow (Active)</span>
            <strong className="sp-stat-value" style={{ color: 'var(--erp-maroon)' }}>
              {money(stats.totalPaise)}
            </strong>
            <span className="sp-stat-subtext">{stats.postedCount} posted transactions</span>
          </div>
          <div className="sp-stat-icon-wrap tone-total" style={{ background: '#FFF1F2', color: '#9F1239' }}>
            <span style={{ fontSize: 20 }}>💰</span>
          </div>
        </div>

        <div className="sp-stat-card">
          <div className="sp-stat-info">
            <span className="sp-stat-label">Cash Counter Outflow</span>
            <strong className="sp-stat-value" style={{ color: '#15803D' }}>
              {money(stats.cashPaise)}
            </strong>
            <span className="sp-stat-subtext">Direct drawer petty cash</span>
          </div>
          <div className="sp-stat-icon-wrap tone-active" style={{ background: '#F0FDF4', color: '#166534' }}>
            <span style={{ fontSize: 20 }}>💵</span>
          </div>
        </div>

        <div className="sp-stat-card">
          <div className="sp-stat-info">
            <span className="sp-stat-label">UPI / Bank / Card</span>
            <strong className="sp-stat-value" style={{ color: '#7C3AED' }}>
              {money(stats.nonCashPaise)}
            </strong>
            <span className="sp-stat-subtext">Digital &amp; voucher payments</span>
          </div>
          <div className="sp-stat-icon-wrap tone-depts" style={{ background: '#FAF5FF', color: '#6B21A8' }}>
            <span style={{ fontSize: 20 }}>📱</span>
          </div>
        </div>

        <div className="sp-stat-card">
          <div className="sp-stat-info">
            <span className="sp-stat-label">Total Logged / Audited</span>
            <strong className="sp-stat-value" style={{ color: '#0369A1' }}>
              {rows.length}
            </strong>
            <span className="sp-stat-subtext">{stats.voidCount} voided entries</span>
          </div>
          <div className="sp-stat-icon-wrap tone-present" style={{ background: '#F0F9FF', color: '#0369A1' }}>
            <span style={{ fontSize: 20 }}>📋</span>
          </div>
        </div>
      </div>

      {/* Log An Expense Collapsible Card */}
      {showLogForm && (
        <form
          className="form-panel"
          style={{
            marginBottom: 24,
            background: '#FFFFFF',
            border: '1.5px solid var(--erp-gold, #C49A52)',
            borderRadius: 12,
            padding: 24,
            boxShadow: '0 4px 16px rgba(128, 0, 32, 0.06)',
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const amountVal = Number(f.get('amount'));
            if (!amountVal || amountVal <= 0) {
              notice('Please enter a valid expense amount.');
              return;
            }
            const res = await send(
              'expenses',
              {
                data: {
                  category_id: f.get('category_id'),
                  expense_on: f.get('expense_on'),
                  description: f.get('description'),
                  amount_paise: Math.round(amountVal * 100),
                  method: f.get('method'),
                  reference: f.get('reference'),
                  payee: f.get('payee'),
                },
              },
              load
            );
            if (res) {
              setShowLogForm(false);
            }
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <h3 style={{ fontFamily: 'var(--serif)', margin: 0, color: 'var(--erp-maroon)', fontSize: 20 }}>
              + Record New Counter Expense
            </h3>
            {profile && (
              <span
                style={{
                  fontSize: 12,
                  background: '#FAF5EE',
                  color: 'var(--erp-maroon)',
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid #EAD5C0',
                  fontWeight: 600,
                }}
              >
                👤 Logged by: {profile.display_name || profile.email} ({profile.role.toUpperCase()})
              </span>
            )}
          </div>

          <div className="form-grid">
            <label>
              Expense Category *
              <select name="category_id" required defaultValue="">
                <option value="">Select category</option>
                {refs.expense_categories
                  ?.filter((c) => c.active)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
              </select>
            </label>

            <label>
              Expense Date *
              <input name="expense_on" type="date" defaultValue={indiaDate()} required />
            </label>

            <label>
              Amount Paid (₹) *
              <input
                name="amount"
                type="number"
                min="0.01"
                step="0.01"
                placeholder="e.g. 150.00"
                required
              />
            </label>

            <label>
              Payment Method *
              <select name="method" defaultValue="cash">
                {['cash', 'upi', 'card', 'bank'].map((m) => (
                  <option key={m} value={m}>
                    {m.toUpperCase()}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Payee / Shop / Vendor (Optional)
              <input name="payee" maxLength={120} placeholder="e.g. Sri Murugan Tea Stall, Electricals" />
            </label>

            <label>
              Payment Reference (Required for non-cash)
              <input
                name="reference"
                maxLength={100}
                placeholder="e.g. UPI Ref / Cheque No / Voucher ID"
              />
            </label>

            <label style={{ gridColumn: '1 / -1' }}>
              Description / Purpose *
              <input
                name="description"
                maxLength={500}
                placeholder="e.g. Customer refreshments, tea & biscuits during festive rush"
                required
              />
            </label>
          </div>

          <p className="subtle" style={{ margin: '12px 0 16px', fontSize: 12 }}>
            💡 Non-cash payments (UPI, Card, Bank) require a reference of at least 6 characters. The current user account will be permanently audited as the creator of this record.
          </p>

          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button className="button sp-btn-maroon" disabled={busy} type="submit">
              {busy ? 'Saving...' : '✓ Save & Post Expense'}
            </button>
            <button
              type="button"
              className="button button-outline"
              onClick={() => setShowLogForm(false)}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Approval queue: staff expenses wait here until the owner approves them */}
      {(() => {
        const pending = rows.filter((r) => r.status === 'pending');
        if (!pending.length) return null;
        const total = pending.reduce((t, r) => t + Number(r.amount_paise || 0), 0);
        if (!isOwner)
          return (
            <div className="ms-callout" style={{ marginBottom: 16 }}>
              <span className="ms-callout-icon" aria-hidden="true">⏳</span>
              <div>
                <strong>{pending.length} expense{pending.length === 1 ? '' : 's'} waiting for approval</strong> ({money(total)}). They count in
                reports once the owner approves them.
              </div>
            </div>
          );
        return (
          <section className="ms-card ex-approvals" style={{ marginBottom: 16 }}>
            <div className="ms-card-head">
              <div>
                <h2>Waiting for your approval</h2>
                <p>{pending.length} staff expense{pending.length === 1 ? '' : 's'} · {money(total)}. Approved expenses count in reports; rejected ones never do.</p>
              </div>
              <button
                type="button"
                className="ms-btn ms-btn-primary ms-btn-sm"
                disabled={busy}
                onClick={async () => {
                  if (!window.confirm(`Approve all ${pending.length} expenses (${money(total)})?`)) return;
                  for (const r of pending) await send('expense_review', { id: r.id, action: 'approve', note: '' });
                  await load();
                }}
              >
                Approve all
              </button>
            </div>
            <div className="ex-approval-list">
              {pending.map((r) => (
                <div key={r.id} className="ex-approval">
                  <div>
                    <strong>{r.description}</strong>
                    <small>
                      {refs.expense_categories?.find((c) => c.id === r.category_id)?.name || 'General'} · {r.expense_on} · {String(r.method).toUpperCase()}
                      {r.reference ? ` · Ref ${r.reference}` : ''}{r.payee ? ` · Paid to ${r.payee}` : ''} · by {r.created_by_name || 'staff'}
                    </small>
                  </div>
                  <b>{money(r.amount_paise)}</b>
                  <div className="ex-approval-actions">
                    <button type="button" className="ms-btn ms-btn-primary ms-btn-sm" disabled={busy} onClick={() => send('expense_review', { id: r.id, action: 'approve', note: '' }, load)}>Approve</button>
                    <button type="button" className="ms-btn ms-btn-danger-ghost ms-btn-sm" disabled={busy} onClick={() => setRejecting(r)}>Reject</button>
                  </div>
                </div>
              ))}
            </div>
            {rejecting && (
              <form
                className="ex-reject"
                onSubmit={async (e) => {
                  e.preventDefault();
                  const note = String(new FormData(e.currentTarget).get('note') || '');
                  if (await send('expense_review', { id: rejecting.id, action: 'reject', note }, load)) setRejecting(null);
                }}
              >
                <label className="ms-field">
                  <span>Why reject “{rejecting.description}” ({money(rejecting.amount_paise)})?</span>
                  <input name="note" required minLength={3} maxLength={300} placeholder="e.g. No bill attached" autoFocus />
                </label>
                <div className="ex-approval-actions">
                  <button className="ms-btn ms-btn-danger-ghost ms-btn-sm" disabled={busy}>Reject expense</button>
                  <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => setRejecting(null)}>Cancel</button>
                </div>
              </form>
            )}
          </section>
        );
      })()}

      {/* Filter and Search Toolbar */}
      <div
        className="sp-toolbar"
        style={{
          display: 'flex',
          gap: 10,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          background: '#FFFFFF',
          padding: '10px 14px',
          borderRadius: 8,
          border: '1px solid var(--erp-border, #EAD5C0)',
        }}
      >
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', flex: 1 }}>
          <input
            type="text"
            placeholder="Search description, payee, ref, or staff..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            style={{
              flex: '1 1 200px',
              minWidth: 160,
              padding: '7px 10px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid #D4B99F',
              background: '#FAF7F2',
            }}
          />

          <select
            value={selectedCat}
            onChange={(e) => setSelectedCat(e.target.value)}
            style={{
              padding: '7px 10px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid #D4B99F',
              background: '#FAF7F2',
              color: 'var(--erp-text)',
            }}
          >
            <option value="all">All Categories</option>
            {refs.expense_categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>

          <select
            value={selectedMethod}
            onChange={(e) => setSelectedMethod(e.target.value)}
            style={{
              padding: '7px 10px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid #D4B99F',
              background: '#FAF7F2',
              color: 'var(--erp-text)',
            }}
          >
            <option value="all">All Payment Methods</option>
            <option value="cash">Cash</option>
            <option value="upi">UPI</option>
            <option value="card">Card</option>
            <option value="bank">Bank</option>
          </select>

          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            style={{
              padding: '7px 10px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid #D4B99F',
              background: '#FAF7F2',
              color: 'var(--erp-text)',
            }}
          >
            <option value="all">All Statuses</option>
            <option value="pending">Waiting approval</option>
            <option value="posted">Posted</option>
            <option value="rejected">Rejected</option>
            <option value="void">Void</option>
          </select>
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button
            type="button"
            className="text-link"
            onClick={() => void load()}
            style={{ fontSize: 13, fontWeight: 600 }}
          >
            ↻ Refresh
          </button>
          <span style={{ color: '#D4B99F' }}>|</span>
          <button
            type="button"
            className="button button-outline"
            onClick={handleExportCSV}
            style={{ fontSize: 12, padding: '5px 10px' }}
          >
            📥 Export CSV
          </button>
        </div>
      </div>

      {/* Expenses Table with Creator Information */}
      <div
        className="data-table"
        style={{
          background: '#FFFFFF',
          borderRadius: 12,
          border: '1px solid var(--erp-border, #EAD5C0)',
          overflowX: 'auto',
          boxShadow: '0 2px 8px rgba(128, 0, 32, 0.03)',
        }}
      >
        <table style={{ width: '100%', minWidth: 980, borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: '#F8EFE4', borderBottom: '1.5px solid #E5D0B8' }}>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)', minWidth: 140, whiteSpace: 'nowrap' }}>
                DATE / CATEGORY
              </th>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)', minWidth: 180, whiteSpace: 'nowrap' }}>
                DESCRIPTION &amp; PAYEE
              </th>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)', minWidth: 105, whiteSpace: 'nowrap' }}>
                AMOUNT
              </th>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)', minWidth: 125, whiteSpace: 'nowrap' }}>
                PAYMENT METHOD
              </th>
              {/* Simplified Clean Creator Column */}
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)', minWidth: 140, whiteSpace: 'nowrap' }}>
                RECORDED BY
              </th>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)', minWidth: 130, whiteSpace: 'nowrap' }}>
                STATUS
              </th>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)', textAlign: 'right', minWidth: 110, whiteSpace: 'nowrap' }}>
                ACTION
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ textAlign: 'center', padding: '36px 16px', color: 'var(--erp-text-muted)' }}>
                  No expense records match your filter criteria.
                </td>
              </tr>
            ) : (
              filteredRows.map((r) => {
                const catName =
                  refs.expense_categories?.find((c) => c.id === r.category_id)?.name || 'General';
                const creatorName = r.created_by_name || 'Admin';
                const creatorCode = r.created_by_code || '';
                const isVoid = r.status === 'void';

                return (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid #F1E5D8',
                      background: isVoid ? '#FAF9F8' : '#FFFFFF',
                      opacity: isVoid ? 0.85 : 1,
                    }}
                  >
                    {/* Date / Category */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                      <strong style={{ fontSize: 13, color: 'var(--erp-text)', display: 'block' }}>
                        {r.expense_on}
                      </strong>
                      <span
                        style={{
                          display: 'inline-block',
                          marginTop: 4,
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 4,
                          background: '#FAF2E6',
                          color: 'var(--erp-maroon)',
                          border: '1px solid #E8D3BD',
                        }}
                      >
                        {catName}
                      </span>
                    </td>

                    {/* Description & Payee */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'middle', maxWidth: 280 }}>
                      <strong
                        style={{
                          fontSize: 13.5,
                          color: isVoid ? '#6B7280' : 'var(--erp-text)',
                          textDecoration: isVoid ? 'line-through' : 'none',
                          display: 'block',
                        }}
                      >
                        {r.description}
                      </strong>
                      {r.payee && (
                        <small style={{ display: 'block', color: 'var(--erp-text-muted)', marginTop: 2 }}>
                          Payee: <strong>{r.payee}</strong>
                        </small>
                      )}
                    </td>

                    {/* Amount */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'middle', whiteSpace: 'nowrap' }}>
                      <strong
                        style={{
                          fontSize: 15,
                          color: isVoid ? '#6B7280' : 'var(--erp-maroon)',
                          fontWeight: 700,
                        }}
                      >
                        {money(r.amount_paise)}
                      </strong>
                    </td>

                    {/* Payment Method & Reference */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: 11,
                          fontWeight: 700,
                          textTransform: 'uppercase',
                          padding: '2px 7px',
                          borderRadius: 4,
                          background:
                            r.method === 'cash'
                              ? '#DCFCE7'
                              : r.method === 'upi'
                              ? '#F3E8FF'
                              : r.method === 'card'
                              ? '#FEF3C7'
                              : '#E0F2FE',
                          color:
                            r.method === 'cash'
                              ? '#15803D'
                              : r.method === 'upi'
                              ? '#7E22CE'
                              : r.method === 'card'
                              ? '#B45309'
                              : '#0369A1',
                        }}
                      >
                        {r.method}
                      </span>
                      {r.reference && (
                        <small
                          style={{
                            display: 'block',
                            fontFamily: 'monospace',
                            fontSize: 11,
                            color: 'var(--erp-text-muted)',
                            marginTop: 4,
                          }}
                        >
                          Ref: {r.reference}
                        </small>
                      )}
                    </td>

                    {/* RECORDED BY - Easy & Simple */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                      <strong
                        style={{
                          fontSize: 13.5,
                          color: 'var(--erp-maroon)',
                          display: 'block',
                          lineHeight: 1.2,
                        }}
                      >
                        {creatorName}
                      </strong>
                      {creatorCode && (
                        <small
                          style={{
                            display: 'block',
                            fontSize: 11,
                            color: 'var(--erp-text-muted)',
                            marginTop: 2,
                          }}
                        >
                          {creatorCode}
                        </small>
                      )}
                    </td>

                    {/* STATUS - Interactive for Admin, clear badge for staff */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'middle' }}>
                      {isOwner && r.source === 'manual' ? (
                        <button
                          type="button"
                          onClick={() => openStatusModal(r)}
                          title="Admin: Click to change status"
                          style={{
                            background: 'none',
                            border: 'none',
                            padding: 0,
                            cursor: 'pointer',
                            textAlign: 'left',
                            display: 'inline-flex',
                            flexDirection: 'column',
                            alignItems: 'flex-start',
                          }}
                        >
                          {r.status === 'pending' || r.status === 'rejected' ? (
                            <span
                              className={`ms-badge ${r.status === 'pending' ? 'ms-badge-warn' : 'ms-badge-off'}`}
                              style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4 }}
                            >
                              {r.status === 'pending' ? 'Waiting approval' : 'Rejected'}
                              <span style={{ fontSize: 10, opacity: 0.7 }}>✎</span>
                            </span>
                          ) : isVoid ? (
                            <div>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: '#FEE2E2',
                                  color: '#991B1B',
                                }}
                                title={r.void_reason ? `Reason: ${r.void_reason}` : undefined}
                              >
                                Void
                                <span style={{ fontSize: 10, opacity: 0.7 }}>✎</span>
                              </span>
                              {r.void_by_name && (
                                <small
                                  style={{
                                    display: 'block',
                                    fontSize: 11,
                                    color: '#991B1B',
                                    marginTop: 2,
                                  }}
                                >
                                  by {r.void_by_name}
                                </small>
                              )}
                            </div>
                          ) : (
                            <div>
                              <span
                                style={{
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 4,
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: '#DCFCE7',
                                  color: '#166534',
                                }}
                              >
                                Posted
                                <span style={{ fontSize: 10, opacity: 0.7 }}>✎</span>
                              </span>
                              {r.reviewed_by_name && r.created_by_role === 'billing' && (
                                <small style={{ display: 'block', fontSize: 11, color: '#166534', marginTop: 2 }}>
                                  appr. by {r.reviewed_by_name}
                                </small>
                              )}
                            </div>
                          )}
                          {r.status === 'rejected' && r.review_note && (
                            <small className="ex-note" style={{ marginTop: 2 }}>{r.review_note}</small>
                          )}
                        </button>
                      ) : (
                        <div>
                          {r.status === 'pending' || r.status === 'rejected' ? (
                            <span className={`ms-badge ${r.status === 'pending' ? 'ms-badge-warn' : 'ms-badge-off'}`} title={r.review_note || undefined}>
                              {r.status === 'pending' ? 'Waiting approval' : 'Rejected'}
                            </span>
                          ) : isVoid ? (
                            <div>
                              <span
                                style={{
                                  display: 'inline-block',
                                  fontSize: 11,
                                  fontWeight: 700,
                                  padding: '2px 8px',
                                  borderRadius: 4,
                                  background: '#FEE2E2',
                                  color: '#991B1B',
                                }}
                                title={r.void_reason ? `Reason: ${r.void_reason}` : undefined}
                              >
                                Void
                              </span>
                              {r.void_by_name && (
                                <small
                                  style={{
                                    display: 'block',
                                    fontSize: 11,
                                    color: '#991B1B',
                                    marginTop: 2,
                                  }}
                                >
                                  by {r.void_by_name}
                                </small>
                              )}
                            </div>
                          ) : (
                            <span
                              style={{
                                display: 'inline-block',
                                fontSize: 11,
                                fontWeight: 700,
                                padding: '2px 8px',
                                borderRadius: 4,
                                background: '#DCFCE7',
                                color: '#166534',
                              }}
                            >
                              Posted
                            </span>
                          )}
                          {r.status === 'rejected' && r.review_note && <small className="ex-note">{r.review_note}</small>}
                        </div>
                      )}
                    </td>

                    {/* Action - Admin has status controls, staff sees — */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'middle', textAlign: 'right' }}>
                      {!isOwner ? (
                        <span style={{ color: 'var(--erp-text-muted)', fontSize: 13 }}>—</span>
                      ) : r.source !== 'manual' ? (
                        <small style={{ color: 'var(--erp-text-muted)', fontSize: 11 }}>Payroll</small>
                      ) : (
                        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'nowrap' }}>
                          {r.status === 'void' && (
                            <button
                              type="button"
                              className="button"
                              onClick={() => handleQuickStatus(r, 'posted', 'Reinstated by Admin')}
                              disabled={busy}
                              style={{
                                fontSize: 12,
                                padding: '4px 9px',
                                background: '#166534',
                                color: '#FFFFFF',
                                border: 'none',
                                borderRadius: 5,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                              title="Reinstate this voided expense back to Posted"
                            >
                              ✓ Reinstate
                            </button>
                          )}

                          {r.status === 'pending' && (
                            <>
                              <button
                                type="button"
                                className="button"
                                onClick={() => handleQuickStatus(r, 'posted', 'Approved by Admin')}
                                disabled={busy}
                                style={{
                                  fontSize: 12,
                                  padding: '4px 9px',
                                  background: '#166534',
                                  color: '#FFFFFF',
                                  border: 'none',
                                  borderRadius: 5,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                }}
                                title="Approve expense"
                              >
                                ✓ Approve
                              </button>
                              <button
                                type="button"
                                className="button button-outline"
                                onClick={() => openStatusModal(r, 'rejected')}
                                disabled={busy}
                                style={{
                                  fontSize: 12,
                                  padding: '4px 8px',
                                  color: '#DC2626',
                                  borderColor: '#FCA5A5',
                                  borderRadius: 5,
                                  cursor: 'pointer',
                                }}
                                title="Reject expense"
                              >
                                ✕ Reject
                              </button>
                            </>
                          )}

                          {r.status === 'posted' && (
                            <button
                              type="button"
                              className="button button-outline"
                              onClick={() => openStatusModal(r, 'void')}
                              disabled={busy}
                              style={{
                                fontSize: 12,
                                padding: '4px 9px',
                                color: '#DC2626',
                                borderColor: '#FCA5A5',
                                borderRadius: 5,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                              title="Void expense"
                            >
                              Void
                            </button>
                          )}

                          {r.status === 'rejected' && (
                            <button
                              type="button"
                              className="button"
                              onClick={() => handleQuickStatus(r, 'posted', 'Approved by Admin')}
                              disabled={busy}
                              style={{
                                fontSize: 12,
                                padding: '4px 9px',
                                background: '#166534',
                                color: '#FFFFFF',
                                border: 'none',
                                borderRadius: 5,
                                fontWeight: 600,
                                cursor: 'pointer',
                              }}
                              title="Approve and reinstate expense"
                            >
                              ✓ Approve
                            </button>
                          )}

                          <button
                            type="button"
                            className="button button-outline"
                            onClick={() => openStatusModal(r)}
                            disabled={busy}
                            style={{
                              fontSize: 12,
                              padding: '4px 8px',
                              color: 'var(--erp-maroon)',
                              borderColor: '#D4B99F',
                              background: '#FFFDF9',
                              borderRadius: 5,
                              cursor: 'pointer',
                            }}
                            title="Admin: Change status (Posted, Waiting approval, Rejected, Void)"
                          >
                            Status ▾
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {next !== null && (
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <button
            type="button"
            className="button button-outline"
            onClick={() => void load(next)}
            disabled={busy}
          >
            Load Older Expenses ↓
          </button>
        </div>
      )}
      {/* Portalled Centered Modal for Admin Status Management */}
      {mounted && statusModalRow && createPortal(
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 999999,
            background: 'rgba(26, 10, 15, 0.65)',
            backdropFilter: 'blur(3px)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
            overflowY: 'auto',
          }}
          onClick={() => setStatusModalRow(null)}
        >
          <div
            style={{
              background: '#FFFFFF',
              borderRadius: 16,
              boxShadow: '0 24px 60px rgba(0,0,0,0.3)',
              border: '1.5px solid var(--erp-gold, #C49A52)',
              width: '100%',
              maxWidth: 520,
              margin: 'auto',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                background: 'linear-gradient(135deg, #FAF4EB 0%, #F5E8D3 100%)',
                padding: '16px 20px',
                borderBottom: '1px solid #EAD5C0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div>
                <span
                  style={{
                    display: 'block',
                    fontSize: 10.5,
                    fontWeight: 800,
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                    color: 'var(--erp-gold-dark, #96702E)',
                  }}
                >
                  🛡️ ADMIN STATUS CONTROL
                </span>
                <h3
                  style={{
                    margin: '3px 0 0',
                    fontSize: 17,
                    fontWeight: 700,
                    color: 'var(--erp-maroon, #6B1724)',
                    fontFamily: 'var(--serif)',
                  }}
                >
                  Change Expense Status
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setStatusModalRow(null)}
                style={{
                  background: 'none',
                  border: 'none',
                  fontSize: 22,
                  color: 'var(--erp-maroon)',
                  cursor: 'pointer',
                  lineHeight: 1,
                  padding: 4,
                }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            {/* Expense Summary Box */}
            <div style={{ padding: '16px 20px 0' }}>
              <div
                style={{
                  background: '#FAF8F5',
                  border: '1px solid #EAD8C7',
                  borderRadius: 10,
                  padding: '12px 14px',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--erp-text)' }}>
                    {statusModalRow.description}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--erp-text-muted)', marginTop: 2 }}>
                    {statusModalRow.expense_on} · {statusModalRow.payee ? `Payee: ${statusModalRow.payee}` : 'Shop expense'} · by {statusModalRow.created_by_name || 'Staff'}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--erp-maroon)' }}>
                    {money(statusModalRow.amount_paise)}
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 600, color: '#6B7280', textTransform: 'uppercase' }}>
                    Current: {statusModalRow.status}
                  </div>
                </div>
              </div>
            </div>

            {/* Status Selection Form */}
            <form onSubmit={handleSaveStatus} style={{ padding: 20 }}>
              <label style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--erp-maroon)', marginBottom: 8 }}>
                Select New Status *
              </label>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginBottom: 16 }}>
                {([
                  { id: 'posted', label: 'Posted', desc: 'Active outflow, counted in reports', color: '#166534', bg: '#DCFCE7', border: '#86EFAC' },
                  { id: 'pending', label: 'Waiting Approval', desc: 'Pending in approval queue', color: '#92400E', bg: '#FEF3C7', border: '#FCD34D' },
                  { id: 'rejected', label: 'Rejected', desc: 'Declined by admin, not counted', color: '#991B1B', bg: '#FEE2E2', border: '#FCA5A5' },
                  { id: 'void', label: 'Void', desc: 'Cancelled record with audit trail', color: '#374151', bg: '#F3F4F6', border: '#D1D5DB' },
                ] as const).map((st) => {
                  const isSelected = targetStatus === st.id;
                  return (
                    <label
                      key={st.id}
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: `2px solid ${isSelected ? st.color : st.border}`,
                        background: isSelected ? st.bg : '#FFFFFF',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        boxShadow: isSelected ? `0 0 0 1px ${st.color}` : 'none',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <input
                          type="radio"
                          name="modal_target_status"
                          checked={isSelected}
                          onChange={() => setTargetStatus(st.id)}
                          style={{ accentColor: st.color }}
                        />
                        <span style={{ fontSize: 13, fontWeight: 700, color: st.color }}>
                          {st.label}
                        </span>
                      </div>
                      <span style={{ fontSize: 11, color: '#6B7280', marginTop: 4, lineHeight: 1.3 }}>
                        {st.desc}
                      </span>
                    </label>
                  );
                })}
              </div>

              {/* Reason / Audit Note */}
              <label style={{ display: 'block', marginBottom: 16 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--erp-text)', marginBottom: 4 }}>
                  {targetStatus === 'void' ? 'Reason for Voiding *' : 'Status Note / Reason (Optional)'}
                </span>
                <input
                  type="text"
                  value={statusReason}
                  onChange={(e) => setStatusReason(e.target.value)}
                  required={targetStatus === 'void'}
                  minLength={targetStatus === 'void' ? 3 : 0}
                  maxLength={500}
                  placeholder={
                    targetStatus === 'void'
                      ? 'e.g. Duplicate voucher / entered by mistake / wrong amount'
                      : targetStatus === 'posted'
                      ? 'e.g. Reinstated by Admin / Bill verified'
                      : targetStatus === 'rejected'
                      ? 'e.g. Bill not attached / unauthorized purchase'
                      : 'e.g. Needs clarification from cashier'
                  }
                  style={{
                    width: '100%',
                    padding: '9px 12px',
                    fontSize: 13,
                    borderRadius: 6,
                    border: '1px solid #D4B99F',
                    background: '#FAF7F2',
                    color: 'var(--erp-text)',
                    boxSizing: 'border-box',
                  }}
                />
              </label>

              {/* Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <button
                  type="button"
                  className="button button-outline"
                  onClick={() => setStatusModalRow(null)}
                  disabled={busy}
                  style={{ padding: '8px 16px', fontSize: 13 }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button"
                  disabled={busy}
                  style={{
                    background: 'var(--erp-maroon, #6B1724)',
                    color: '#FFFFFF',
                    padding: '8px 18px',
                    fontSize: 13,
                    fontWeight: 700,
                    border: 'none',
                    borderRadius: 6,
                    cursor: 'pointer',
                  }}
                >
                  {busy ? 'Saving...' : 'Save Status'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}