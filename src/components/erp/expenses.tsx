'use client';

import { useEffect, useState, useMemo } from 'react';
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
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'posted' | 'void'>('all');
  const [showLogForm, setShowLogForm] = useState(false);

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

      {/* Void Modal / Form */}
      {voiding && (
        <form
          className="form-panel"
          style={{
            marginBottom: 24,
            background: '#FFF5F5',
            border: '1.5px solid #F87171',
            borderRadius: 12,
            padding: 20,
          }}
          onSubmit={async (e) => {
            e.preventDefault();
            const r = await send(
              'expense_void',
              { id: voiding.id, reason: new FormData(e.currentTarget).get('reason') },
              load
            );
            if (r) setVoiding(null);
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
            <span style={{ fontSize: 22 }}>⚠️</span>
            <h3 style={{ margin: 0, color: '#991B1B', fontSize: 18 }}>
              Void Expense: {voiding.description} ({money(voiding.amount_paise)})
            </h3>
          </div>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: '#7F1D1D' }}>
            Voiding marks this expense record as cancelled and audits your user account as the authority who voided it.
          </p>
          <label style={{ display: 'block', marginBottom: 14 }}>
            Correction Reason (Minimum 3 characters) *
            <input
              name="reason"
              required
              minLength={3}
              maxLength={500}
              placeholder="e.g. Duplicate voucher entered by mistake / wrong amount"
              style={{ width: '100%', marginTop: 4 }}
            />
          </label>
          <div className="button-row">
            <button className="button" style={{ background: '#DC2626', color: '#FFFFFF' }} disabled={busy}>
              Confirm Void
            </button>
            <button type="button" className="text-link" onClick={() => setVoiding(null)}>
              Keep Expense
            </button>
          </div>
        </form>
      )}

      {/* Filter and Search Toolbar */}
      <div
        className="sp-toolbar"
        style={{
          display: 'flex',
          gap: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          background: '#FFFFFF',
          padding: '12px 16px',
          borderRadius: 10,
          border: '1px solid var(--erp-border, #EAD5C0)',
        }}
      >
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', flex: 1, minWidth: 280 }}>
          <div style={{ position: 'relative', flex: '1 1 240px', minWidth: 180 }}>
            <input
              type="text"
              placeholder="🔍 Search description, payee, ref, or recorded by user..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                width: '100%',
                padding: '8px 12px',
                fontSize: 13,
                borderRadius: 6,
                border: '1px solid #D4B99F',
                background: '#FAF7F2',
              }}
            />
          </div>

          <select
            value={selectedCat}
            onChange={(e) => setSelectedCat(e.target.value)}
            style={{
              padding: '8px 12px',
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
              padding: '8px 12px',
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
              padding: '8px 12px',
              fontSize: 13,
              borderRadius: 6,
              border: '1px solid #D4B99F',
              background: '#FAF7F2',
              color: 'var(--erp-text)',
            }}
          >
            <option value="all">All Statuses</option>
            <option value="posted">Posted Only</option>
            <option value="void">Voided Only</option>
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
            style={{ fontSize: 12, padding: '6px 12px' }}
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
          overflow: 'hidden',
          boxShadow: '0 2px 8px rgba(128, 0, 32, 0.03)',
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ background: '#F8EFE4', borderBottom: '1.5px solid #E5D0B8' }}>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)' }}>
                DATE / CATEGORY
              </th>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)' }}>
                DESCRIPTION &amp; PAYEE
              </th>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)' }}>
                AMOUNT
              </th>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)' }}>
                PAYMENT METHOD
              </th>
              {/* Dedicated Creator Column */}
              <th
                style={{
                  padding: '12px 14px',
                  fontSize: 12,
                  fontWeight: 700,
                  color: 'var(--erp-maroon)',
                  background: '#F4E7D7',
                  borderLeft: '1px solid #E5D0B8',
                  borderRight: '1px solid #E5D0B8',
                }}
              >
                RECORDED BY (USER / STAFF)
              </th>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)' }}>
                STATUS
              </th>
              <th style={{ padding: '12px 14px', fontSize: 12, fontWeight: 700, color: 'var(--erp-maroon)', textAlign: 'right' }}>
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
                const creatorRole = r.created_by_designation || r.created_by_role || 'Staff';
                const isVoid = r.status === 'void';

                // Initial for avatar circle
                const initial = (creatorName[0] || 'A').toUpperCase();

                return (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid #F1E5D8',
                      background: isVoid ? '#FAF9F8' : '#FFFFFF',
                      opacity: isVoid ? 0.8 : 1,
                    }}
                  >
                    {/* Date / Category */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
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
                    <td style={{ padding: '12px 14px', verticalAlign: 'top', maxWidth: 280 }}>
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
                    <td style={{ padding: '12px 14px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
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
                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
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

                    {/* RECORDED BY USER / STAFF */}
                    <td
                      style={{
                        padding: '12px 14px',
                        verticalAlign: 'top',
                        background: isVoid ? '#F5F3F1' : '#FFFDF9',
                        borderLeft: '1px solid #F1E5D8',
                        borderRight: '1px solid #F1E5D8',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div
                          style={{
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: 'linear-gradient(135deg, #800020, #5A0619)',
                            color: '#FFFFFF',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 13,
                            fontWeight: 700,
                            flexShrink: 0,
                            boxShadow: '0 2px 4px rgba(128,0,32,0.15)',
                          }}
                        >
                          {initial}
                        </div>
                        <div>
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
                          <div style={{ display: 'flex', gap: 4, alignItems: 'center', marginTop: 3 }}>
                            {creatorCode && (
                              <span
                                style={{
                                  fontSize: 10.5,
                                  fontWeight: 700,
                                  background: '#FAF0E4',
                                  color: '#8A5314',
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  border: '1px solid #E2CCA8',
                                }}
                              >
                                {creatorCode}
                              </span>
                            )}
                            <span style={{ fontSize: 11, color: 'var(--erp-text-muted)' }}>
                              {creatorRole}
                            </span>
                          </div>
                          {r.created_at && (
                            <small
                              style={{
                                display: 'block',
                                fontSize: 10.5,
                                color: '#9CA3AF',
                                marginTop: 2,
                              }}
                            >
                              Logged: {formatTime(r.created_at)}
                            </small>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Status & Audit */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'top' }}>
                      {isVoid ? (
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
                          >
                            ● VOID
                          </span>
                          {r.void_by_name && (
                            <small style={{ display: 'block', fontSize: 11, color: '#B91C1C', marginTop: 2 }}>
                              Voided by: {r.void_by_name}
                            </small>
                          )}
                          {r.void_reason && (
                            <small
                              style={{
                                display: 'block',
                                fontSize: 11,
                                color: '#6B7280',
                                fontStyle: 'italic',
                                marginTop: 1,
                              }}
                            >
                              &quot;{r.void_reason}&quot;
                            </small>
                          )}
                        </div>
                      ) : (
                        <div>
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
                            ● POSTED
                          </span>
                          <small style={{ display: 'block', fontSize: 11, color: 'var(--erp-text-muted)', marginTop: 2 }}>
                            {r.source === 'payroll' ? 'Payroll Auto' : 'Manual Entry'}
                          </small>
                        </div>
                      )}
                    </td>

                    {/* Action */}
                    <td style={{ padding: '12px 14px', verticalAlign: 'top', textAlign: 'right' }}>
                      {r.source === 'manual' && r.status === 'posted' && (
                        <button
                          type="button"
                          className="button button-outline"
                          onClick={() => setVoiding(r)}
                          style={{
                            fontSize: 12,
                            padding: '4px 10px',
                            color: '#DC2626',
                            borderColor: '#FCA5A5',
                          }}
                        >
                          Void
                        </button>
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
    </div>
  );
}
