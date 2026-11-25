'use client';
import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { indiaDate } from '@/lib/barcode';
import { money } from '@/lib/core';
import { api } from '../api';
import { References, Row, useERP } from './shared';

export function formatHoursMinutes(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes || 0));
  if (m === 0) return '0 mins';
  const hrs = Math.floor(m / 60);
  const mins = m % 60;
  if (hrs > 0 && mins > 0) {
    return `${hrs} hr${hrs > 1 ? 's' : ''} ${mins} min${mins > 1 ? 's' : ''}`;
  }
  if (hrs > 0) {
    return `${hrs} hr${hrs > 1 ? 's' : ''}`;
  }
  return `${mins} mins`;
}

export function formatHoursMinutesShort(totalMinutes: number): string {
  const m = Math.max(0, Math.round(totalMinutes || 0));
  if (m === 0) return '0m';
  const hrs = Math.floor(m / 60);
  const mins = m % 60;
  if (hrs > 0 && mins > 0) {
    return `${hrs}h ${mins}m`;
  }
  if (hrs > 0) {
    return `${hrs}h`;
  }
  return `${mins}m`;
}

export const STATUS_OPTIONS: {
  key: string;
  label: string;
  short: string;
  tone: 'ok' | 'half' | 'warn' | 'bad' | 'muted';
  color: string;
  bg: string;
  border: string;
}[] = [
  { key: 'full_day', label: 'Present', short: 'P', tone: 'ok', color: '#166534', bg: '#DCFCE7', border: '#86EFAC' },
  { key: 'absent', label: 'Absent', short: 'A', tone: 'bad', color: '#991B1B', bg: '#FEE2E2', border: '#FCA5A5' },
  { key: 'leave', label: 'Leave', short: 'L', tone: 'warn', color: '#C2410C', bg: '#FFEDD5', border: '#FDBA74' },
  { key: 'half_day', label: 'Half Day', short: 'HD', tone: 'half', color: '#A16207', bg: '#FEF9C3', border: '#FDE047' },
  { key: 'holiday', label: 'Holiday', short: 'H', tone: 'muted', color: '#1D4ED8', bg: '#DBEAFE', border: '#93C5FD' },
  { key: 'weekly_off', label: 'Week Off', short: 'WO', tone: 'muted', color: '#475569', bg: '#F1F5F9', border: '#CBD5E1' },
];

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDateLong(iso: string): string {
  try {
    const d = new Date(`${iso}T00:00:00Z`);
    return d.toLocaleDateString('en-IN', {
      weekday: 'long',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return iso;
  }
}

export function Attendance({ refs }: { refs: References }) {
  const today = indiaDate();
  const searchParams = useSearchParams();

  // Primary Tabs: daily | monthly | leaves | overtime
  const [tab, setTab] = useState<'daily' | 'monthly' | 'leaves' | 'overtime'>('daily');

  // Daily State
  const [selectedDate, setSelectedDate] = useState(today);
  const [searchDaily, setSearchDaily] = useState('');
  const [deptFilterDaily, setDeptFilterDaily] = useState('all');
  const [savingEmpId, setSavingEmpId] = useState<string | null>(null);
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});
  const [showMarkAllConfirm, setShowMarkAllConfirm] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [openMoreEmpId, setOpenMoreEmpId] = useState<string | null>(null);

  // Month Rows & Monthly Filter State
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [filterEmployeeId, setFilterEmployeeId] = useState('all');
  const [filterDeptMonthly, setFilterDeptMonthly] = useState('all');
  const [monthRows, setMonthRows] = useState<Row[]>([]);
  const [monthLoading, setMonthLoading] = useState(false);

  // Leave Management State
  const [leaveRows, setLeaveRows] = useState<Row[]>([]);
  const [leaveStatusFilter, setLeaveStatusFilter] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all');
  const [leaveTypeFilter, setLeaveTypeFilter] = useState('all');
  const [showApplyLeaveModal, setShowApplyLeaveModal] = useState(false);
  const [leaveSubmitting, setLeaveSubmitting] = useState(false);
  const [leaveFormData, setLeaveFormData] = useState({
    employee_id: '',
    leave_type: 'casual',
    start_date: today,
    end_date: today,
    days: 1,
    reason: '',
  });

  // Overtime State & Modal
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  const [editingDetail, setEditingDetail] = useState<{
    employee: Row;
    work_on: string;
    status: string;
    leave_units: number;
    overtime_minutes: number;
    note: string;
  } | null>(null);

  const { notice } = useERP();
  const allStaff = refs.employees || [];
  const activeStaff = useMemo(
    () => allStaff.filter((e) => e.active !== false),
    [allStaff],
  );

  const distinctDepts = useMemo(() => {
    const set = new Set<string>();
    for (const s of allStaff) {
      set.add(s.department || 'Retail Sales');
    }
    return Array.from(set);
  }, [allStaff]);

  // Handle URL tab & employee_id query params from sidebar or directory
  useEffect(() => {
    const tabParam = searchParams.get('tab');
    if (tabParam === 'monthly') setTab('monthly');
    else if (tabParam === 'leaves') setTab('leaves');
    else if (tabParam === 'overtime') setTab('overtime');

    const empParam = searchParams.get('employee_id');
    if (empParam) {
      setFilterEmployeeId(empParam);
      if (!tabParam) setTab('monthly');
    }
  }, [searchParams]);

  // Determine active month for API query
  const activeMonth = tab === 'daily' ? selectedDate.slice(0, 7) : selectedMonth;

  async function loadMonth(monthStr = activeMonth) {
    if (!monthStr) return;
    setMonthLoading(true);
    try {
      const r = await api<Row>(`/api/erp/attendance?month=${monthStr}&page=0`);
      setMonthRows(r.rows || []);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setMonthLoading(false);
    }
  }

  async function loadLeaves() {
    try {
      const r = await api<{ rows: Row[] }>('/api/admin/employee_leaves');
      setLeaveRows(r.rows || []);
    } catch (e) {
      // silently ignore if not found
    }
  }

  useEffect(() => {
    void loadMonth(activeMonth);
  }, [activeMonth]);

  useEffect(() => {
    if (tab === 'leaves') {
      void loadLeaves();
    }
  }, [tab]);

  // Map employeeId -> attendance record for selectedDate
  const dayByEmployee = useMemo(() => {
    const map = new Map<string, Row>();
    for (const r of monthRows) {
      if (r.work_on === selectedDate) {
        map.set(r.employee_id, r);
      }
    }
    return map;
  }, [monthRows, selectedDate]);

  // Daily Summary counts for selectedDate
  const dailySummary = useMemo(() => {
    let present = 0;
    let absent = 0;
    let leave = 0;
    let halfDay = 0;
    let holiday = 0;
    let weekOff = 0;

    for (const emp of activeStaff) {
      const rec = dayByEmployee.get(emp.id);
      if (!rec) continue;
      if (rec.status === 'full_day') present++;
      else if (rec.status === 'half_day') {
        present++;
        halfDay++;
      } else if (rec.status === 'leave') leave++;
      else if (rec.status === 'absent') absent++;
      else if (rec.status === 'holiday') holiday++;
      else if (rec.status === 'weekly_off') weekOff++;
    }

    const totalStaff = activeStaff.length;
    // Circular Percentage: effective present / total active staff
    const effectivePresent = present - halfDay * 0.5;
    const percentage = totalStaff > 0 ? Math.round((effectivePresent / totalStaff) * 100) : 0;

    return { totalStaff, present, absent, leave, halfDay, holiday, weekOff, percentage };
  }, [activeStaff, dayByEmployee]);

  // Filtered employees for Daily table
  const filteredDailyStaff = useMemo(() => {
    const q = searchDaily.trim().toLowerCase();
    return activeStaff.filter((emp) => {
      const dept = emp.department || 'Retail Sales';
      if (deptFilterDaily !== 'all' && dept !== deptFilterDaily) return false;
      if (!q) return true;
      const haystack = `${emp.name || ''} ${emp.code || ''} ${emp.designation || ''} ${dept}`.toLowerCase();
      return haystack.includes(q);
    });
  }, [activeStaff, searchDaily, deptFilterDaily]);

  // Save attendance status for an employee
  async function markStatus(
    emp: Row,
    status: string,
    extra?: {
      work_on?: string;
      leave_units?: number;
      overtime_minutes?: number;
      note?: string;
    },
  ) {
    const workOn = extra?.work_on || selectedDate;
    const dailyMins = Number(emp.daily_minutes || 480);
    const workedMins =
      status === 'half_day'
        ? Math.floor(dailyMins / 2)
        : status === 'full_day'
          ? dailyMins
          : 0;

    setSavingEmpId(emp.id);
    setSaveErrors((prev) => {
      const copy = { ...prev };
      delete copy[emp.id];
      return copy;
    });

    // Optimistic UI update in monthRows
    const tempRecord: Row = {
      id: `${emp.id}_${workOn}`,
      employee_id: emp.id,
      work_on: workOn,
      status,
      leave_units: extra?.leave_units === 0.5 ? 0.5 : 1,
      worked_minutes: workedMins,
      overtime_minutes: Math.max(0, Math.round(Number(extra?.overtime_minutes || 0))),
      note: (extra?.note || '').trim(),
      updated_at: new Date().toISOString(),
    };

    setMonthRows((prev) => {
      const idx = prev.findIndex((r) => r.employee_id === emp.id && r.work_on === workOn);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = { ...next[idx], ...tempRecord };
        return next;
      }
      return [...prev, tempRecord];
    });

    try {
      await api('/api/erp/attendance', {
        employee_id: emp.id,
        work_on: workOn,
        data: {
          status,
          leave_units: extra?.leave_units === 0.5 ? 0.5 : 1,
          permission_minutes: 0,
          worked_minutes: workedMins,
          overtime_minutes: Math.max(0, Math.round(Number(extra?.overtime_minutes || 0))),
          note: (extra?.note || '').trim(),
        },
      });
      await loadMonth(workOn.slice(0, 7));
    } catch (e) {
      const errMsg = (e as Error).message || 'Failed to save attendance.';
      setSaveErrors((prev) => ({ ...prev, [emp.id]: errMsg }));
      notice(errMsg);
    } finally {
      setSavingEmpId(null);
      setOpenMoreEmpId(null);
    }
  }

  // Bulk mark all active staff present
  async function handleConfirmMarkAll() {
    if (!activeStaff.length) return;
    setBulkSaving(true);
    setShowMarkAllConfirm(false);
    let saved = 0;
    let failed = 0;

    for (const emp of activeStaff) {
      const dailyMins = Number(emp.daily_minutes || 480);
      try {
        await api('/api/erp/attendance', {
          employee_id: emp.id,
          work_on: selectedDate,
          data: {
            status: 'full_day',
            leave_units: 1,
            permission_minutes: 0,
            worked_minutes: dailyMins,
            overtime_minutes: 0,
            note: 'Marked present (bulk roll call)',
          },
        });
        saved++;
      } catch {
        failed++;
      }
    }
    await loadMonth(selectedDate.slice(0, 7));
    setBulkSaving(false);
    notice(
      failed === 0
        ? `Marked ${saved} staff member${saved === 1 ? '' : 's'} Present for ${selectedDate}.`
        : `${saved} marked present, ${failed} failed (check locked payroll).`,
    );
  }

  // Reload current date attendance (Reset/Undo local modifications)
  async function handleResetCurrentDate() {
    setShowResetConfirm(false);
    await loadMonth(selectedDate.slice(0, 7));
    setSaveErrors({});
    notice(`Attendance reloaded from database for ${selectedDate}.`);
  }

  // Monthly Attendance Stats & Matrix calculation
  const monthlyData = useMemo(() => {
    // Filter staff
    let staffList = allStaff;
    if (filterEmployeeId !== 'all') {
      staffList = staffList.filter((s) => s.id === filterEmployeeId);
    }
    if (filterDeptMonthly !== 'all') {
      staffList = staffList.filter((s) => (s.department || 'Retail Sales') === filterDeptMonthly);
    }

    // Days in selected month
    const [yearStr, monthStr] = selectedMonth.split('-');
    const year = Number(yearStr);
    const month = Number(monthStr);
    const daysInMonth = new Date(year, month, 0).getDate();

    let totalWorkingDays = 0;
    let totalPresent = 0;
    let totalAbsent = 0;
    let totalLeave = 0;
    let totalHalf = 0;
    let totalHoliday = 0;
    let totalWeekOff = 0;
    let totalOTMins = 0;

    for (const r of monthRows) {
      if (filterEmployeeId !== 'all' && r.employee_id !== filterEmployeeId) continue;
      if (filterDeptMonthly !== 'all') {
        const emp = allStaff.find((s) => s.id === r.employee_id);
        if ((emp?.department || 'Retail Sales') !== filterDeptMonthly) continue;
      }

      if (r.status === 'full_day') totalPresent++;
      else if (r.status === 'half_day') totalHalf++;
      else if (r.status === 'leave') totalLeave++;
      else if (r.status === 'absent') totalAbsent++;
      else if (r.status === 'holiday') totalHoliday++;
      else if (r.status === 'weekly_off') totalWeekOff++;
      totalOTMins += Number(r.overtime_minutes || 0);
    }

    // Default working days is ~26 or sum of recorded working shifts
    totalWorkingDays = Math.max(26, daysInMonth - 4);

    return {
      staffList,
      daysInMonth,
      year,
      month,
      totalWorkingDays,
      totalPresent,
      totalAbsent,
      totalLeave,
      totalHalf,
      totalHoliday,
      totalWeekOff,
      totalOTMins,
    };
  }, [allStaff, monthRows, selectedMonth, filterEmployeeId, filterDeptMonthly]);

  // Export Monthly CSV
  function exportMonthlyCSV() {
    const { daysInMonth, staffList } = monthlyData;
    const dayHeaders = Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, '0'));
    const headers = ['Employee ID', 'Name', 'Role', 'Department', ...dayHeaders, 'Present', 'Half', 'Leave', 'Absent', 'Overtime (Hrs)'];
    const csvLines = [headers.join(',')];

    for (const emp of staffList) {
      const empRows = monthRows.filter((r) => r.employee_id === emp.id);
      let pCount = 0;
      let hCount = 0;
      let lCount = 0;
      let aCount = 0;
      let otMins = 0;

      const dayMarks = dayHeaders.map((dStr) => {
        const dateStr = `${selectedMonth}-${dStr}`;
        const rec = empRows.find((r) => r.work_on === dateStr);
        if (!rec) return '—';
        if (rec.status === 'full_day') { pCount++; return 'P'; }
        if (rec.status === 'half_day') { hCount++; return 'HD'; }
        if (rec.status === 'leave') { lCount++; return 'L'; }
        if (rec.status === 'absent') { aCount++; return 'A'; }
        if (rec.status === 'holiday') return 'H';
        if (rec.status === 'weekly_off') return 'WO';
        otMins += Number(rec.overtime_minutes || 0);
        return rec.status;
      });

      const row = [
        `"${emp.code}"`,
        `"${emp.name}"`,
        `"${emp.designation || 'Staff'}"`,
        `"${emp.department || 'Retail Sales'}"`,
        ...dayMarks.map((m) => `"${m}"`),
        pCount,
        hCount,
        lCount,
        aCount,
        (otMins / 60).toFixed(1),
      ];
      csvLines.push(row.join(','));
    }

    const blob = new Blob([csvLines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `magarantham_attendance_monthly_${selectedMonth}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Leave Management Handlers
  async function handleApproveLeave(leave: Row) {
    try {
      // 1. Update leave record
      await api('/api/admin/employee_leaves', {
        id: leave.id,
        data: {
          employee_id: leave.employee_id,
          leave_type: leave.leave_type,
          start_date: leave.start_date,
          end_date: leave.end_date,
          days: Number(leave.days || 1),
          reason: leave.reason || '',
          status: 'approved',
        },
      });

      // 2. Automatically mark attendance for the employee for those leave dates
      const start = new Date(leave.start_date);
      const end = new Date(leave.end_date);
      const cur = new Date(start);
      while (cur <= end) {
        const curIso = cur.toISOString().slice(0, 10);
        try {
          await api('/api/erp/attendance', {
            employee_id: leave.employee_id,
            work_on: curIso,
            data: {
              status: 'leave',
              leave_units: 1,
              permission_minutes: 0,
              worked_minutes: 0,
              overtime_minutes: 0,
              note: `Approved Leave: ${leave.leave_type}`,
            },
          });
        } catch {
          // payroll might be locked for past months, continue
        }
        cur.setDate(cur.getDate() + 1);
      }

      notice(`Leave approved for ${leave.start_date} to ${leave.end_date}. Attendance synced.`);
      await loadLeaves();
      await loadMonth(activeMonth);
    } catch (e) {
      notice((e as Error).message || 'Failed to approve leave.');
    }
  }

  async function handleRejectLeave(leave: Row) {
    try {
      await api('/api/admin/employee_leaves', {
        id: leave.id,
        data: {
          employee_id: leave.employee_id,
          leave_type: leave.leave_type,
          start_date: leave.start_date,
          end_date: leave.end_date,
          days: Number(leave.days || 1),
          reason: leave.reason || '',
          status: 'rejected',
        },
      });
      notice('Leave application rejected.');
      await loadLeaves();
    } catch (e) {
      notice((e as Error).message || 'Failed to reject leave.');
    }
  }

  async function handleSubmitApplyLeave(e: React.FormEvent) {
    e.preventDefault();
    if (!leaveFormData.employee_id) {
      notice('Please select an employee.');
      return;
    }
    setLeaveSubmitting(true);
    try {
      await api('/api/admin/employee_leaves', {
        data: {
          employee_id: leaveFormData.employee_id,
          leave_type: leaveFormData.leave_type,
          start_date: leaveFormData.start_date,
          end_date: leaveFormData.end_date,
          days: Number(leaveFormData.days || 1),
          reason: leaveFormData.reason.trim(),
          status: 'pending',
        },
      });
      notice('Leave application submitted.');
      setShowApplyLeaveModal(false);
      await loadLeaves();
    } catch (err) {
      notice((err as Error).message || 'Failed to submit leave.');
    } finally {
      setLeaveSubmitting(false);
    }
  }

  // Filtered leaves
  const filteredLeaves = useMemo(() => {
    return leaveRows.filter((l) => {
      if (leaveStatusFilter !== 'all' && l.status !== leaveStatusFilter) return false;
      if (leaveTypeFilter !== 'all' && l.leave_type !== leaveTypeFilter) return false;
      return true;
    });
  }, [leaveRows, leaveStatusFilter, leaveTypeFilter]);

  // Overtime rows from monthRows
  const overtimeRows = useMemo(() => {
    return monthRows
      .filter((r) => Number(r.overtime_minutes || 0) > 0)
      .sort((a, b) => (a.work_on < b.work_on ? 1 : -1));
  }, [monthRows]);

  const totalOvertimeHours = useMemo(() => {
    const mins = overtimeRows.reduce((sum, r) => sum + Number(r.overtime_minutes || 0), 0);
    return Math.round((mins / 60) * 10) / 10;
  }, [overtimeRows]);

  const totalOvertimeCostEstimate = useMemo(() => {
    let costPaise = 0;
    for (const r of overtimeRows) {
      const emp = allStaff.find((s) => s.id === r.employee_id);
      const hourlyRatePaise = Number(emp?.overtime_rate_paise || 0);
      const hours = Number(r.overtime_minutes || 0) / 60;
      costPaise += Math.round(hours * hourlyRatePaise);
    }
    return costPaise;
  }, [overtimeRows, allStaff]);

  // Circular progress stroke calculation
  const radius = 32;
  const circumference = 2 * Math.PI * radius; // 201.06
  const strokeDashoffset = circumference - (dailySummary.percentage / 100) * circumference;

  if (allStaff.length === 0) {
    return (
      <div className="sp-premium-root">
        <div className="sp-empty-card" style={{ padding: '40px 24px', margin: 20 }}>
          <h3 style={{ fontFamily: 'var(--serif)', fontSize: 24, color: 'var(--erp-maroon)' }}>
            Add your staff members first
          </h3>
          <p style={{ maxWidth: 440, color: '#777', margin: '8px 0 16px' }}>
            Before recording daily attendance, register your shop staff and assign their daily shift hours in Staff Management.
          </p>
          <Link href="/admin/employees" className="sp-btn-maroon">
            + Go to Staff Management →
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="sp-premium-root">
      {/* 1. Header with Title, Subtitle, and Date Controls on Right */}
      <div className="sp-premium-header">
        <div className="sp-header-left">
          <p className="sp-header-eyebrow">MAGARANTHAM SILKS · ATTENDANCE REGISTER</p>
          <h1 className="sp-header-title">
            {tab === 'daily'
              ? 'Daily Attendance'
              : tab === 'monthly'
                ? 'Monthly Attendance Reports'
                : tab === 'leaves'
                  ? 'Leave Management'
                  : 'Overtime Reports'}
          </h1>
          <p className="sp-header-subtitle">
            {tab === 'daily'
              ? 'Mark and track daily attendance.'
              : tab === 'monthly'
                ? 'Comprehensive monthly attendance register and calendar view.'
                : tab === 'leaves'
                  ? 'Review, approve, and track employee leave applications.'
                  : 'Track staff overtime hours and estimated compensation.'}
          </p>
        </div>

        {/* Date Controls on Right (for Daily Attendance) */}
        {tab === 'daily' && (
          <div className="sp-header-actions">
            <div className="sp-date-nav">
              <button
                type="button"
                className="button outline-btn mini-btn"
                onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
                title="Previous Day"
              >
                ◀ Prev
              </button>
              <input
                type="date"
                max={today}
                value={selectedDate}
                onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                className="sp-date-input"
                aria-label="Attendance Date"
              />
              <button
                type="button"
                className="button outline-btn mini-btn"
                disabled={selectedDate >= today}
                onClick={() => {
                  const next = shiftDate(selectedDate, 1);
                  setSelectedDate(next > today ? today : next);
                }}
                title="Next Day"
              >
                Next ▶
              </button>
              {selectedDate !== today && (
                <button
                  type="button"
                  className="button gold-btn mini-btn"
                  onClick={() => setSelectedDate(today)}
                >
                  Today
                </button>
              )}
            </div>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: 'var(--erp-maroon)',
                background: '#FAF5EE',
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid #EAD5C0',
              }}
            >
              📅 {formatDateLong(selectedDate)}
            </span>
          </div>
        )}
      </div>

      {/* 2. Top Navigation Tabs */}
      <div className="sp-section-tabs-bar">
        <button
          type="button"
          className={`sp-section-tab ${tab === 'daily' ? 'active' : ''}`}
          onClick={() => setTab('daily')}
        >
          <span>Daily Roll Call</span>
          <span className="sp-tab-badge">{dailySummary.present} / {activeStaff.length}</span>
        </button>
        <button
          type="button"
          className={`sp-section-tab ${tab === 'monthly' ? 'active' : ''}`}
          onClick={() => setTab('monthly')}
        >
          <span>Monthly Reports</span>
        </button>
        <button
          type="button"
          className={`sp-section-tab ${tab === 'leaves' ? 'active' : ''}`}
          onClick={() => setTab('leaves')}
        >
          <span>Leave Management</span>
          {leaveRows.filter((l) => l.status === 'pending').length > 0 && (
            <span className="sp-tab-badge" style={{ background: '#FEE2E2', color: '#991B1B' }}>
              {leaveRows.filter((l) => l.status === 'pending').length} pending
            </span>
          )}
        </button>
        <button
          type="button"
          className={`sp-section-tab ${tab === 'overtime' ? 'active' : ''}`}
          onClick={() => setTab('overtime')}
        >
          <span>Overtime Reports</span>
          <span className="sp-tab-badge">{totalOvertimeHours}h</span>
        </button>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: DAILY ATTENDANCE DASHBOARD */}
      {/* ========================================================================= */}
      {tab === 'daily' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* 4 Summary Cards + Circular Indicator */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: 16 }}>
            {/* 1. Total Staff */}
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Total Staff</span>
                <strong className="sp-stat-count">{dailySummary.totalStaff}</strong>
                <span className="sp-stat-sublabel">Eligible active employees</span>
              </div>
              <div className="sp-stat-icon-wrap tone-total">👥</div>
            </div>

            {/* 2. Present */}
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Present</span>
                <strong className="sp-stat-count" style={{ color: '#166534' }}>{dailySummary.present}</strong>
                <span className="sp-stat-sublabel">{dailySummary.halfDay} marked half day</span>
              </div>
              <div className="sp-stat-icon-wrap tone-present">✓</div>
            </div>

            {/* 3. Absent */}
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Absent</span>
                <strong className="sp-stat-count" style={{ color: '#991B1B' }}>{dailySummary.absent}</strong>
                <span className="sp-stat-sublabel">Unplanned absences</span>
              </div>
              <div className="sp-stat-icon-wrap tone-absent">✕</div>
            </div>

            {/* 4. Leave */}
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Leave</span>
                <strong className="sp-stat-count" style={{ color: '#C2410C' }}>{dailySummary.leave}</strong>
                <span className="sp-stat-sublabel">Approved &amp; applied leaves</span>
              </div>
              <div className="sp-stat-icon-wrap tone-leave">◷</div>
            </div>

            {/* Circular Percentage Indicator */}
            <div className="sp-circular-container">
              <div className="sp-circular-svg-wrap">
                <svg width="84" height="84" viewBox="0 0 84 84">
                  <circle
                    cx="42"
                    cy="42"
                    r={radius}
                    stroke="#EAD5C0"
                    strokeWidth="6"
                    fill="transparent"
                  />
                  <circle
                    cx="42"
                    cy="42"
                    r={radius}
                    stroke="#800020"
                    strokeWidth="6"
                    fill="transparent"
                    strokeDasharray={circumference}
                    strokeDashoffset={strokeDashoffset}
                    strokeLinecap="round"
                    transform="rotate(-90 42 42)"
                    style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                  />
                  <text
                    x="42"
                    y="48"
                    textAnchor="middle"
                    fontSize="17"
                    fontWeight="700"
                    fill="#800020"
                    fontFamily="var(--serif, serif)"
                  >
                    {dailySummary.percentage}%
                  </text>
                </svg>
              </div>
              <div className="sp-circular-meta">
                <span className="sp-circular-title">Attendance Rate</span>
                <span className="sp-circular-desc">
                  {dailySummary.present} of {dailySummary.totalStaff} staff active today
                </span>
              </div>
            </div>
          </div>

          {/* Quick Actions Bar */}
          <div className="sp-toolbar">
            <div className="sp-search-field">
              <span className="sp-search-icon">🔍</span>
              <input
                type="search"
                value={searchDaily}
                onChange={(e) => setSearchDaily(e.target.value)}
                placeholder="Filter attendance table by name or code..."
                className="sp-search-input"
              />
            </div>

            <div className="sp-filters-group">
              <select
                value={deptFilterDaily}
                onChange={(e) => setDeptFilterDaily(e.target.value)}
                className="sp-filter-select"
                aria-label="Department filter"
              >
                <option value="all">All Departments</option>
                {distinctDepts.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="button outline-btn mini-btn"
                disabled={bulkSaving}
                onClick={() => setShowResetConfirm(true)}
                title="Reload attendance data from database"
                style={{ height: 38 }}
              >
                ↺ Reset / Undo
              </button>

              <button
                type="button"
                className="sp-btn-maroon"
                disabled={bulkSaving || !activeStaff.length}
                onClick={() => setShowMarkAllConfirm(true)}
                style={{ height: 38 }}
              >
                {bulkSaving ? 'Saving All...' : '✓ Mark All Present'}
              </button>
            </div>
          </div>

          {/* Employee Attendance Table */}
          <div className="sp-panel" style={{ padding: 0 }}>
            <div className="table-responsive-wrapper">
              <table className="luxury-table" style={{ minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={{ width: 240, minWidth: 200, whiteSpace: 'nowrap' }}>Employee</th>
                    <th style={{ width: 120, minWidth: 110, whiteSpace: 'nowrap' }}>Employee ID</th>
                    <th style={{ width: 160, minWidth: 140, whiteSpace: 'nowrap' }}>Role</th>
                    <th style={{ minWidth: 240, whiteSpace: 'nowrap' }}>Attendance Status</th>
                    <th style={{ width: 120, minWidth: 110, textAlign: 'right', whiteSpace: 'nowrap' }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDailyStaff.map((emp) => {
                    const rec = dayByEmployee.get(emp.id);
                    const isSaving = savingEmpId === emp.id;
                    const saveErr = saveErrors[emp.id];
                    const initials = String(emp.name || 'S')
                      .split(' ')
                      .filter(Boolean)
                      .slice(0, 2)
                      .map((w) => w[0].toUpperCase())
                      .join('');

                    const isPresent = rec?.status === 'full_day';
                    const isAbsent = rec?.status === 'absent';
                    const isLeave = rec?.status === 'leave';

                    return (
                      <tr key={emp.id}>
                        {/* Employee */}
                        <td>
                          <div className="sp-staff-cell">
                            {emp.photo_url ? (
                              <img
                                src={emp.photo_url}
                                alt={emp.name}
                                style={{
                                  width: 36,
                                  height: 36,
                                  borderRadius: '50%',
                                  objectFit: 'cover',
                                  border: '2px solid var(--erp-gold)',
                                  flexShrink: 0,
                                }}
                              />
                            ) : (
                              <span className="sp-avatar" style={{ width: 36, height: 36 }}>
                                {initials || 'S'}
                              </span>
                            )}
                            <div>
                              <strong style={{ color: 'var(--erp-maroon)', fontSize: 13.5, display: 'block' }}>
                                {emp.name}
                              </strong>
                              <span style={{ fontSize: 11, color: '#888' }}>
                                {emp.department || 'Retail Sales'}
                              </span>
                            </div>
                          </div>
                        </td>

                        {/* Employee ID */}
                        <td>
                          <code
                            style={{
                              background: '#FAF5EE',
                              padding: '3px 7px',
                              borderRadius: 5,
                              color: 'var(--erp-maroon)',
                              fontWeight: 700,
                              fontSize: 12,
                              border: '1px solid #EAD5C0',
                            }}
                          >
                            {emp.code}
                          </code>
                        </td>

                        {/* Role */}
                        <td>
                          <span style={{ fontSize: 12.5, fontWeight: 500 }}>
                            {emp.designation || 'Sales Executive'}
                          </span>
                        </td>

                        {/* Attendance Status Buttons */}
                        <td>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                            <div className="sp-status-btn-group">
                              {/* Present Button */}
                              <button
                                type="button"
                                disabled={isSaving || bulkSaving}
                                className={`sp-btn-status present-btn ${isPresent ? 'is-active' : ''}`}
                                onClick={() => void markStatus(emp, 'full_day')}
                              >
                                {isPresent ? '✓ Present' : 'Present'}
                              </button>

                              {/* Absent Button */}
                              <button
                                type="button"
                                disabled={isSaving || bulkSaving}
                                className={`sp-btn-status absent-btn ${isAbsent ? 'is-active' : ''}`}
                                onClick={() => void markStatus(emp, 'absent')}
                              >
                                {isAbsent ? '✕ Absent' : 'Absent'}
                              </button>

                              {/* Leave Button */}
                              <button
                                type="button"
                                disabled={isSaving || bulkSaving}
                                className={`sp-btn-status leave-btn ${isLeave ? 'is-active' : ''}`}
                                onClick={() => void markStatus(emp, 'leave')}
                              >
                                {isLeave ? '◷ Leave' : 'Leave'}
                              </button>
                            </div>

                            {/* Status label if other status is set */}
                            {rec && !isPresent && !isAbsent && !isLeave && (
                              <span className={`sp-pill-status status-${rec.status}`}>
                                {rec.status.replace('_', ' ')}
                              </span>
                            )}

                            {/* Overtime & remarks hint */}
                            {rec?.overtime_minutes ? (
                              <span style={{ fontSize: 11, color: '#1D4ED8', fontWeight: 600 }}>
                                +{formatHoursMinutesShort(rec.overtime_minutes)} OT
                              </span>
                            ) : null}
                            {rec?.note ? (
                              <small style={{ color: '#888', fontStyle: 'italic', fontSize: 11 }}>
                                &quot;{rec.note}&quot;
                              </small>
                            ) : null}

                            {/* Real-time saving status feedback */}
                            {isSaving ? (
                              <span style={{ fontSize: 11, color: 'var(--erp-gold)', fontWeight: 600 }}>
                                Saving...
                              </span>
                            ) : saveErr ? (
                              <span style={{ fontSize: 11, color: '#B91C1C', fontWeight: 700 }}>
                                ⚠️ Error
                              </span>
                            ) : rec ? (
                              <span className="sp-badge-saved">Saved ✓</span>
                            ) : (
                              <span className="sp-badge-muted">Not marked</span>
                            )}
                          </div>
                        </td>

                        {/* Actions (More Dropdown) */}
                        <td style={{ textAlign: 'right' }}>
                          <div className="sp-more-dropdown">
                            <button
                              type="button"
                              className="sp-more-btn"
                              onClick={() => setOpenMoreEmpId(openMoreEmpId === emp.id ? null : emp.id)}
                            >
                              <span>More ▾</span>
                            </button>

                            {openMoreEmpId === emp.id && (
                              <div className="sp-more-menu" onClick={(e) => e.stopPropagation()}>
                                <button
                                  type="button"
                                  className={`sp-more-item ${rec?.status === 'half_day' ? 'is-selected' : ''}`}
                                  onClick={() => void markStatus(emp, 'half_day')}
                                >
                                  <span>½</span>
                                  <span>Half Day</span>
                                </button>
                                <button
                                  type="button"
                                  className={`sp-more-item ${rec?.status === 'holiday' ? 'is-selected' : ''}`}
                                  onClick={() => void markStatus(emp, 'holiday')}
                                >
                                  <span>★</span>
                                  <span>Holiday</span>
                                </button>
                                <button
                                  type="button"
                                  className={`sp-more-item ${rec?.status === 'weekly_off' ? 'is-selected' : ''}`}
                                  onClick={() => void markStatus(emp, 'weekly_off')}
                                >
                                  <span>☕</span>
                                  <span>Week Off</span>
                                </button>
                                <button
                                  type="button"
                                  className="sp-more-item"
                                  style={{ borderTop: '1px solid #EAD5C0', marginTop: 4, paddingTop: 6 }}
                                  onClick={() => {
                                    setOpenMoreEmpId(null);
                                    setEditingDetail({
                                      employee: emp,
                                      work_on: selectedDate,
                                      status: rec?.status || 'full_day',
                                      leave_units: Number(rec?.leave_units || 1),
                                      overtime_minutes: Number(rec?.overtime_minutes || 0),
                                      note: rec?.note || '',
                                    });
                                  }}
                                >
                                  <span>⏱</span>
                                  <span>+ Overtime / Notes</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Automatic Saving Feedback Footer */}
          <div className="sp-autosave-footer">
            <div className="sp-autosave-note">
              <span className="sp-autosave-icon">⚡</span>
              <span>Attendance will be automatically saved to Magarantham Silks database.</span>
            </div>
            <button
              type="button"
              className="button button-outline"
              onClick={() => setTab('monthly')}
            >
              View Monthly Report →
            </button>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: MONTHLY ATTENDANCE REPORT & CALENDAR REGISTER */}
      {/* ========================================================================= */}
      {tab === 'monthly' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Monthly Filters */}
          <div className="sp-toolbar">
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <label className="input-group" style={{ margin: 0, width: 'auto' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--erp-text-muted)' }}>Month:</span>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="sp-filter-select"
                />
              </label>

              <label className="input-group" style={{ margin: 0, width: 'auto' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--erp-text-muted)' }}>Employee:</span>
                <select
                  value={filterEmployeeId}
                  onChange={(e) => setFilterEmployeeId(e.target.value)}
                  className="sp-filter-select"
                >
                  <option value="all">All Employees ({allStaff.length})</option>
                  {allStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="input-group" style={{ margin: 0, width: 'auto' }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--erp-text-muted)' }}>Department:</span>
                <select
                  value={filterDeptMonthly}
                  onChange={(e) => setFilterDeptMonthly(e.target.value)}
                  className="sp-filter-select"
                >
                  <option value="all">All Departments</option>
                  {distinctDepts.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div style={{ display: 'flex', gap: 10 }}>
              <button type="button" className="sp-btn-gold" onClick={exportMonthlyCSV}>
                <span>📥 Export CSV</span>
              </button>
              <button
                type="button"
                className="button outline-btn mini-btn"
                style={{ height: 38 }}
                onClick={() => window.print()}
              >
                <span>🖨️ Print / PDF</span>
              </button>
            </div>
          </div>

          {/* 8 Metric Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 12 }}>
            <div className="sp-stat-card" style={{ padding: '14px 16px' }}>
              <div className="sp-stat-info">
                <span className="sp-stat-label">Working Days</span>
                <strong className="sp-stat-count" style={{ fontSize: 24 }}>{monthlyData.totalWorkingDays}</strong>
              </div>
            </div>
            <div className="sp-stat-card" style={{ padding: '14px 16px' }}>
              <div className="sp-stat-info">
                <span className="sp-stat-label">Present</span>
                <strong className="sp-stat-count" style={{ color: '#166534', fontSize: 24 }}>{monthlyData.totalPresent}</strong>
              </div>
            </div>
            <div className="sp-stat-card" style={{ padding: '14px 16px' }}>
              <div className="sp-stat-info">
                <span className="sp-stat-label">Half Days</span>
                <strong className="sp-stat-count" style={{ color: '#A16207', fontSize: 24 }}>{monthlyData.totalHalf}</strong>
              </div>
            </div>
            <div className="sp-stat-card" style={{ padding: '14px 16px' }}>
              <div className="sp-stat-info">
                <span className="sp-stat-label">Leaves</span>
                <strong className="sp-stat-count" style={{ color: '#C2410C', fontSize: 24 }}>{monthlyData.totalLeave}</strong>
              </div>
            </div>
            <div className="sp-stat-card" style={{ padding: '14px 16px' }}>
              <div className="sp-stat-info">
                <span className="sp-stat-label">Absent</span>
                <strong className="sp-stat-count" style={{ color: '#991B1B', fontSize: 24 }}>{monthlyData.totalAbsent}</strong>
              </div>
            </div>
            <div className="sp-stat-card" style={{ padding: '14px 16px' }}>
              <div className="sp-stat-info">
                <span className="sp-stat-label">Holidays</span>
                <strong className="sp-stat-count" style={{ color: '#1D4ED8', fontSize: 24 }}>{monthlyData.totalHoliday}</strong>
              </div>
            </div>
            <div className="sp-stat-card" style={{ padding: '14px 16px' }}>
              <div className="sp-stat-info">
                <span className="sp-stat-label">Week Offs</span>
                <strong className="sp-stat-count" style={{ color: '#475569', fontSize: 24 }}>{monthlyData.totalWeekOff}</strong>
              </div>
            </div>
            <div className="sp-stat-card" style={{ padding: '14px 16px' }}>
              <div className="sp-stat-info">
                <span className="sp-stat-label">Overtime</span>
                <strong className="sp-stat-count" style={{ color: '#800020', fontSize: 24 }}>
                  {Math.round((monthlyData.totalOTMins / 60) * 10) / 10}h
                </strong>
              </div>
            </div>
          </div>

          {/* Calendar Matrix Register */}
          <div className="sp-matrix-wrapper">
            <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--erp-border-light)', background: '#FAF6F0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong style={{ color: 'var(--erp-maroon)', fontSize: 14 }}>
                Monthly Register Grid ({selectedMonth})
              </strong>
              <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="sp-matrix-day-pill p">P</span> Present
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="sp-matrix-day-pill hd">HD</span> Half Day
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="sp-matrix-day-pill l">L</span> Leave
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="sp-matrix-day-pill a">A</span> Absent
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="sp-matrix-day-pill h">H</span> Holiday
                </span>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                  <span className="sp-matrix-day-pill wo">WO</span> Week Off
                </span>
              </div>
            </div>

            <table className="sp-matrix-table">
              <thead>
                <tr>
                  <th>Employee</th>
                  {Array.from({ length: monthlyData.daysInMonth }, (_, i) => {
                    const dayNum = i + 1;
                    const date = new Date(monthlyData.year, monthlyData.month - 1, dayNum);
                    const isSun = date.getDay() === 0;
                    return (
                      <th key={dayNum} style={{ background: isSun ? '#FFF1F2' : '#FFFFFF' }}>
                        <div style={{ fontSize: 10, color: '#888' }}>
                          {date.toLocaleDateString('en-US', { weekday: 'narrow' })}
                        </div>
                        <div style={{ fontWeight: 700, color: isSun ? '#BE123C' : '#332321' }}>{dayNum}</div>
                      </th>
                    );
                  })}
                  <th style={{ background: '#FAF5EE' }}>P</th>
                  <th style={{ background: '#FAF5EE' }}>A</th>
                  <th style={{ background: '#FAF5EE' }}>L</th>
                </tr>
              </thead>
              <tbody>
                {monthlyData.staffList.map((emp) => {
                  const empRecords = monthRows.filter((r) => r.employee_id === emp.id);
                  let countP = 0;
                  let countA = 0;
                  let countL = 0;

                  return (
                    <tr key={emp.id}>
                      <td>
                        <strong style={{ color: 'var(--erp-maroon)', fontSize: 12.5, display: 'block' }}>
                          {emp.name}
                        </strong>
                        <small style={{ color: '#888' }}>{emp.code}</small>
                      </td>

                      {Array.from({ length: monthlyData.daysInMonth }, (_, i) => {
                        const dayStr = String(i + 1).padStart(2, '0');
                        const dateStr = `${selectedMonth}-${dayStr}`;
                        const rec = empRecords.find((r) => r.work_on === dateStr);

                        if (!rec) {
                          return (
                            <td key={dayStr}>
                              <span className="sp-matrix-day-pill none">·</span>
                            </td>
                          );
                        }

                        if (rec.status === 'full_day') {
                          countP++;
                          return (
                            <td key={dayStr} title={`${dateStr}: Present`}>
                              <span className="sp-matrix-day-pill p">P</span>
                            </td>
                          );
                        }
                        if (rec.status === 'half_day') {
                          countP += 0.5;
                          return (
                            <td key={dayStr} title={`${dateStr}: Half Day`}>
                              <span className="sp-matrix-day-pill hd">HD</span>
                            </td>
                          );
                        }
                        if (rec.status === 'leave') {
                          countL++;
                          return (
                            <td key={dayStr} title={`${dateStr}: Leave (${rec.note || ''})`}>
                              <span className="sp-matrix-day-pill l">L</span>
                            </td>
                          );
                        }
                        if (rec.status === 'absent') {
                          countA++;
                          return (
                            <td key={dayStr} title={`${dateStr}: Absent`}>
                              <span className="sp-matrix-day-pill a">A</span>
                            </td>
                          );
                        }
                        if (rec.status === 'holiday') {
                          return (
                            <td key={dayStr} title={`${dateStr}: Holiday`}>
                              <span className="sp-matrix-day-pill h">H</span>
                            </td>
                          );
                        }
                        return (
                          <td key={dayStr} title={`${dateStr}: Week Off`}>
                            <span className="sp-matrix-day-pill wo">WO</span>
                          </td>
                        );
                      })}

                      <td style={{ fontWeight: 700, color: '#166534', background: '#FAF5EE' }}>{countP}</td>
                      <td style={{ fontWeight: 700, color: '#991B1B', background: '#FAF5EE' }}>{countA}</td>
                      <td style={{ fontWeight: 700, color: '#C2410C', background: '#FAF5EE' }}>{countL}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: LEAVE MANAGEMENT */}
      {/* ========================================================================= */}
      {tab === 'leaves' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          {/* Summary Cards */}
          <div className="sp-stats-grid">
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Total Requests</span>
                <strong className="sp-stat-count">{leaveRows.length}</strong>
                <span className="sp-stat-sublabel">All-time applications</span>
              </div>
              <div className="sp-stat-icon-wrap tone-total">📋</div>
            </div>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Pending Review</span>
                <strong className="sp-stat-count" style={{ color: '#B45309' }}>
                  {leaveRows.filter((l) => l.status === 'pending').length}
                </strong>
                <span className="sp-stat-sublabel">Awaiting admin approval</span>
              </div>
              <div className="sp-stat-icon-wrap tone-leave">⏳</div>
            </div>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Approved Leaves</span>
                <strong className="sp-stat-count" style={{ color: '#166534' }}>
                  {leaveRows.filter((l) => l.status === 'approved').length}
                </strong>
                <span className="sp-stat-sublabel">Synced to attendance</span>
              </div>
              <div className="sp-stat-icon-wrap tone-active">✓</div>
            </div>
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Rejected</span>
                <strong className="sp-stat-count" style={{ color: '#991B1B' }}>
                  {leaveRows.filter((l) => l.status === 'rejected').length}
                </strong>
                <span className="sp-stat-sublabel">Declined requests</span>
              </div>
              <div className="sp-stat-icon-wrap tone-absent">✕</div>
            </div>
          </div>

          {/* Leaves Toolbar */}
          <div className="sp-toolbar">
            <div className="sp-filters-group">
              <select
                value={leaveStatusFilter}
                onChange={(e) => setLeaveStatusFilter(e.target.value as any)}
                className="sp-filter-select"
              >
                <option value="all">All Statuses ({leaveRows.length})</option>
                <option value="pending">Pending Only</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </select>

              <select
                value={leaveTypeFilter}
                onChange={(e) => setLeaveTypeFilter(e.target.value)}
                className="sp-filter-select"
              >
                <option value="all">All Leave Types</option>
                <option value="casual">Casual Leave</option>
                <option value="sick">Sick Leave</option>
                <option value="earned">Earned Leave</option>
                <option value="emergency">Emergency Leave</option>
                <option value="unpaid">Unpaid Leave</option>
              </select>
            </div>

            <button
              type="button"
              className="sp-btn-maroon"
              onClick={() => {
                setLeaveFormData({
                  employee_id: activeStaff[0]?.id || '',
                  leave_type: 'casual',
                  start_date: today,
                  end_date: today,
                  days: 1,
                  reason: '',
                });
                setShowApplyLeaveModal(true);
              }}
            >
              + Apply Leave
            </button>
          </div>

          {/* Leave Table */}
          <div className="sp-panel" style={{ padding: 0 }}>
            {filteredLeaves.length > 0 ? (
              <div className="table-responsive-wrapper">
                <table className="luxury-table">
                  <thead>
                    <tr>
                      <th>Employee</th>
                      <th>Leave Type</th>
                      <th>From Date</th>
                      <th>To Date</th>
                      <th>Days</th>
                      <th>Reason</th>
                      <th>Status</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLeaves.map((l) => {
                      const emp = allStaff.find((s) => s.id === l.employee_id);
                      return (
                        <tr key={l.id}>
                          <td>
                            <strong style={{ color: 'var(--erp-maroon)', fontSize: 13, display: 'block' }}>
                              {emp?.name || 'Unknown Staff'}
                            </strong>
                            <small style={{ color: '#888' }}>{emp?.code || ''}</small>
                          </td>
                          <td>
                            <span className="tag-luxury" style={{ textTransform: 'uppercase', fontSize: 11 }}>
                              {l.leave_type}
                            </span>
                          </td>
                          <td className="date-cell">{l.start_date}</td>
                          <td className="date-cell">{l.end_date}</td>
                          <td style={{ fontWeight: 600 }}>{l.days} day{Number(l.days) === 1 ? '' : 's'}</td>
                          <td>{l.reason || '—'}</td>
                          <td>
                            <span
                              className={`sp-pill-status ${
                                l.status === 'approved'
                                  ? 'status-full_day'
                                  : l.status === 'rejected'
                                    ? 'status-absent'
                                    : 'status-half_day'
                              }`}
                            >
                              {l.status}
                            </span>
                          </td>
                          <td style={{ textAlign: 'right' }}>
                            {l.status === 'pending' ? (
                              <div style={{ display: 'inline-flex', gap: 6 }}>
                                <button
                                  type="button"
                                  className="button mini-btn"
                                  style={{ background: '#166534', color: '#FFF' }}
                                  onClick={() => void handleApproveLeave(l)}
                                >
                                  ✓ Approve
                                </button>
                                <button
                                  type="button"
                                  className="button outline-btn mini-btn"
                                  style={{ color: '#991B1B', borderColor: '#FCA5A5' }}
                                  onClick={() => void handleRejectLeave(l)}
                                >
                                  ✕ Reject
                                </button>
                              </div>
                            ) : (
                              <span style={{ fontSize: 11, color: '#888' }}>Reviewed</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sp-empty-card" style={{ margin: 20 }}>
                <h3>No leave requests found</h3>
                <p>Submit a new leave application using the button above.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: OVERTIME REPORTS */}
      {/* ========================================================================= */}
      {tab === 'overtime' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div className="sp-stats-grid">
            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Total Overtime Hours</span>
                <strong className="sp-stat-count" style={{ color: '#800020' }}>{totalOvertimeHours} hrs</strong>
                <span className="sp-stat-sublabel">Logged for {selectedMonth}</span>
              </div>
              <div className="sp-stat-icon-wrap tone-total">⏱</div>
            </div>

            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Estimated Payout</span>
                <strong className="sp-stat-count" style={{ color: '#047857', fontSize: 24 }}>
                  {money(totalOvertimeCostEstimate)}
                </strong>
                <span className="sp-stat-sublabel">Based on staff OT rates</span>
              </div>
              <div className="sp-stat-icon-wrap tone-present">₹</div>
            </div>

            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Staff with OT</span>
                <strong className="sp-stat-count">
                  {new Set(overtimeRows.map((r) => r.employee_id)).size}
                </strong>
                <span className="sp-stat-sublabel">Employees logged overtime</span>
              </div>
              <div className="sp-stat-icon-wrap tone-active">👥</div>
            </div>

            <div className="sp-stat-card">
              <div className="sp-stat-info">
                <span className="sp-stat-label">Selected Month</span>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="sp-filter-select"
                  style={{ marginTop: 4 }}
                />
              </div>
            </div>
          </div>

          {/* Overtime Table */}
          <div className="sp-panel" style={{ padding: 0 }}>
            {overtimeRows.length > 0 ? (
              <div className="table-responsive-wrapper">
                <table className="luxury-table">
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Employee</th>
                      <th>Department</th>
                      <th>Overtime Time</th>
                      <th>Hourly Rate</th>
                      <th>Estimated Pay</th>
                      <th>Notes / Task</th>
                      <th style={{ textAlign: 'right' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overtimeRows.map((r) => {
                      const emp = allStaff.find((s) => s.id === r.employee_id);
                      const otMins = Number(r.overtime_minutes || 0);
                      const hours = otMins / 60;
                      const hourlyRatePaise = Number(emp?.overtime_rate_paise || 0);
                      const estimatedPayPaise = Math.round(hours * hourlyRatePaise);

                      return (
                        <tr key={r.id}>
                          <td className="date-cell" style={{ fontWeight: 600 }}>{r.work_on}</td>
                          <td>
                            <strong style={{ color: 'var(--erp-maroon)', fontSize: 13, display: 'block' }}>
                              {emp?.name || 'Staff'}
                            </strong>
                            <small style={{ color: '#888' }}>{emp?.code || ''}</small>
                          </td>
                          <td>{emp?.department || 'Retail Sales'}</td>
                          <td style={{ fontWeight: 700, color: '#1D4ED8' }}>
                            {formatHoursMinutes(otMins)} ({otMins} mins)
                          </td>
                          <td>{money(hourlyRatePaise)} / hr</td>
                          <td style={{ fontWeight: 700, color: '#166534' }}>
                            {money(estimatedPayPaise)}
                          </td>
                          <td>{r.note || '—'}</td>
                          <td style={{ textAlign: 'right' }}>
                            <button
                              type="button"
                              className="button outline-btn mini-btn"
                              onClick={() => {
                                if (emp) {
                                  setEditingDetail({
                                    employee: emp,
                                    work_on: r.work_on,
                                    status: r.status,
                                    leave_units: Number(r.leave_units || 1),
                                    overtime_minutes: otMins,
                                    note: r.note || '',
                                  });
                                }
                              }}
                            >
                              Edit OT
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="sp-empty-card" style={{ margin: 20 }}>
                <h3>No overtime hours recorded for {selectedMonth}</h3>
                <p>When marking daily attendance, select &quot;+ Overtime / Notes&quot; to log extra hours.</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODALS */}
      {/* ========================================================================= */}

      {/* Confirmation Modal: Mark All Present */}
      {mounted && typeof document !== 'undefined' && showMarkAllConfirm && createPortal(
        <div
          className="luxury-admin-shell luxury-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100dvh',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            background: 'rgba(20, 8, 12, 0.55)',
            backdropFilter: 'blur(4px)',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
          onClick={() => !bulkSaving && setShowMarkAllConfirm(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="luxury-modal-card" style={{ maxWidth: 440, width: '100%', maxHeight: '90vh', overflowY: 'auto', margin: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title" style={{ color: 'var(--erp-maroon)' }}>
                Mark All Present?
              </h2>
              <button
                type="button"
                className="modal-close-btn"
                disabled={bulkSaving}
                onClick={() => setShowMarkAllConfirm(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-form-body">
              <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.5 }}>
                Are you sure you want to mark all <strong>{activeStaff.length}</strong> active staff members
                <strong> Present (Full Day)</strong> for <strong>{formatDateLong(selectedDate)}</strong>?
              </p>
              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={bulkSaving}
                  onClick={() => setShowMarkAllConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="sp-btn-maroon"
                  disabled={bulkSaving}
                  onClick={() => void handleConfirmMarkAll()}
                >
                  {bulkSaving ? 'Saving All...' : '✓ Confirm & Mark All'}
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Confirmation Modal: Reset / Undo */}
      {mounted && typeof document !== 'undefined' && showResetConfirm && createPortal(
        <div
          className="luxury-admin-shell luxury-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100dvh',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            background: 'rgba(20, 8, 12, 0.55)',
            backdropFilter: 'blur(4px)',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
          onClick={() => setShowResetConfirm(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="luxury-modal-card" style={{ maxWidth: 440, width: '100%', maxHeight: '90vh', overflowY: 'auto', margin: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Reload Daily Attendance?</h2>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowResetConfirm(false)}
              >
                ✕
              </button>
            </div>
            <div className="modal-form-body">
              <p style={{ margin: '0 0 16px', fontSize: 13.5, lineHeight: 1.5 }}>
                Reload attendance records from the server for <strong>{formatDateLong(selectedDate)}</strong>?
                This will synchronize with saved database state without modifying any historical data.
              </p>
              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="button outline-btn"
                  onClick={() => setShowResetConfirm(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="sp-btn-maroon"
                  onClick={() => void handleResetCurrentDate()}
                >
                  Reload from Database
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body
      )}

      {/* Overtime & Detail Modal */}
      {mounted && typeof document !== 'undefined' && editingDetail && createPortal(
        <div
          className="luxury-admin-shell luxury-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100dvh',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            background: 'rgba(20, 8, 12, 0.55)',
            backdropFilter: 'blur(4px)',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
          onClick={() => setEditingDetail(null)}
          role="dialog"
          aria-modal="true"
        >
          <div className="luxury-modal-card" style={{ maxWidth: 460, width: '100%', maxHeight: '90vh', overflowY: 'auto', margin: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Overtime &amp; Notes</h2>
              <button type="button" className="modal-close-btn" onClick={() => setEditingDetail(null)}>
                ✕
              </button>
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void markStatus(editingDetail.employee, editingDetail.status, {
                  work_on: editingDetail.work_on,
                  leave_units: editingDetail.leave_units,
                  overtime_minutes: editingDetail.overtime_minutes,
                  note: editingDetail.note,
                });
                setEditingDetail(null);
              }}
              className="modal-form-body"
            >
              <div style={{ marginBottom: 14 }}>
                <strong style={{ fontSize: 14, color: 'var(--erp-maroon)' }}>{editingDetail.employee.name}</strong>{' '}
                <span style={{ color: '#666', fontSize: 12 }}>({editingDetail.employee.code})</span>
                <small style={{ display: 'block', color: '#888', marginTop: 2 }}>Date: {editingDetail.work_on}</small>
              </div>

              {/* Overtime in Hours and Minutes */}
              <div className="input-group" style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                  <span>Overtime Duration</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: editingDetail.overtime_minutes > 0 ? '#1D4ED8' : '#888' }}>
                    {editingDetail.overtime_minutes > 0
                      ? `${formatHoursMinutes(editingDetail.overtime_minutes)} (${editingDetail.overtime_minutes}m)`
                      : '0 hrs 0 mins'}
                  </span>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--erp-text-muted)' }}>Hours</span>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="number"
                        min="0"
                        max="24"
                        step="1"
                        placeholder="0"
                        value={Math.floor(editingDetail.overtime_minutes / 60) === 0 ? '' : Math.floor(editingDetail.overtime_minutes / 60)}
                        onChange={(e) => {
                          const h = Math.max(0, parseInt(e.target.value, 10) || 0);
                          const m = editingDetail.overtime_minutes % 60;
                          setEditingDetail({
                            ...editingDetail,
                            overtime_minutes: h * 60 + m,
                          });
                        }}
                        style={{ width: '100%', paddingRight: 38 }}
                      />
                      <span style={{ position: 'absolute', right: 10, fontSize: 12, color: '#888', pointerEvents: 'none' }}>hrs</span>
                    </div>
                  </label>

                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--erp-text-muted)' }}>Minutes</span>
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                      <input
                        type="number"
                        min="0"
                        max="59"
                        step="5"
                        placeholder="0"
                        value={(editingDetail.overtime_minutes % 60) === 0 ? '' : (editingDetail.overtime_minutes % 60)}
                        onChange={(e) => {
                          const h = Math.floor(editingDetail.overtime_minutes / 60);
                          const rawM = parseInt(e.target.value, 10) || 0;
                          const m = Math.max(0, Math.min(59, rawM));
                          setEditingDetail({
                            ...editingDetail,
                            overtime_minutes: h * 60 + m,
                          });
                        }}
                        style={{ width: '100%', paddingRight: 40 }}
                      />
                      <span style={{ position: 'absolute', right: 10, fontSize: 12, color: '#888', pointerEvents: 'none' }}>mins</span>
                    </div>
                  </label>
                </div>

                {/* Quick Presets */}
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 11, color: '#888', display: 'block', marginBottom: 4 }}>Quick presets:</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {[
                      { label: '30 mins', mins: 30 },
                      { label: '1 hour', mins: 60 },
                      { label: '1 hr 30m', mins: 90 },
                      { label: '2 hours', mins: 120 },
                      { label: '2 hrs 30m', mins: 150 },
                      { label: '3 hours', mins: 180 },
                      { label: 'Clear (0)', mins: 0 },
                    ].map((p) => (
                      <button
                        key={p.mins}
                        type="button"
                        className="button outline-btn mini-btn"
                        style={{
                          fontSize: 11,
                          padding: '3px 8px',
                          borderColor: editingDetail.overtime_minutes === p.mins ? 'var(--erp-maroon)' : undefined,
                          background: editingDetail.overtime_minutes === p.mins ? '#FAF0E6' : undefined,
                          color: editingDetail.overtime_minutes === p.mins ? 'var(--erp-maroon)' : undefined,
                          fontWeight: editingDetail.overtime_minutes === p.mins ? 700 : 500,
                        }}
                        onClick={() =>
                          setEditingDetail({
                            ...editingDetail,
                            overtime_minutes: p.mins,
                          })
                        }
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              <label className="input-group">
                <span>Work / Shift Remarks</span>
                <textarea
                  rows={2}
                  placeholder="e.g. Festival peak hour closing shift, saree packing..."
                  value={editingDetail.note}
                  onChange={(e) => setEditingDetail({ ...editingDetail, note: e.target.value })}
                />
              </label>

              <div className="modal-actions-footer">
                <button type="button" className="button outline-btn" onClick={() => setEditingDetail(null)}>
                  Cancel
                </button>
                <button type="submit" className="sp-btn-maroon">
                  Save Overtime &amp; Note
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}

      {/* Apply Leave Modal */}
      {mounted && typeof document !== 'undefined' && showApplyLeaveModal && createPortal(
        <div
          className="luxury-admin-shell luxury-modal-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            width: '100vw',
            height: '100dvh',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            background: 'rgba(20, 8, 12, 0.55)',
            backdropFilter: 'blur(4px)',
            overflowY: 'auto',
            boxSizing: 'border-box',
          }}
          onClick={() => !leaveSubmitting && setShowApplyLeaveModal(false)}
          role="dialog"
          aria-modal="true"
        >
          <div className="luxury-modal-card" style={{ maxWidth: 480, width: '100%', maxHeight: '90vh', overflowY: 'auto', margin: 'auto' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2 className="modal-title">Apply Employee Leave</h2>
              <button
                type="button"
                className="modal-close-btn"
                disabled={leaveSubmitting}
                onClick={() => setShowApplyLeaveModal(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmitApplyLeave} className="modal-form-body">
              <label className="input-group">
                <span>Select Employee *</span>
                <select
                  required
                  value={leaveFormData.employee_id}
                  onChange={(e) => setLeaveFormData({ ...leaveFormData, employee_id: e.target.value })}
                >
                  <option value="" disabled>-- Select Staff Member --</option>
                  {activeStaff.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} · {s.name} ({s.department || 'Retail Sales'})
                    </option>
                  ))}
                </select>
              </label>

              <label className="input-group">
                <span>Leave Type *</span>
                <select
                  value={leaveFormData.leave_type}
                  onChange={(e) => setLeaveFormData({ ...leaveFormData, leave_type: e.target.value })}
                >
                  <option value="casual">Casual Leave</option>
                  <option value="sick">Sick Leave</option>
                  <option value="earned">Earned Leave</option>
                  <option value="emergency">Emergency Leave</option>
                  <option value="unpaid">Unpaid Leave</option>
                </select>
              </label>

              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Start Date *</span>
                  <input
                    type="date"
                    required
                    value={leaveFormData.start_date}
                    onChange={(e) => setLeaveFormData({ ...leaveFormData, start_date: e.target.value })}
                  />
                </label>
                <label className="input-group">
                  <span>End Date *</span>
                  <input
                    type="date"
                    required
                    value={leaveFormData.end_date}
                    onChange={(e) => setLeaveFormData({ ...leaveFormData, end_date: e.target.value })}
                  />
                </label>
              </div>

              <label className="input-group">
                <span>Days Count *</span>
                <input
                  type="number"
                  min="0.5"
                  step="0.5"
                  required
                  value={leaveFormData.days}
                  onChange={(e) => setLeaveFormData({ ...leaveFormData, days: Number(e.target.value) || 1 })}
                />
              </label>

              <label className="input-group">
                <span>Reason / Notes</span>
                <textarea
                  rows={2}
                  placeholder="e.g. Family wedding, medical rest..."
                  value={leaveFormData.reason}
                  onChange={(e) => setLeaveFormData({ ...leaveFormData, reason: e.target.value })}
                />
              </label>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={leaveSubmitting}
                  onClick={() => setShowApplyLeaveModal(false)}
                >
                  Cancel
                </button>
                <button type="submit" className="sp-btn-maroon" disabled={leaveSubmitting}>
                  {leaveSubmitting ? 'Submitting...' : 'Submit Leave Request'}
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
