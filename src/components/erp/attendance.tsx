'use client';
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { indiaDate } from '@/lib/barcode';
import { api } from '../api';
import { References, Row, useERP } from './shared';

const STATUS_OPTIONS: {
  key: string;
  label: string;
  short: string;
  tone: 'ok' | 'half' | 'warn' | 'bad' | 'muted';
}[] = [
  { key: 'full_day', label: 'Present', short: 'Present', tone: 'ok' },
  { key: 'half_day', label: 'Half Day', short: 'Half Day', tone: 'half' },
  { key: 'leave', label: 'Leave', short: 'Leave', tone: 'warn' },
  { key: 'absent', label: 'Absent', short: 'Absent', tone: 'bad' },
  { key: 'holiday', label: 'Holiday', short: 'Holiday', tone: 'muted' },
  { key: 'weekly_off', label: 'Week Off', short: 'Week Off', tone: 'muted' },
];

function shiftDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function Attendance({ refs }: { refs: References }) {
  const today = indiaDate();
  const [tab, setTab] = useState<'daily' | 'monthly'>('daily');
  const [selectedDate, setSelectedDate] = useState(today);
  const [selectedMonth, setSelectedMonth] = useState(today.slice(0, 7));
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [monthRows, setMonthRows] = useState<Row[]>([]);
  const [savingEmpId, setSavingEmpId] = useState<string | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);
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

  useEffect(() => {
    if (!selectedEmployee && allStaff.length) {
      setSelectedEmployee(activeStaff[0]?.id || allStaff[0].id);
    }
  }, [allStaff, activeStaff, selectedEmployee]);

  const activeMonth = tab === 'daily' ? selectedDate.slice(0, 7) : selectedMonth;

  async function loadMonth(monthStr = activeMonth) {
    if (!monthStr) return;
    try {
      const r = await api<Row>(`/api/erp/attendance?month=${monthStr}&page=0`);
      setMonthRows(r.rows || []);
    } catch (e) {
      notice((e as Error).message);
    }
  }

  useEffect(() => {
    void loadMonth(activeMonth);
  }, [activeMonth]);

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

  // Monthly records for selectedEmployee
  const staffMonthRows = useMemo(() => {
    return monthRows
      .filter((r) => r.employee_id === selectedEmployee)
      .sort((a, b) => (a.work_on < b.work_on ? 1 : -1));
  }, [monthRows, selectedEmployee]);

  const monthSummary = useMemo(() => {
    let present = 0;
    let half = 0;
    let leaveOrAbsent = 0;
    let off = 0;
    let otMins = 0;
    for (const r of staffMonthRows) {
      if (r.status === 'full_day') present++;
      else if (r.status === 'half_day') half++;
      else if (r.status === 'leave' || r.status === 'absent') leaveOrAbsent++;
      else if (r.status === 'holiday' || r.status === 'weekly_off') off++;
      otMins += Number(r.overtime_minutes || 0);
    }
    return { present, half, leaveOrAbsent, off, otMins };
  }, [staffMonthRows]);

  async function markStatus(emp: Row, status: string, extra?: {
    work_on?: string;
    leave_units?: number;
    overtime_minutes?: number;
    note?: string;
  }) {
    const workOn = extra?.work_on || selectedDate;
    const dailyMins = Number(emp.daily_minutes || 480);
    const workedMins =
      status === 'half_day'
        ? Math.floor(dailyMins / 2)
        : status === 'full_day'
          ? dailyMins
          : 0;

    setSavingEmpId(emp.id);
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
      notice((e as Error).message || 'Could not save attendance.');
    } finally {
      setSavingEmpId(null);
    }
  }

  async function markAllPresent() {
    if (!activeStaff.length) return;
    setBulkSaving(true);
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
            note: 'Marked present (daily roll call)',
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
        : `${saved} saved, ${failed} could not be updated (check if payroll is already approved).`,
    );
  }

  if (allStaff.length === 0) {
    return (
      <div className="sp-root">
        <div className="sp-empty-card">
          <h3>Add your staff first</h3>
          <p>
            Before marking daily attendance, add your shop staff members in the Employees section.
          </p>
          <Link href="/admin/employees" className="button">
            + Go to Staff / Employees →
          </Link>
        </div>
      </div>
    );
  }

  const markedTodayCount = activeStaff.filter((e) => dayByEmployee.has(e.id)).length;

  return (
    <div className="sp-root">
      {/* 3-Step Workflow Guide */}
      <div className="sp-workflow-bar">
        <Link href="/admin/employees" className="sp-step">
          <span className="sp-step-num">1</span>
          <div>
            <strong>Add Staff</strong>
            <small>{activeStaff.length} active staff</small>
          </div>
        </Link>
        <span className="sp-step-arrow" aria-hidden="true">→</span>
        <div className="sp-step is-active">
          <span className="sp-step-num">2</span>
          <div>
            <strong>Mark Attendance</strong>
            <small>Tap Present / Leave / Absent</small>
          </div>
        </div>
        <span className="sp-step-arrow" aria-hidden="true">→</span>
        <Link href="/admin/payroll" className="sp-step">
          <span className="sp-step-num">3</span>
          <div>
            <strong>Pay Salary</strong>
            <small>Auto calculate from attendance</small>
          </div>
        </Link>
      </div>

      {/* Mode Tabs */}
      <div className="sp-tabs-bar">
        <button
          type="button"
          className={`sp-tab-btn ${tab === 'daily' ? 'active' : ''}`}
          onClick={() => setTab('daily')}
        >
          Daily Roll Call (Fastest)
        </button>
        <button
          type="button"
          className={`sp-tab-btn ${tab === 'monthly' ? 'active' : ''}`}
          onClick={() => setTab('monthly')}
        >
          Monthly Report (Per Staff)
        </button>
      </div>

      {tab === 'daily' ? (
        <section className="sp-panel">
          {/* Date Picker + Mark All Present */}
          <div className="sp-rollcall-top">
            <div className="sp-date-nav">
              <button
                type="button"
                className="button outline-btn mini-btn"
                onClick={() => setSelectedDate(shiftDate(selectedDate, -1))}
              >
                ← Prev
              </button>
              <input
                type="date"
                max={today}
                value={selectedDate}
                onChange={(e) => e.target.value && setSelectedDate(e.target.value)}
                className="sp-date-input"
              />
              <button
                type="button"
                className="button outline-btn mini-btn"
                disabled={selectedDate >= today}
                onClick={() => {
                  const next = shiftDate(selectedDate, 1);
                  setSelectedDate(next > today ? today : next);
                }}
              >
                Next →
              </button>
              {selectedDate !== today && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => setSelectedDate(today)}
                >
                  Today
                </button>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span className="pos-meta-chip">
                Marked: <strong>{markedTodayCount} / {activeStaff.length}</strong>
              </span>
              <button
                type="button"
                className="button gold-btn"
                disabled={bulkSaving || !activeStaff.length}
                onClick={() => void markAllPresent()}
              >
                {bulkSaving ? 'Marking All…' : '✓ Mark All Present'}
              </button>
            </div>
          </div>

          {/* 1-Click Staff Attendance Rows */}
          <div className="sp-rollcall-list">
            {activeStaff.map((emp) => {
              const rec = dayByEmployee.get(emp.id);
              const isSaving = savingEmpId === emp.id;

              return (
                <div className="sp-rollcall-row" key={emp.id}>
                  <div className="sp-staff-cell">
                    <span className="sp-avatar">
                      {String(emp.name || 'S').slice(0, 1).toUpperCase()}
                    </span>
                    <div>
                      <strong style={{ color: 'var(--erp-maroon)' }}>{emp.name}</strong>
                      <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                        {emp.code}
                        {rec?.overtime_minutes ? ` · +${rec.overtime_minutes}m OT` : ''}
                        {rec?.note ? ` · ${rec.note}` : ''}
                      </small>
                    </div>
                  </div>

                  <div className="sp-status-pills">
                    {STATUS_OPTIONS.map((opt) => {
                      const active = rec?.status === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          disabled={isSaving || bulkSaving}
                          className={`sp-status-pill tone-${opt.tone} ${active ? 'active' : ''}`}
                          onClick={() => void markStatus(emp, opt.key)}
                        >
                          {opt.label}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      className="text-link"
                      style={{ fontSize: 12, marginLeft: 4 }}
                      onClick={() =>
                        setEditingDetail({
                          employee: emp,
                          work_on: selectedDate,
                          status: rec?.status || 'full_day',
                          leave_units: Number(rec?.leave_units || 1),
                          overtime_minutes: Number(rec?.overtime_minutes || 0),
                          note: rec?.note || '',
                        })
                      }
                    >
                      + OT / Note
                    </button>
                  </div>

                  <div className="sp-saved-col">
                    {isSaving ? (
                      <span className="sp-badge-muted">Saving…</span>
                    ) : rec ? (
                      <span className="sp-badge-saved">Saved ✓</span>
                    ) : (
                      <span className="sp-badge-muted">Not marked</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ) : (
        <section className="sp-panel">
          <div className="row-inputs-2" style={{ marginBottom: 16 }}>
            <label className="input-group">
              <span>Staff Member</span>
              <select
                value={selectedEmployee}
                onChange={(e) => setSelectedEmployee(e.target.value)}
              >
                {allStaff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.code} · {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="input-group">
              <span>Month</span>
              <input
                type="month"
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
              />
            </label>
          </div>

          <div className="sp-kpi-grid" style={{ marginBottom: 18 }}>
            <div className="sp-kpi-card">
              <span>Present Days</span>
              <strong>{monthSummary.present}</strong>
            </div>
            <div className="sp-kpi-card">
              <span>Half Days</span>
              <strong>{monthSummary.half}</strong>
            </div>
            <div className="sp-kpi-card">
              <span>Leave / Absent</span>
              <strong>{monthSummary.leaveOrAbsent}</strong>
            </div>
            <div className="sp-kpi-card">
              <span>Overtime</span>
              <strong>{monthSummary.otMins} min</strong>
            </div>
          </div>

          <div className="table-responsive-wrapper">
            <table className="luxury-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Status</th>
                  <th>Overtime</th>
                  <th>Note</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {staffMonthRows.length > 0 ? (
                  staffMonthRows.map((r) => {
                    const emp = allStaff.find((s) => s.id === r.employee_id);
                    const opt = STATUS_OPTIONS.find((o) => o.key === r.status);
                    return (
                      <tr key={r.id}>
                        <td className="date-cell">{r.work_on}</td>
                        <td>
                          <span className={`pill-status ${r.status === 'full_day' ? 'status-paid' : 'status-pending'}`}>
                            {opt?.label || r.status.replaceAll('_', ' ')}
                          </span>
                        </td>
                        <td>{r.overtime_minutes ? `${r.overtime_minutes} min` : '—'}</td>
                        <td>{r.note || '—'}</td>
                        <td>
                          {emp && (
                            <button
                              type="button"
                              className="button outline-btn mini-btn"
                              onClick={() =>
                                setEditingDetail({
                                  employee: emp,
                                  work_on: r.work_on,
                                  status: r.status,
                                  leave_units: Number(r.leave_units || 1),
                                  overtime_minutes: Number(r.overtime_minutes || 0),
                                  note: r.note || '',
                                })
                              }
                            >
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={5} className="table-empty-cell">
                      No attendance marked for this staff member in {selectedMonth} yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Optional Overtime / Note / Detailed Edit Modal */}
      {editingDetail && (
        <div
          className="luxury-modal-overlay"
          onClick={() => !savingEmpId && setEditingDetail(null)}
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
                <span className="modal-eyebrow">✦ ATTENDANCE DETAILS</span>
                <h2 className="modal-title">
                  {editingDetail.employee.name} · {editingDetail.work_on}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setEditingDetail(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form
              className="modal-form-body"
              onSubmit={async (e) => {
                e.preventDefault();
                await markStatus(editingDetail.employee, editingDetail.status, {
                  work_on: editingDetail.work_on,
                  leave_units: editingDetail.leave_units,
                  overtime_minutes: editingDetail.overtime_minutes,
                  note: editingDetail.note,
                });
                setEditingDetail(null);
              }}
            >
              <label className="input-group">
                <span>Attendance Status</span>
                <select
                  value={editingDetail.status}
                  onChange={(e) =>
                    setEditingDetail({ ...editingDetail, status: e.target.value })
                  }
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.key} value={o.key}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>

              {editingDetail.status === 'leave' && (
                <label className="input-group">
                  <span>Leave Duration</span>
                  <select
                    value={editingDetail.leave_units}
                    onChange={(e) =>
                      setEditingDetail({
                        ...editingDetail,
                        leave_units: Number(e.target.value),
                      })
                    }
                  >
                    <option value={1}>Full Day Leave</option>
                    <option value={0.5}>Half Day Leave</option>
                  </select>
                </label>
              )}

              <label className="input-group">
                <span>Overtime Minutes (Optional)</span>
                <input
                  type="number"
                  min={0}
                  max={1440}
                  value={editingDetail.overtime_minutes || ''}
                  placeholder="0"
                  onChange={(e) =>
                    setEditingDetail({
                      ...editingDetail,
                      overtime_minutes: Math.max(0, Number(e.target.value || 0)),
                    })
                  }
                />
              </label>

              <label className="input-group">
                <span>Note (Optional)</span>
                <textarea
                  rows={2}
                  maxLength={500}
                  placeholder="e.g. Festival rush extra hour"
                  value={editingDetail.note}
                  onChange={(e) =>
                    setEditingDetail({ ...editingDetail, note: e.target.value })
                  }
                />
              </label>

              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="button outline-btn"
                  onClick={() => setEditingDetail(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="button gold-btn"
                  disabled={Boolean(savingEmpId)}
                >
                  {savingEmpId ? 'Saving…' : 'Save Attendance'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
