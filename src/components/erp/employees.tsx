'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { indiaDate } from '@/lib/barcode';
import { money, Profile } from '@/lib/core';
import { api } from '../api';
import { ComponentsInput, References, Row, useERP } from './shared';
import { EmployeeProfileView } from '../admin/employee-profile';

export const DEPARTMENT_OPTIONS = [
  'Retail Sales',
  'Billing / Cashier',
  'Saree Draping & Styling',
  'Inventory & Stock',
  'Tailoring & Alterations',
  'Store Operations',
  'Accounts & Finance',
  'Management',
];

export const DESIGNATION_PRESETS = [
  'Senior Sales Executive',
  'Sales Associate',
  'Cashier & Billing Specialist',
  'Master Weaver & Saree Expert',
  'Saree Draper & Stylist',
  'Inventory Storekeeper',
  'Master Tailor',
  'Floor Supervisor',
  'Store Manager',
];

export type StaffForm = {
  id: string | null;
  code: string;
  name: string;
  phone: string;
  email: string;
  photo_url: string;
  address: string;
  emergency_contact: string;
  designation: string;
  department: string;
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
  bank_name: string;
  account_number: string;
  ifsc_code: string;
  branch: string;
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
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [deptFilter, setDeptFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [activeTab, setActiveTab] = useState<'directory' | 'departments' | 'reports'>('directory');

  const [modal, setModal] = useState<StaffForm | null>(null);
  const [modalTab, setModalTab] = useState<'basic' | 'job' | 'salary' | 'bank'>('basic');
  const [viewingEmployee, setViewingEmployee] = useState<Row | null>(null);
  const [loginTarget, setLoginTarget] = useState<Row | null>(null);
  const [resetTarget, setResetTarget] = useState<Row | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetBusy, setResetBusy] = useState(false);
  const [deletingTarget, setDeletingTarget] = useState<Row | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
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

  // Handle query params from sidebar navigation
  useEffect(() => {
    if (searchParams.get('action') === 'new') {
      openAdd();
    }
    const tabParam = searchParams.get('tab');
    if (tabParam === 'departments') {
      setActiveTab('departments');
    } else if (tabParam === 'reports') {
      setActiveTab('reports');
    }
  }, [searchParams]);

  // Derived summaries
  const activeStaff = useMemo(() => rows.filter((r) => r.active !== false), [rows]);
  const inactiveStaff = useMemo(() => rows.filter((r) => r.active === false), [rows]);

  const distinctDepartments = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      set.add(r.department || 'Retail Sales');
    }
    return Array.from(set);
  }, [rows]);

  const monthlyEstimatePaise = useMemo(() => {
    return activeStaff
      .filter((r) => r.pay_basis === 'monthly')
      .reduce((sum, r) => sum + Number(r.rate_paise || 0), 0);
  }, [activeStaff]);

  // Filtered employees
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      // Status filter
      if (statusFilter === 'active' && r.active === false) return false;
      if (statusFilter === 'inactive' && r.active !== false) return false;

      // Department filter
      const empDept = r.department || 'Retail Sales';
      if (deptFilter !== 'all' && empDept !== deptFilter) return false;

      // Role filter
      if (roleFilter !== 'all') {
        if (roleFilter === 'full_time' && r.employment !== 'full_time') return false;
        if (roleFilter === 'part_time' && r.employment !== 'part_time') return false;
      }

      // Search query
      if (!q) return true;
      const haystack = `${r.name || ''} ${r.code || ''} ${r.phone || ''} ${r.email || ''} ${r.designation || ''} ${empDept}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [rows, search, deptFilter, roleFilter, statusFilter]);

  function nextStaffCode() {
    const num = rows.length + 1;
    return `EMP-${String(num).padStart(2, '0')}`;
  }

  function openAdd() {
    setError('');
    setModalTab('basic');
    setModal({
      id: null,
      code: nextStaffCode(),
      name: '',
      phone: '',
      email: '',
      photo_url: '',
      address: '',
      emergency_contact: '',
      designation: 'Sales Executive',
      department: 'Retail Sales',
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
      bank_name: '',
      account_number: '',
      ifsc_code: '',
      branch: '',
    });
  }

  function openEdit(r: Row) {
    setError('');
    setModalTab('basic');
    const bank = (r.bank_details && typeof r.bank_details === 'object' ? r.bank_details : {}) as Record<string, string>;
    setModal({
      id: r.id,
      code: r.code || '',
      name: r.name || '',
      phone: r.phone || '',
      email: r.email || '',
      photo_url: r.photo_url || '',
      address: r.address || '',
      emergency_contact: r.emergency_contact || '',
      designation: r.designation || 'Sales Executive',
      department: r.department || 'Retail Sales',
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
      bank_name: bank.bank_name || '',
      account_number: bank.account_number || '',
      ifsc_code: bank.ifsc_code || '',
      branch: bank.branch || '',
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
      setError('Please select or create an active Salary Rule first.');
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
          email: modal.email.trim(),
          photo_url: modal.photo_url.trim(),
          address: modal.address.trim(),
          emergency_contact: modal.emergency_contact.trim(),
          designation: modal.designation.trim() || 'Sales Executive',
          department: modal.department.trim() || 'Retail Sales',
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
          bank_details: {
            bank_name: modal.bank_name.trim(),
            account_number: modal.account_number.trim(),
            ifsc_code: modal.ifsc_code.trim(),
            branch: modal.branch.trim(),
          },
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

  async function toggleEmployeeActive(r: Row) {
    setTogglingId(r.id);
    try {
      const nextActive = !r.active;
      await api('/api/erp/employees', {
        id: r.id,
        data: {
          code: r.code,
          name: r.name,
          phone: r.phone || '',
          employment: r.employment,
          pay_basis: r.pay_basis,
          rate_paise: Number(r.rate_paise || 0),
          scheduled_units: 26,
          overtime_rate_paise: Number(r.overtime_rate_paise || 0),
          daily_minutes: Number(r.daily_minutes || 480),
          policy_id: r.policy_id || defaultPolicyId,
          joined_on: r.joined_on || indiaDate(),
          ended_on: nextActive ? null : indiaDate(),
          allowances: r.allowances || [],
          deductions: r.deductions || [],
          active: nextActive,
          designation: r.designation || 'Sales Executive',
          department: r.department || 'Retail Sales',
        },
      });
      notice(nextActive ? `"${r.name}" is now marked Active.` : `"${r.name}" has been Deactivated.`);
      await load();
      await refreshRefs();
    } catch (e) {
      notice((e as Error).message || 'Failed to update employee status.');
    } finally {
      setTogglingId(null);
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

  function exportStaffCSV() {
    if (!rows.length) return;
    const headers = ['Employee ID', 'Name', 'Role', 'Department', 'Phone', 'Email', 'Employment', 'Pay Basis', 'Salary (Rs)', 'Joined Date', 'Status'];
    const csvRows = [headers.join(',')];
    for (const r of rows) {
      const salaryRupees = (Number(r.rate_paise || 0) / 100).toFixed(2);
      const rowData = [
        `"${r.code || ''}"`,
        `"${r.name || ''}"`,
        `"${r.designation || 'Sales Executive'}"`,
        `"${r.department || 'Retail Sales'}"`,
        `"${r.phone || ''}"`,
        `"${r.email || ''}"`,
        `"${r.employment === 'part_time' ? 'Part Time' : 'Full Time'}"`,
        `"${r.pay_basis || 'monthly'}"`,
        `"${salaryRupees}"`,
        `"${r.joined_on || ''}"`,
        `"${r.active !== false ? 'Active' : 'Inactive'}"`,
      ];
      csvRows.push(rowData.join(','));
    }
    const blob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `magarantham_staff_directory_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // If viewing detailed profile, render EmployeeProfileView
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
    <div className="sp-premium-root">
      {/* 1. Header with Title, Subtitle and Prominent Maroon Button */}
      <div className="sp-premium-header">
        <div className="sp-header-left">
          <p className="sp-header-eyebrow">MAGARANTHAM SILKS · ENTERPRISE ERP</p>
          <h1 className="sp-header-title">Staff Management</h1>
          <p className="sp-header-subtitle">Manage your employees and staff details.</p>
        </div>
        <div className="sp-header-actions">
          <Link href="/admin/attendance" className="button button-outline" style={{ height: 42 }}>
            <span aria-hidden="true">⏱</span>
            <span>Daily Attendance →</span>
          </Link>
          <button type="button" className="sp-btn-maroon" onClick={openAdd}>
            <span style={{ fontSize: 16 }}>+</span>
            <span>Add New Staff</span>
          </button>
        </div>
      </div>

      {/* 2. Four Summary Cards */}
      <div className="sp-stats-grid">
        {/* Total Employees */}
        <div className="sp-stat-card">
          <div className="sp-stat-info">
            <span className="sp-stat-label">Total Employees</span>
            <strong className="sp-stat-count">{rows.length}</strong>
            <span className="sp-stat-sublabel">Total staff records in database</span>
          </div>
          <div className="sp-stat-icon-wrap tone-total" title="Total Employees">
            👥
          </div>
        </div>

        {/* Active Staff */}
        <div className="sp-stat-card">
          <div className="sp-stat-info">
            <span className="sp-stat-label">Active Staff</span>
            <strong className="sp-stat-count" style={{ color: '#047857' }}>{activeStaff.length}</strong>
            <span className="sp-stat-sublabel">Currently employed on shop floor</span>
          </div>
          <div className="sp-stat-icon-wrap tone-active" title="Active Staff">
            ✓
          </div>
        </div>

        {/* Inactive Staff */}
        <div className="sp-stat-card">
          <div className="sp-stat-info">
            <span className="sp-stat-label">Inactive Staff</span>
            <strong className="sp-stat-count" style={{ color: '#64748B' }}>{inactiveStaff.length}</strong>
            <span className="sp-stat-sublabel">Resigned, on hold, or relieved</span>
          </div>
          <div className="sp-stat-icon-wrap tone-inactive" title="Inactive Staff">
            ⏸
          </div>
        </div>

        {/* Departments */}
        <div className="sp-stat-card">
          <div className="sp-stat-info">
            <span className="sp-stat-label">Departments</span>
            <strong className="sp-stat-count" style={{ color: '#BE123C' }}>{distinctDepartments.length}</strong>
            <span className="sp-stat-sublabel">Retail, Billing, Saree Draping, etc.</span>
          </div>
          <div className="sp-stat-icon-wrap tone-depts" title="Departments">
            🏛
          </div>
        </div>
      </div>

      {/* 3. Section Navigation Tabs */}
      <div className="sp-section-tabs-bar">
        <button
          type="button"
          className={`sp-section-tab ${activeTab === 'directory' ? 'active' : ''}`}
          onClick={() => setActiveTab('directory')}
        >
          <span>All Employees</span>
          <span className="sp-tab-badge">{rows.length}</span>
        </button>
        <button
          type="button"
          className={`sp-section-tab ${activeTab === 'departments' ? 'active' : ''}`}
          onClick={() => setActiveTab('departments')}
        >
          <span>Departments</span>
          <span className="sp-tab-badge">{distinctDepartments.length}</span>
        </button>
        <button
          type="button"
          className={`sp-section-tab ${activeTab === 'reports' ? 'active' : ''}`}
          onClick={() => setActiveTab('reports')}
        >
          <span>Staff Reports</span>
        </button>
      </div>

      {/* 4. Tab: Directory */}
      {activeTab === 'directory' && (
        <section className="sp-panel" style={{ padding: 0 }}>
          {/* Toolbar with Search, Department Filter, Role Filter, Status Filter */}
          <div className="sp-toolbar" style={{ border: 'none', borderBottom: '1px solid var(--erp-border-light)', padding: '12px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div className="sp-search-field" style={{ flex: '1 1 240px', maxWidth: 320 }}>
              <span className="sp-search-icon">🔍</span>
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search staff by name, ID, phone, role..."
                className="sp-search-input"
              />
            </div>

            <div className="sp-filters-group">
              <select
                value={deptFilter}
                onChange={(e) => setDeptFilter(e.target.value)}
                className="sp-filter-select"
                aria-label="Department filter"
              >
                <option value="all">All Departments ({distinctDepartments.length})</option>
                {distinctDepartments.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="sp-filter-select"
                aria-label="Role filter"
              >
                <option value="all">All Employment Types</option>
                <option value="full_time">Full Time</option>
                <option value="part_time">Part Time</option>
              </select>

              <div style={{ display: 'inline-flex', height: 38, border: '1px solid var(--erp-border, #EAD5C0)', borderRadius: 8, overflow: 'hidden', background: '#FFFDFB', flexShrink: 0 }}>
                <button
                  type="button"
                  style={{
                    padding: '0 14px',
                    height: '100%',
                    fontSize: 12.5,
                    fontWeight: 600,
                    border: 'none',
                    background: statusFilter === 'all' ? 'var(--erp-maroon, #800020)' : 'transparent',
                    color: statusFilter === 'all' ? '#FFFFFF' : 'var(--erp-text, #332321)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => setStatusFilter('all')}
                >
                  All ({rows.length})
                </button>
                <button
                  type="button"
                  style={{
                    padding: '0 14px',
                    height: '100%',
                    fontSize: 12.5,
                    fontWeight: 600,
                    border: 'none',
                    borderLeft: '1px solid var(--erp-border, #EAD5C0)',
                    background: statusFilter === 'active' ? 'var(--erp-maroon, #800020)' : 'transparent',
                    color: statusFilter === 'active' ? '#FFFFFF' : 'var(--erp-text, #332321)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => setStatusFilter('active')}
                >
                  Active ({activeStaff.length})
                </button>
                <button
                  type="button"
                  style={{
                    padding: '0 14px',
                    height: '100%',
                    fontSize: 12.5,
                    fontWeight: 600,
                    border: 'none',
                    borderLeft: '1px solid var(--erp-border, #EAD5C0)',
                    background: statusFilter === 'inactive' ? 'var(--erp-maroon, #800020)' : 'transparent',
                    color: statusFilter === 'inactive' ? '#FFFFFF' : 'var(--erp-text, #332321)',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                  onClick={() => setStatusFilter('inactive')}
                >
                  Inactive ({inactiveStaff.length})
                </button>
              </div>

              <button
                type="button"
                className="ms-btn ms-btn-primary ms-btn-sm"
                onClick={openAdd}
                style={{ height: 38, padding: '0 16px', display: 'inline-flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap' }}
              >
                <span>+</span>
                <span>Add Employee</span>
              </button>
            </div>
          </div>

          {/* Employee Directory Table */}
          {filtered.length > 0 ? (
            <div className="table-responsive-wrapper">
              <table className="luxury-table" style={{ minWidth: 920 }}>
                <thead>
                  <tr>
                    <th style={{ minWidth: 180, whiteSpace: 'nowrap' }}>Employee</th>
                    <th style={{ minWidth: 120, whiteSpace: 'nowrap' }}>Employee ID</th>
                    <th style={{ minWidth: 130, whiteSpace: 'nowrap' }}>Job Role</th>
                    <th style={{ minWidth: 130, whiteSpace: 'nowrap' }}>Department</th>
                    <th style={{ minWidth: 120, whiteSpace: 'nowrap' }}>Phone</th>
                    <th style={{ minWidth: 110, whiteSpace: 'nowrap' }}>Joining Date</th>
                    <th style={{ minWidth: 90, whiteSpace: 'nowrap' }}>Status</th>
                    <th style={{ minWidth: 140, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => {
                    const initials = String(r.name || 'S')
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w) => w[0].toUpperCase())
                      .join('');

                    return (
                      <tr key={r.id}>
                        {/* Employee Avatar & Name */}
                        <td>
                          <div className="sp-staff-cell">
                            {r.photo_url ? (
                              <img
                                src={r.photo_url}
                                alt={r.name}
                                style={{
                                  width: 38,
                                  height: 38,
                                  borderRadius: '50%',
                                  objectFit: 'cover',
                                  border: '2px solid var(--erp-gold, #C49A52)',
                                  flexShrink: 0,
                                }}
                              />
                            ) : (
                              <span className="sp-avatar" style={{ width: 38, height: 38 }}>
                                {initials || 'S'}
                              </span>
                            )}
                            <div>
                              <strong
                                style={{
                                  color: 'var(--erp-maroon)',
                                  fontSize: 13.5,
                                  cursor: 'pointer',
                                }}
                                onClick={() => setViewingEmployee(r)}
                                title="Click to view complete profile"
                              >
                                {r.name}
                              </strong>
                              {r.email && (
                                <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                                  {r.email}
                                </small>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Employee ID */}
                        <td>
                          <code
                            style={{
                              background: '#FDF7F0',
                              padding: '3px 7px',
                              borderRadius: 5,
                              color: 'var(--erp-maroon)',
                              fontWeight: 700,
                              fontSize: 12,
                              border: '1px solid #EAD5C0',
                            }}
                          >
                            {r.code}
                          </code>
                        </td>

                        {/* Job Role */}
                        <td>
                          <span style={{ fontWeight: 600, color: '#332321', fontSize: 12.5 }}>
                            {r.designation || 'Sales Executive'}
                          </span>
                          <small style={{ display: 'block', color: '#888', fontSize: 11 }}>
                            {r.employment === 'part_time' ? 'Part Time' : 'Full Time'}
                          </small>
                        </td>

                        {/* Department */}
                        <td>
                          <span
                            style={{
                              display: 'inline-block',
                              padding: '3px 8px',
                              borderRadius: 6,
                              background: '#FFF5F6',
                              color: 'var(--erp-maroon)',
                              fontWeight: 600,
                              fontSize: 11.5,
                              border: '1px solid rgba(128, 0, 32, 0.15)',
                            }}
                          >
                            {r.department || 'Retail Sales'}
                          </span>
                        </td>

                        {/* Phone */}
                        <td>
                          <span style={{ fontSize: 12.5, color: '#332321', fontFamily: 'monospace' }}>
                            {r.phone || '—'}
                          </span>
                        </td>

                        {/* Joining Date */}
                        <td className="date-cell">
                          <span style={{ fontSize: 12 }}>{r.joined_on || '—'}</span>
                        </td>

                        {/* Employment Status */}
                        <td>
                          <span
                            className={`sp-pill-status ${
                              r.active !== false ? 'status-full_day' : 'status-weekly_off'
                            }`}
                          >
                            {r.active !== false ? '● Active' : '○ Inactive'}
                          </span>
                        </td>

                        {/* Actions: View Profile, Edit, View Attendance, Deactivate */}
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                            <button
                              type="button"
                              className="button outline-btn mini-btn"
                              onClick={() => setViewingEmployee(r)}
                              title="View Employee Profile (6 Tabs)"
                            >
                              Profile
                            </button>
                            <button
                              type="button"
                              className="button outline-btn mini-btn"
                              onClick={() => openEdit(r)}
                              title="Edit Employee Details"
                            >
                              Edit
                            </button>
                            <Link
                              href={`/admin/attendance?employee_id=${r.id}`}
                              className="button outline-btn mini-btn"
                              title="View Daily Attendance Log"
                            >
                              Attendance
                            </Link>
                            <button
                              type="button"
                              className="button outline-btn mini-btn"
                              disabled={togglingId === r.id}
                              onClick={() => void toggleEmployeeActive(r)}
                              style={{
                                color: r.active !== false ? '#B45309' : '#047857',
                                borderColor: r.active !== false ? '#FDE68A' : '#A7F3D0',
                              }}
                              title={r.active !== false ? 'Deactivate staff member' : 'Reactivate staff member'}
                            >
                              {r.active !== false ? 'Deactivate' : 'Activate'}
                            </button>
                            <button
                              type="button"
                              className="button outline-btn mini-btn"
                              style={{ color: '#B91C1C', borderColor: '#FCA5A5' }}
                              onClick={() => setDeletingTarget(r)}
                              title="Delete staff record"
                            >
                              ✕
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="sp-empty-card" style={{ margin: 24 }}>
              <h3>{rows.length === 0 ? 'No staff members added yet' : 'No matching employees found'}</h3>
              <p>
                {rows.length === 0
                  ? 'Add your shop staff with their name, role, department, and salary. You can mark daily attendance and track payroll instantly.'
                  : 'Try clearing your search query or department filter.'}
              </p>
              {rows.length === 0 && (
                <button type="button" className="sp-btn-maroon" onClick={openAdd}>
                  + Add Your First Employee
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {/* 5. Tab: Departments Breakdown */}
      {activeTab === 'departments' && (
        <section className="sp-panel">
          <div className="sp-panel-head">
            <div>
              <h2 className="sp-panel-title">Departments Directory</h2>
              <p className="sp-panel-sub">Employees grouped by operational unit and department</p>
            </div>
          </div>

          <div className="sp-depts-grid">
            {distinctDepartments.map((dept) => {
              const deptStaff = rows.filter((r) => (r.department || 'Retail Sales') === dept);
              const activeCount = deptStaff.filter((r) => r.active !== false).length;

              return (
                <div className="sp-dept-card" key={dept}>
                  <div className="sp-dept-card-header">
                    <h3 className="sp-dept-name">{dept}</h3>
                    <span className="sp-dept-count-badge">
                      {deptStaff.length} Staff ({activeCount} active)
                    </span>
                  </div>

                  <div className="sp-dept-members-list">
                    {deptStaff.map((emp) => (
                      <div className="sp-dept-member-item" key={emp.id}>
                        <span className="sp-avatar" style={{ width: 26, height: 26, fontSize: 10 }}>
                          {String(emp.name || 'S')[0].toUpperCase()}
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ display: 'block', fontSize: 12, color: 'var(--erp-maroon)' }}>
                            {emp.name}
                          </strong>
                          <small style={{ color: '#888', fontSize: 11 }}>
                            {emp.code} · {emp.designation || 'Staff'}
                          </small>
                        </div>
                        <button
                          type="button"
                          className="text-link"
                          style={{ fontSize: 11 }}
                          onClick={() => setViewingEmployee(emp)}
                        >
                          View →
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    className="button outline-btn mini-btn"
                    style={{ marginTop: 6, width: '100%' }}
                    onClick={() => {
                      setDeptFilter(dept);
                      setActiveTab('directory');
                    }}
                  >
                    Filter Directory by {dept}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* 6. Tab: Staff Reports */}
      {activeTab === 'reports' && (
        <section className="sp-panel">
          <div className="sp-panel-head">
            <div>
              <h2 className="sp-panel-title">Staff Reports &amp; Analytics</h2>
              <p className="sp-panel-sub">Headcount distribution, employment breakdown, and data export</p>
            </div>
            <button type="button" className="sp-btn-gold" onClick={exportStaffCSV}>
              <span>📥 Export Staff Directory (CSV)</span>
            </button>
          </div>

          <div className="sp-stats-grid" style={{ marginBottom: 20 }}>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Active Headcount</span>
                <strong className="sp-stat-count">{activeStaff.length}</strong>
                <span className="sp-stat-sublabel">
                  {rows.length > 0 ? `${Math.round((activeStaff.length / rows.length) * 100)}% retention rate` : '0%'}
                </span>
              </div>
            </div>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Full Time Staff</span>
                <strong className="sp-stat-count">
                  {rows.filter((r) => r.employment === 'full_time').length}
                </strong>
                <span className="sp-stat-sublabel">Standard 8-hr scheduled shift</span>
              </div>
            </div>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Part Time Staff</span>
                <strong className="sp-stat-count">
                  {rows.filter((r) => r.employment === 'part_time').length}
                </strong>
                <span className="sp-stat-sublabel">Hourly / peak floor coverage</span>
              </div>
            </div>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Monthly Salary Base</span>
                <strong className="sp-stat-count" style={{ fontSize: 24 }}>
                  {money(monthlyEstimatePaise)}
                </strong>
                <span className="sp-stat-sublabel">Monthly payroll commitment</span>
              </div>
            </div>
          </div>

          <div className="sp-advanced-box">
            <h4 style={{ margin: '0 0 8px', color: 'var(--erp-maroon)' }}>Department Breakdown</h4>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }}>
              {distinctDepartments.map((dept) => {
                const count = rows.filter((r) => (r.department || 'Retail Sales') === dept).length;
                return (
                  <div
                    key={dept}
                    style={{
                      padding: '12px 14px',
                      background: '#FFFFFF',
                      border: '1px solid var(--erp-border)',
                      borderRadius: 8,
                    }}
                  >
                    <span style={{ fontSize: 12, color: '#888', display: 'block' }}>{dept}</span>
                    <strong style={{ fontSize: 18, color: 'var(--erp-maroon)' }}>{count} employees</strong>
                  </div>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* 7. Comprehensive Add / Edit Employee Modal */}
      {modal && (
        <div
          className="luxury-modal-overlay"
          onClick={() => !busy && setModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="luxury-modal-card"
            style={{ maxWidth: 680, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">✦ MAGARANTHAM SILKS · STAFF MANAGEMENT</span>
                <h2 className="modal-title">
                  {modal.id ? `Edit Staff Member (${modal.code})` : 'Add New Staff Member'}
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

            {/* Modal Internal Tabs */}
            <div style={{ display: 'flex', gap: 4, borderBottom: '1px solid var(--erp-border)', padding: '0 20px', background: '#FAF6F0' }}>
              {[
                { key: 'basic', label: '1. Identity & Contact' },
                { key: 'job', label: '2. Role & Dept' },
                { key: 'salary', label: '3. Salary & Policy' },
                { key: 'bank', label: '4. Bank Details' },
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  style={{
                    padding: '10px 14px',
                    fontSize: 12,
                    fontWeight: modalTab === t.key ? 700 : 500,
                    border: 'none',
                    borderBottom: modalTab === t.key ? '2px solid var(--erp-maroon)' : '2px solid transparent',
                    background: 'transparent',
                    color: modalTab === t.key ? 'var(--erp-maroon)' : 'var(--erp-text-muted)',
                    cursor: 'pointer',
                  }}
                  onClick={() => setModalTab(t.key as any)}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {error && (
              <div className="modal-error-banner" role="alert" style={{ margin: '14px 20px 0' }}>
                {error}
              </div>
            )}

            <form onSubmit={handleSave} className="modal-form-body" style={{ padding: 20 }}>
              {/* Tab 1: Basic Identity & Contact */}
              {modalTab === 'basic' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="row-inputs-2">
                    <label className="input-group">
                      <span>Full Name *</span>
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
                      <span>Staff Code / ID *</span>
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
                      <span>Mobile Phone</span>
                      <input
                        type="tel"
                        maxLength={25}
                        placeholder="+91 98765 43210"
                        value={modal.phone}
                        onChange={(e) => setModal({ ...modal, phone: e.target.value })}
                      />
                    </label>
                    <label className="input-group">
                      <span>Email Address</span>
                      <input
                        type="email"
                        maxLength={120}
                        placeholder="staff@magaranthamsilks.com"
                        value={modal.email}
                        onChange={(e) => setModal({ ...modal, email: e.target.value })}
                      />
                    </label>
                  </div>

                  <label className="input-group">
                    <span>Emergency Contact Person &amp; Phone</span>
                    <input
                      type="text"
                      maxLength={100}
                      placeholder="e.g. Ramesh (Spouse) - +91 98401 23456"
                      value={modal.emergency_contact}
                      onChange={(e) => setModal({ ...modal, emergency_contact: e.target.value })}
                    />
                  </label>

                  <label className="input-group">
                    <span>Residential Address</span>
                    <textarea
                      rows={2}
                      placeholder="Door No, Street, Landmark, City, Pincode"
                      value={modal.address}
                      onChange={(e) => setModal({ ...modal, address: e.target.value })}
                    />
                  </label>

                  <label className="input-group">
                    <span>Profile Photo URL</span>
                    <input
                      type="url"
                      placeholder="https://... photo link (or upload in Profile view)"
                      value={modal.photo_url}
                      onChange={(e) => setModal({ ...modal, photo_url: e.target.value })}
                    />
                  </label>
                </div>
              )}

              {/* Tab 2: Job Role & Department */}
              {modalTab === 'job' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="row-inputs-2">
                    <label className="input-group">
                      <span>Department *</span>
                      <select
                        value={modal.department}
                        onChange={(e) => setModal({ ...modal, department: e.target.value })}
                      >
                        {DEPARTMENT_OPTIONS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </label>

                    <label className="input-group">
                      <span>Job Role / Designation *</span>
                      <input
                        type="text"
                        list="designation-suggestions"
                        required
                        placeholder="e.g. Senior Sales Executive"
                        value={modal.designation}
                        onChange={(e) => setModal({ ...modal, designation: e.target.value })}
                      />
                      <datalist id="designation-suggestions">
                        {DESIGNATION_PRESETS.map((p) => (
                          <option key={p} value={p} />
                        ))}
                      </datalist>
                    </label>
                  </div>

                  <div className="row-inputs-2">
                    <label className="input-group">
                      <span>Employment Type</span>
                      <select
                        value={modal.employment}
                        onChange={(e) =>
                          setModal({
                            ...modal,
                            employment: e.target.value === 'part_time' ? 'part_time' : 'full_time',
                          })
                        }
                      >
                        <option value="full_time">Full Time (Regular)</option>
                        <option value="part_time">Part Time (Flexible)</option>
                      </select>
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

                  <div className="row-inputs-2">
                    <label className="input-group">
                      <span>Last Working Date (if relieved)</span>
                      <input
                        type="date"
                        value={modal.ended_on}
                        onChange={(e) => setModal({ ...modal, ended_on: e.target.value })}
                      />
                    </label>

                    <div style={{ display: 'flex', alignItems: 'center', marginTop: 22 }}>
                      <label className="checkbox-item">
                        <input
                          type="checkbox"
                          checked={modal.active}
                          onChange={(e) => setModal({ ...modal, active: e.target.checked })}
                        />
                        <span style={{ fontWeight: 600, color: modal.active ? '#166534' : '#64748B' }}>
                          {modal.active ? 'Active Staff Member' : 'Inactive (Resigned/Relieved)'}
                        </span>
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Tab 3: Salary & Policy */}
              {modalTab === 'salary' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="row-inputs-3">
                    <label className="input-group">
                      <span>Salary Basis</span>
                      <select
                        value={modal.pay_basis}
                        onChange={(e) =>
                          setModal({
                            ...modal,
                            pay_basis: e.target.value as StaffForm['pay_basis'],
                          })
                        }
                      >
                        <option value="monthly">Monthly Fixed</option>
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
                        step="0.01"
                        required
                        placeholder="e.g. 25000"
                        value={modal.rateRupees}
                        onChange={(e) => setModal({ ...modal, rateRupees: e.target.value })}
                      />
                    </label>

                    <label className="input-group">
                      <span>Daily Work Time (Hrs)</span>
                      <input
                        type="number"
                        min="1"
                        max="24"
                        step="0.5"
                        placeholder="8"
                        value={modal.dailyHours}
                        onChange={(e) => setModal({ ...modal, dailyHours: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className="row-inputs-2">
                    <label className="input-group">
                      <span>Overtime Rate (₹ / hr)</span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="e.g. 150"
                        value={modal.overtimeRupees}
                        onChange={(e) => setModal({ ...modal, overtimeRupees: e.target.value })}
                      />
                    </label>

                    <label className="input-group">
                      <span>Attendance &amp; Salary Rule *</span>
                      <select
                        required
                        value={modal.policy_id}
                        onChange={(e) => setModal({ ...modal, policy_id: e.target.value })}
                      >
                        {policies.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} {p.active ? '' : '(Inactive)'}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>

                  <ComponentsInput
                    label="Recurring Monthly Allowances (e.g. Conveyance, Food)"
                    value={modal.allowances}
                    onChange={(allowances) => setModal({ ...modal, allowances })}
                  />

                  <ComponentsInput
                    label="Recurring Monthly Deductions (e.g. PF, Loan, Advance)"
                    value={modal.deductions}
                    onChange={(deductions) => setModal({ ...modal, deductions })}
                  />
                </div>
              )}

              {/* Tab 4: Bank Details */}
              {modalTab === 'bank' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div className="row-inputs-2">
                    <label className="input-group">
                      <span>Bank Name</span>
                      <input
                        type="text"
                        placeholder="e.g. State Bank of India"
                        value={modal.bank_name}
                        onChange={(e) => setModal({ ...modal, bank_name: e.target.value })}
                      />
                    </label>

                    <label className="input-group">
                      <span>Account Number</span>
                      <input
                        type="text"
                        placeholder="e.g. 123456789012"
                        value={modal.account_number}
                        onChange={(e) => setModal({ ...modal, account_number: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className="row-inputs-2">
                    <label className="input-group">
                      <span>IFSC Code</span>
                      <input
                        type="text"
                        placeholder="e.g. SBIN0001234"
                        value={modal.ifsc_code}
                        onChange={(e) => setModal({ ...modal, ifsc_code: e.target.value.toUpperCase() })}
                      />
                    </label>

                    <label className="input-group">
                      <span>Branch Location</span>
                      <input
                        type="text"
                        placeholder="e.g. T. Nagar, Chennai"
                        value={modal.branch}
                        onChange={(e) => setModal({ ...modal, branch: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              )}

              <div className="modal-actions-footer" style={{ marginTop: 20 }}>
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={busy}
                  onClick={() => setModal(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="sp-btn-maroon" disabled={busy}>
                  {busy ? 'Saving...' : modal.id ? 'Save Changes' : '+ Save Staff Member'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingTarget && (
        <div
          className="luxury-modal-overlay"
          onClick={() => !deletingBusy && setDeletingTarget(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="luxury-modal-card"
            style={{ maxWidth: 440 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: '#B91C1C' }}>
                Delete Staff Member?
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                disabled={deletingBusy}
                onClick={() => setDeletingTarget(null)}
              >
                ✕
              </button>
            </div>
            <div className="modal-form-body">
              <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.5 }}>
                Are you sure you want to remove <strong>{deletingTarget.name}</strong> ({deletingTarget.code})?
                If historical payroll runs exist, the employee will be deactivated to preserve audit records.
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
                  style={{ background: '#B91C1C', borderColor: '#991B1B', color: '#FFF' }}
                  disabled={deletingBusy}
                  onClick={() => void confirmDeleteEmployee()}
                >
                  {deletingBusy ? 'Removing...' : 'Confirm Delete'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Password Reset Modal */}
      {resetTarget && (
        <div
          className="luxury-modal-overlay"
          onClick={() => !resetBusy && setResetTarget(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="luxury-modal-card"
            style={{ maxWidth: 440 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <h2 className="modal-title">Reset Staff Password</h2>
              <button
                type="button"
                className="modal-close-btn"
                disabled={resetBusy}
                onClick={() => setResetTarget(null)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleResetPassword} className="modal-form-body">
              <p style={{ margin: '0 0 14px', fontSize: 13 }}>
                Update login password for <strong>{resetTarget.name}</strong> ({resetTarget.code}):
              </p>
              <label className="input-group">
                <span>New Password (min 6 characters) *</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoFocus
                  placeholder="Enter new secure password"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
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
                <button type="submit" className="sp-btn-maroon" disabled={resetBusy}>
                  {resetBusy ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
