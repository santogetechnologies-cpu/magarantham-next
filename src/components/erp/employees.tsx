'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { indiaDate } from '@/lib/barcode';
import { money, Profile } from '@/lib/core';
import { api } from '../api';
import { ComponentsInput, References, Row, useERP } from './shared';
import { EmployeeProfileView } from '../admin/employee-profile';

type StaffForm = {
  id: string | null;
  code: string;
  name: string;
  phone: string;
  employment: 'full_time' | 'part_time';
  pay_basis: 'monthly' | 'daily' | 'hourly';
  rateRupees: string;
  dailyHours: string;
  overtimeRupees: string;
  policy_id: string;
  joined_on: string;
  ended_on: string;
  allowances: Row[];
  deductions: Row[];
  active: boolean;
};

export function EmployeesManager({
  refs,
  refreshRefs,
  profile,
}: {
  refs: References;
  refreshRefs: () => Promise<void>;
  profile?: Profile;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [modal, setModal] = useState<StaffForm | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [viewingEmployee, setViewingEmployee] = useState<Row | null>(null);
  const [loginTarget, setLoginTarget] = useState<Row | null>(null);
  const [resetTarget, setResetTarget] = useState<Row | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [deletingTarget, setDeletingTarget] = useState<Row | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [error, setError] = useState('');
  const { busy, send, notice } = useERP();

  const policies = refs.salary_policies || [];
  const defaultPolicyId =
    policies.find((p) => p.active)?.id || policies[0]?.id || '';

  async function load() {
    try {
      const r = await api<Row>('/api/erp/employees?page=0');
      setRows(r.rows || []);
    } catch (e) {
      notice((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      `${r.name} ${r.code} ${r.phone || ''} ${r.employment}`
        .toLowerCase()
        .includes(q),
    );
  }, [rows, search]);

  const activeStaff = rows.filter((r) => r.active !== false);
  const monthlyEstimatePaise = activeStaff
    .filter((r) => r.pay_basis === 'monthly')
    .reduce((sum, r) => sum + Number(r.rate_paise || 0), 0);
  const withLoginCount = activeStaff.filter((r) => Boolean(r.profile_id)).length;

  function nextStaffCode() {
    const num = rows.length + 1;
    return `EMP-${String(num).padStart(2, '0')}`;
  }

  function openAdd() {
    setError('');
    setShowAdvanced(false);
    setModal({
      id: null,
      code: nextStaffCode(),
      name: '',
      phone: '',
      employment: 'full_time',
      pay_basis: 'monthly',
      rateRupees: '',
      dailyHours: '8',
      overtimeRupees: '',
      policy_id: defaultPolicyId,
      joined_on: indiaDate(),
      ended_on: '',
      allowances: [],
      deductions: [],
      active: true,
    });
  }

  function openEdit(r: Row) {
    setError('');
    setShowAdvanced(false);
    setModal({
      id: r.id,
      code: r.code || '',
      name: r.name || '',
      phone: r.phone || '',
      employment: r.employment === 'part_time' ? 'part_time' : 'full_time',
      pay_basis:
        r.pay_basis === 'daily' || r.pay_basis === 'hourly'
          ? r.pay_basis
          : 'monthly',
      rateRupees: r.rate_paise ? String(Number(r.rate_paise) / 100) : '',
      dailyHours: String(
        Math.max(1, Math.round((Number(r.daily_minutes || 480) / 60) * 10) / 10),
      ),
      overtimeRupees: r.overtime_rate_paise
        ? String(Number(r.overtime_rate_paise) / 100)
        : '',
      policy_id: r.policy_id || defaultPolicyId,
      joined_on: r.joined_on || indiaDate(),
      ended_on: r.ended_on || '',
      allowances: Array.isArray(r.allowances) ? r.allowances : [],
      deductions: Array.isArray(r.deductions) ? r.deductions : [],
      active: r.active !== false,
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    setError('');

    const cleanName = modal.name.trim();
    const cleanCode = modal.code.trim();
    const policyId = modal.policy_id || defaultPolicyId;
    if (!cleanName) {
      setError('Please enter staff name.');
      return;
    }
    if (!cleanCode) {
      setError('Please enter a staff code (e.g. EMP-01).');
      return;
    }
    if (!policyId) {
      setError('Please create an active Salary Rule first.');
      return;
    }

    const rateNum = Number(modal.rateRupees || 0);
    const ratePaise =
      Number.isFinite(rateNum) && rateNum >= 0 ? Math.round(rateNum * 100) : 0;
    const otNum = Number(modal.overtimeRupees || 0);
    const overtimePaise =
      Number.isFinite(otNum) && otNum >= 0 ? Math.round(otNum * 100) : 0;
    const hrsNum = Number(modal.dailyHours || 8);
    const dailyMinutes = Math.min(
      1440,
      Math.max(60, Math.round((Number.isFinite(hrsNum) && hrsNum > 0 ? hrsNum : 8) * 60)),
    );

    const cleanAllowances = modal.allowances
      .filter((a) => String(a.label || '').trim())
      .map((a) => ({
        label: String(a.label).trim(),
        amount_paise: Math.max(0, Math.round(Number(a.amount_paise || 0))),
      }));
    const cleanDeductions = modal.deductions
      .filter((d) => String(d.label || '').trim())
      .map((d) => ({
        label: String(d.label).trim(),
        amount_paise: Math.max(0, Math.round(Number(d.amount_paise || 0))),
      }));

    const result = await send(
      'employees',
      {
        id: modal.id,
        data: {
          code: cleanCode,
          name: cleanName,
          phone: modal.phone.trim(),
          employment: modal.employment,
          pay_basis: modal.pay_basis,
          rate_paise: ratePaise,
          scheduled_units: 26,
          overtime_rate_paise: overtimePaise,
          daily_minutes: dailyMinutes,
          policy_id: policyId,
          joined_on: modal.joined_on || indiaDate(),
          ended_on: modal.ended_on.trim() ? modal.ended_on.trim() : null,
          allowances: cleanAllowances,
          deductions: cleanDeductions,
          active: modal.active,
        },
      },
      async () => {
        await load();
        await refreshRefs();
      },
    );

    if (result) {
      setModal(null);
    }
  }

  async function confirmDeleteEmployee() {
    if (!deletingTarget) return;
    setDeletingBusy(true);
    try {
      const res = await fetch(
        `/api/erp/employees?id=${encodeURIComponent(deletingTarget.id)}`,
        { method: 'DELETE', cache: 'no-store' },
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Could not delete staff member.');
      }
      notice(data.message || `"${deletingTarget.name}" deleted.`);
      setDeletingTarget(null);
      await load();
      await refreshRefs();
    } catch (err) {
      notice((err as Error).message || 'Could not delete staff member.');
    } finally {
      setDeletingBusy(false);
    }
  }

  async function handleResetPassword(e: React.FormEvent) {
    e.preventDefault();
    if (!resetTarget?.profile_id) return;
    if (resetPassword.length < 6) {
      notice('Password must be at least 6 characters.');
      return;
    }
    setResetBusy(true);
    try {
      const res = await api<Row>('/api/auth/staff-password', {
        user_id: resetTarget.profile_id,
        password: resetPassword,
      });
      notice(String(res.message || 'Password updated successfully!'));
      setResetTarget(null);
      setResetPassword('');
    } catch (err) {
      notice((err as Error).message || 'Failed to update password.');
    } finally {
      setResetBusy(false);
    }
  }

  if (viewingEmployee) {
    return (
      <EmployeeProfileView
        employee={viewingEmployee as any}
        profile={profile || ({ role: 'superadmin', permissions: ['superadmin'] } as any)}
        onBack={() => setViewingEmployee(null)}
        onUpdated={async () => {
          await load();
          await refreshRefs();
        }}
      />
    );
  }

  return (
    <div className="sp-root">
      {/* 3-Step Workflow Guide */}
      <div className="sp-workflow-bar">
        <div className="sp-step is-active">
          <span className="sp-step-num">1</span>
          <div>
            <strong>Add Staff</strong>
            <small>Name, phone &amp; salary</small>
          </div>
        </div>
        <span className="sp-step-arrow" aria-hidden="true">→</span>
        <Link href="/admin/attendance" className="sp-step">
          <span className="sp-step-num">2</span>
          <div>
            <strong>Mark Attendance</strong>
            <small>1-click daily roll call</small>
          </div>
        </Link>
        <span className="sp-step-arrow" aria-hidden="true">→</span>
        <Link href="/admin/payroll" className="sp-step">
          <span className="sp-step-num">3</span>
          <div>
            <strong>Pay Salary</strong>
            <small>Auto calculate &amp; print slip</small>
          </div>
        </Link>
      </div>

      {/* Summary KPIs */}
      <div className="sp-kpi-grid">
        <div className="sp-kpi-card">
          <span>Active Staff</span>
          <strong>{activeStaff.length}</strong>
          <small>{rows.length} total staff records</small>
        </div>
        <div className="sp-kpi-card">
          <span>Monthly Salary Base</span>
          <strong>{money(monthlyEstimatePaise)}</strong>
          <small>For monthly-paid active staff</small>
        </div>
        <div className="sp-kpi-card">
          <span>POS / Dashboard Logins</span>
          <strong>{withLoginCount}</strong>
          <small>Staff with app login linked</small>
        </div>
      </div>

      {/* Toolbar */}
      <div className="cat-mgmt-toolbar">
        <div className="datatable-search-box" style={{ minWidth: 260 }}>
          <span className="search-symbol">🔍</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search staff by name, code, or phone..."
            className="datatable-search-input"
          />
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/admin/attendance" className="button outline-btn">
            Mark Today&apos;s Attendance →
          </Link>
          <button type="button" className="button" onClick={openAdd}>
            + Add Staff Member
          </button>
        </div>
      </div>

      {/* Staff Table */}
      {filtered.length > 0 ? (
        <div className="table-widget-panel">
          <div className="table-responsive-wrapper">
            <table className="luxury-table">
              <thead>
                <tr>
                  <th>Staff Member</th>
                  <th>Phone</th>
                  <th>Salary</th>
                  <th>Joined</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <div className="sp-staff-cell">
                        <span className="sp-avatar">
                          {String(r.name || 'S').slice(0, 1).toUpperCase()}
                        </span>
                        <div>
                          <strong style={{ color: 'var(--erp-maroon)' }}>{r.name}</strong>
                          <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                            {r.code} · {r.employment === 'part_time' ? 'Part Time' : 'Full Time'}
                          </small>
                        </div>
                      </div>
                    </td>
                    <td>{r.phone || '—'}</td>
                    <td className="money-cell">
                      {money(Number(r.rate_paise || 0))}
                      <small
                        style={{
                          display: 'block',
                          fontWeight: 500,
                          color: 'var(--erp-text-muted)',
                        }}
                      >
                        per {r.pay_basis === 'daily' ? 'day' : r.pay_basis === 'hourly' ? 'hour' : 'month'}
                      </small>
                    </td>
                    <td className="date-cell">{r.joined_on || '—'}</td>
                    <td>
                      <span
                        className={`pill-status ${
                          r.active === false ? 'status-pending' : 'status-paid'
                        }`}
                      >
                        {r.active === false ? 'Inactive' : 'Active'}
                      </span>
                      <small style={{ display: 'block', color: 'var(--erp-text-muted)', marginTop: 3 }}>
                        {r.profile_id ? 'Login active' : 'No login needed'}
                      </small>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <button
                          type="button"
                          className="button outline-btn mini-btn"
                          onClick={() => setViewingEmployee(r)}
                        >
                          Profile
                        </button>
                        <button
                          type="button"
                          className="button outline-btn mini-btn"
                          onClick={() => openEdit(r)}
                        >
                          Edit
                        </button>
                        {!r.profile_id && r.active !== false && (
                          <button
                            type="button"
                            className="button gold-btn mini-btn"
                            onClick={() => setLoginTarget(r)}
                          >
                            Give Login
                          </button>
                        )}
                        {r.profile_id && r.active !== false && (
                          <button
                            type="button"
                            className="button outline-btn mini-btn"
                            onClick={() => {
                              setResetPassword('');
                              setResetTarget(r);
                            }}
                            title="Reset or update staff login password"
                          >
                            Password
                          </button>
                        )}
                        <button
                          type="button"
                          className="button outline-btn mini-btn"
                          style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}
                          onClick={() => setDeletingTarget(r)}
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
        </div>
      ) : (
        <div className="sp-empty-card">
          <h3>{rows.length === 0 ? 'No staff members added yet' : 'No matching staff found'}</h3>
          <p>
            {rows.length === 0
              ? 'Add your shop staff with their name, phone, and monthly or daily salary. You can mark daily attendance and generate salary slips immediately.'
              : 'Try clearing your search filter.'}
          </p>
          {rows.length === 0 && (
            <button type="button" className="button" onClick={openAdd}>
              + Add Your First Staff Member
            </button>
          )}
        </div>
      )}

      {/* Simple Add / Edit Staff Modal */}
      {modal && (
        <div
          className="luxury-modal-overlay"
          onClick={() => !busy && setModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="luxury-modal-card"
            style={{ maxWidth: 580 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">✦ STAFF &amp; PAYROLL</span>
                <h2 className="modal-title">
                  {modal.id ? 'Edit Staff Member' : 'Add Staff Member'}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                disabled={busy}
                onClick={() => setModal(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            {error && (
              <div className="modal-error-banner" role="alert">
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="modal-form-body">
              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Staff Name *</span>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    autoFocus
                    placeholder="e.g. Meena Krishnan"
                    value={modal.name}
                    onChange={(e) => setModal({ ...modal, name: e.target.value })}
                  />
                </label>
                <label className="input-group">
                  <span>Staff Code *</span>
                  <input
                    type="text"
                    required
                    maxLength={40}
                    placeholder="e.g. EMP-01"
                    value={modal.code}
                    onChange={(e) => setModal({ ...modal, code: e.target.value })}
                  />
                </label>
              </div>

              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Phone Number</span>
                  <input
                    type="text"
                    maxLength={25}
                    placeholder="+91 98765 43210"
                    value={modal.phone}
                    onChange={(e) => setModal({ ...modal, phone: e.target.value })}
                  />
                </label>
                <label className="input-group">
                  <span>Joining Date *</span>
                  <input
                    type="date"
                    required
                    value={modal.joined_on}
                    onChange={(e) => setModal({ ...modal, joined_on: e.target.value })}
                  />
                </label>
              </div>

              <div className="row-inputs-3">
                <label className="input-group">
                  <span>Job Type</span>
                  <select
                    value={modal.employment}
                    onChange={(e) =>
                      setModal({
                        ...modal,
                        employment: e.target.value === 'part_time' ? 'part_time' : 'full_time',
                      })
                    }
                  >
                    <option value="full_time">Full Time</option>
                    <option value="part_time">Part Time</option>
                  </select>
                </label>
                <label className="input-group">
                  <span>Salary Type</span>
                  <select
                    value={modal.pay_basis}
                    onChange={(e) =>
                      setModal({
                        ...modal,
                        pay_basis: e.target.value as StaffForm['pay_basis'],
                      })
                    }
                  >
                    <option value="monthly">Monthly Salary</option>
                    <option value="daily">Daily Wage</option>
                    <option value="hourly">Hourly Rate</option>
                  </select>
                </label>
                <label className="input-group">
                  <span>
                    {modal.pay_basis === 'daily'
                      ? 'Daily Rate (₹) *'
                      : modal.pay_basis === 'hourly'
                        ? 'Hourly Rate (₹) *'
                        : 'Monthly Salary (₹) *'}
                  </span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    placeholder="e.g. 15000"
                    value={modal.rateRupees}
                    onChange={(e) => setModal({ ...modal, rateRupees: e.target.value })}
                  />
                </label>
              </div>

              <button
                type="button"
                className="text-link"
                style={{ alignSelf: 'flex-start', fontSize: 12 }}
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced
                  ? '▾ Hide extra options (overtime, allowances, salary rule)'
                  : '▸ Optional: Overtime rate, allowances, deductions & salary rule'}
              </button>

              {showAdvanced && (
                <div className="sp-advanced-box">
                  <div className="row-inputs-2">
                    <label className="input-group">
                      <span>Salary Rule</span>
                      <select
                        value={modal.policy_id}
                        onChange={(e) => setModal({ ...modal, policy_id: e.target.value })}
                      >
                        {policies.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="input-group">
                      <span>Working Hours / Day</span>
                      <input
                        type="number"
                        min="1"
                        max="24"
                        step="0.5"
                        value={modal.dailyHours}
                        onChange={(e) => setModal({ ...modal, dailyHours: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className="row-inputs-2">
                    <label className="input-group">
                      <span>Overtime Hourly Rate (₹)</span>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        placeholder="0"
                        value={modal.overtimeRupees}
                        onChange={(e) => setModal({ ...modal, overtimeRupees: e.target.value })}
                      />
                    </label>
                    <label className="input-group">
                      <span>Last Working Date (if left)</span>
                      <input
                        type="date"
                        value={modal.ended_on}
                        onChange={(e) => setModal({ ...modal, ended_on: e.target.value })}
                      />
                    </label>
                  </div>

                  <ComponentsInput
                    label="Fixed Monthly Allowances (Optional)"
                    value={modal.allowances}
                    onChange={(v) => setModal({ ...modal, allowances: v })}
                  />
                  <ComponentsInput
                    label="Fixed Monthly Deductions (Optional)"
                    value={modal.deductions}
                    onChange={(v) => setModal({ ...modal, deductions: v })}
                  />

                  <label className="checkbox-item">
                    <input
                      type="checkbox"
                      checked={modal.active}
                      onChange={(e) => setModal({ ...modal, active: e.target.checked })}
                    />
                    <span>Active Staff Member</span>
                  </label>
                </div>
              )}

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="button gold-btn" disabled={busy}>
                  {busy ? 'Saving...' : modal.id ? 'Save Changes' : 'Add Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Optional POS / Staff Login Setup Modal */}
      {loginTarget && (
        <div
          className="luxury-modal-overlay"
          onClick={() => !busy && setLoginTarget(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="luxury-modal-card"
            style={{ maxWidth: 480 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">✦ OPTIONAL STAFF LOGIN</span>
                <h2 className="modal-title">Login for {loginTarget.name}</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                disabled={busy}
                onClick={() => setLoginTarget(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form
              className="modal-form-body"
              onSubmit={async (e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                const existing = String(f.get('existing') || '');
                const payload = existing
                  ? {
                      employee_id: loginTarget.id,
                      existing_profile_id: existing,
                      role: 'billing',
                    }
                  : {
                      employee_id: loginTarget.id,
                      role: f.get('role'),
                      email: f.get('email'),
                      password: f.get('password'),
                    };
                const r = await send('employee_login', payload, async () => {
                  await load();
                  await refreshRefs();
                });
                if (r) setLoginTarget(null);
              }}
            >
              <p style={{ margin: 0, fontSize: 13, color: 'var(--erp-text-muted)' }}>
                Staff do <strong>not</strong> need a login for attendance or salary. Only create one if this person should log in to use POS Billing or Admin.
              </p>
              <label className="input-group">
                <span>Role</span>
                <select name="role" defaultValue="billing">
                  <option value="billing">Billing / POS Cashier</option>
                  <option value="manager">Shop Manager</option>
                </select>
              </label>
              <label className="input-group">
                <span>Email Address *</span>
                <input type="email" name="email" required maxLength={254} placeholder="staff@magarantham.com" />
              </label>
              <label className="input-group">
                <span>Password *</span>
                <input
                  type="password"
                  name="password"
                  required
                  minLength={6}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder="Enter password"
                />
              </label>
              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={busy}
                  onClick={() => setLoginTarget(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="button gold-btn" disabled={busy}>
                  {busy ? 'Creating...' : 'Create Staff Login'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reset Password Modal */}
      {resetTarget && (
        <div
          className="luxury-modal-overlay"
          role="dialog"
          aria-modal="true"
          onClick={(e) => e.target === e.currentTarget && !resetBusy && setResetTarget(null)}
        >
          <div className="luxury-modal-content" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <div>
                <span className="modal-badge-gold">Login Access</span>
                <h3 className="modal-title">Reset Password</h3>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                disabled={resetBusy}
                onClick={() => setResetTarget(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleResetPassword} className="modal-form-body">
              <p style={{ margin: 0, fontSize: 13, color: 'var(--erp-text-muted)' }}>
                Set a new password for <strong>{resetTarget.name}</strong> ({resetTarget.code}).
              </p>

              <label className="input-group">
                <span>New Password (minimum 6 characters) *</span>
                <input
                  type="password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  required
                  minLength={6}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder="Enter new password"
                  autoFocus
                />
              </label>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={resetBusy}
                  onClick={() => setResetTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button gold-btn"
                  disabled={resetBusy || resetPassword.length < 6}
                >
                  {resetBusy ? 'Updating…' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Staff Confirmation Modal */}
      {deletingTarget && (
        <div
          className="luxury-modal-overlay"
          onClick={() => !deletingBusy && setDeletingTarget(null)}
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
                <span className="modal-eyebrow">✦ STAFF &amp; PAYROLL</span>
                <h2 className="modal-title">Delete Staff Member</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                disabled={deletingBusy}
                onClick={() => setDeletingTarget(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="modal-form-body">
              <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6 }}>
                Are you sure you want to delete <strong>{deletingTarget.name}</strong> ({deletingTarget.code})?
                {deletingTarget.profile_id
                  ? ' Their linked POS login will also be disabled.'
                  : ''}
              </p>
              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={deletingBusy}
                  onClick={() => setDeletingTarget(null)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="button"
                  style={{ background: '#B91C1C', borderColor: '#B91C1C' }}
                  disabled={deletingBusy}
                  onClick={() => void confirmDeleteEmployee()}
                >
                  {deletingBusy ? 'Deleting…' : 'Delete Staff'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
