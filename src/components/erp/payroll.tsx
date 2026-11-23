'use client';
import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { money } from '@/lib/core';
import { indiaDate } from '@/lib/barcode';
import { api } from '../api';
import { ComponentsInput, References, Row, useERP, downloadCSV } from './shared';
import { PayrollRun } from './payroll-run';

export function Payroll({ refs }: { refs: References }) {
  const [employee, setEmployee] = useState('');
  const [month, setMonth] = useState(() => {
    const d = new Date(`${indiaDate()}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return d.toISOString().slice(0, 7);
  });
  const [bonusRupees, setBonusRupees] = useState('');
  const [allowances, setAllowances] = useState<Row[]>([]);
  const [deductions, setDeductions] = useState<Row[]>([]);
  const [showExtras, setShowExtras] = useState(false);
  const [preview, setPreview] = useState<Row | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [slip, setSlip] = useState<Row | null>(null);
  const [paying, setPaying] = useState<Row | null>(null);
  const [view, setView] = useState<'all' | 'one'>('all');
  const slipRef = useRef<HTMLElement>(null);

  const { busy, send, notice } = useERP();
  const staff = refs.employees || [];

  useEffect(() => {
    if (!employee && staff.length) {
      setEmployee(staff.find((s) => s.active !== false)?.id || staff[0].id);
    }
  }, [staff, employee]);

  async function load(page = 0) {
    try {
      const r = await api<Row>(`/api/erp/payroll?page=${page}`);
      setRows((old) => (page === 0 ? r.rows : [...old, ...r.rows]));
      setNext(r.nextPage);
    } catch (e) {
      notice((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    setPreview(null);
    setPreviewError('');
  }, [employee, month]);

  const bonusPaise = Math.max(0, Math.round(Number(bonusRupees || 0) * 100));

  async function calculate() {
    if (!employee) return;
    setPreviewError('');
    try {
      const r = await api<Row>(
        `/api/erp/payroll_preview?employee_id=${employee}&period=${month}-01`,
      );
      setPreview(r.calculation);
    } catch (e) {
      setPreview(null);
      setPreviewError((e as Error).message || 'Could not calculate salary.');
    }
  }

  function openPayslip(r: Row, triggerPrint = false) {
    setSlip(r);
    setTimeout(() => {
      slipRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (triggerPrint) window.print();
    }, 100);
  }

  if (staff.length === 0) {
    return (
      <div className="sp-root">
        <div className="sp-empty-card">
          <h3>Add staff members to run payroll</h3>
          <p>
            Once you add your staff and mark their monthly attendance, this page will automatically calculate each person&apos;s salary and generate printable salary slips.
          </p>
          <Link href="/admin/employees" className="button">
            + Go to Staff / Employees →
          </Link>
        </div>
      </div>
    );
  }

  const draftCount = rows.filter((r) => r.status === 'draft').length;
  const approvedCount = rows.filter((r) => r.status === 'approved').length;
  const paidTotalPaise = rows
    .filter((r) => r.status === 'paid')
    .reduce((sum, r) => sum + Number(r.net_paise || 0), 0);

  return (
    <div className="erp-print-host sp-root">
      {/* 3-Step Workflow Guide */}
      <div className="sp-workflow-bar">
        <Link href="/admin/employees" className="sp-step">
          <span className="sp-step-num">1</span>
          <div>
            <strong>Add Staff</strong>
            <small>{staff.length} staff saved</small>
          </div>
        </Link>
        <span className="sp-step-arrow" aria-hidden="true">→</span>
        <Link href="/admin/attendance" className="sp-step">
          <span className="sp-step-num">2</span>
          <div>
            <strong>Mark Attendance</strong>
            <small>Complete month roll call</small>
          </div>
        </Link>
        <span className="sp-step-arrow" aria-hidden="true">→</span>
        <div className="sp-step is-active">
          <span className="sp-step-num">3</span>
          <div>
            <strong>Pay Salary</strong>
            <small>Draft → Approve → Mark Paid</small>
          </div>
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="sp-kpi-grid">
        <div className="sp-kpi-card">
          <span>Draft Salaries</span>
          <strong>{draftCount}</strong>
          <small>Waiting for approval</small>
        </div>
        <div className="sp-kpi-card">
          <span>Approved (Ready to Pay)</span>
          <strong>{approvedCount}</strong>
          <small>Click &quot;Mark Paid&quot; once sent</small>
        </div>
        <div className="sp-kpi-card">
          <span>Total Salaries Paid</span>
          <strong>{money(paidTotalPaise)}</strong>
          <small>Automatically logged in Expenses</small>
        </div>
      </div>

      <div className="ms-seg pr-view-tabs" role="tablist">
        <button type="button" role="tab" aria-selected={view === 'all'} className={view === 'all' ? 'on' : ''} onClick={() => setView('all')}>
          All staff for a month
        </button>
        <button type="button" role="tab" aria-selected={view === 'one'} className={view === 'one' ? 'on' : ''} onClick={() => setView('one')}>
          One staff member (detailed)
        </button>
      </div>

      {view === 'all' && (
        <PayrollRun staff={staff} runs={rows} month={month} setMonth={setMonth} onChanged={() => load()} />
      )}

      {/* Calculator & Draft Generator Card */}
      {view === 'one' && (<>
      <form
        className="sp-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          const cleanAllow = allowances
            .filter((a) => String(a.label || '').trim())
            .map((a) => ({
              label: String(a.label).trim(),
              amount_paise: Math.max(0, Math.round(Number(a.amount_paise || 0))),
            }));
          const cleanDeduct = deductions
            .filter((d) => String(d.label || '').trim())
            .map((d) => ({
              label: String(d.label).trim(),
              amount_paise: Math.max(0, Math.round(Number(d.amount_paise || 0))),
            }));
          const res = await send(
            'payroll',
            {
              employee_id: employee,
              period: `${month}-01`,
              bonus_paise: bonusPaise,
              allowances: cleanAllow,
              deductions: cleanDeduct,
            },
            load,
          );
          if (res) {
            setBonusRupees('');
            setAllowances([]);
            setDeductions([]);
          }
        }}
      >
        <div className="sp-panel-head">
          <div>
            <h2 className="sp-panel-title">Calculate &amp; Generate Monthly Salary</h2>
            <p className="sp-panel-sub">
              Pick a staff member and completed salary month. Salary is calculated automatically from their attendance.
            </p>
          </div>
        </div>

        <div className="row-inputs-3">
          <label className="input-group">
            <span>Staff Member *</span>
            <select
              value={employee}
              onChange={(e) => setEmployee(e.target.value)}
              required
            >
              <option value="">Select staff member</option>
              {staff.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.code} · {e.name}
                </option>
              ))}
            </select>
          </label>
          <label className="input-group">
            <span>Salary Month *</span>
            <input
              type="month"
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              required
            />
          </label>
          <label className="input-group">
            <span>One-Time Bonus (₹)</span>
            <input
              type="number"
              min={0}
              step="1"
              placeholder="0"
              value={bonusRupees}
              onChange={(e) => setBonusRupees(e.target.value)}
            />
          </label>
        </div>

        <button
          type="button"
          className="text-link"
          style={{ fontSize: 12, marginTop: 10 }}
          onClick={() => setShowExtras((v) => !v)}
        >
          {showExtras
            ? '▾ Hide extra monthly allowances / deductions'
            : '▸ Optional: Add extra allowance or advance/deduction for this month'}
        </button>

        {showExtras && (
          <div className="sp-advanced-box" style={{ marginTop: 12 }}>
            <ComponentsInput
              label="Extra Allowances (This Month Only)"
              value={allowances}
              onChange={setAllowances}
            />
            <ComponentsInput
              label="Extra Deductions / Salary Advance (This Month Only)"
              value={deductions}
              onChange={setDeductions}
            />
          </div>
        )}

        {previewError && (
          <div className="modal-error-banner" role="alert" style={{ marginTop: 14 }}>
            <strong>Cannot calculate yet:</strong> {previewError}
            <div style={{ marginTop: 6 }}>
              <Link href="/admin/attendance" className="text-link">
                Go to Attendance to fill missing workdays →
              </Link>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 16 }}>
          <button
            type="button"
            className="button outline-btn"
            disabled={busy || !employee}
            onClick={() => void calculate()}
          >
            1. Preview Calculation
          </button>
          <button
            type="submit"
            className="button gold-btn"
            disabled={busy || !employee}
          >
            {busy ? 'Generating…' : '2. Create / Update Salary Draft'}
          </button>
        </div>
      </form>

      {/* Live Attendance Salary Preview Card */}
      {preview && (
        <section className="sp-panel">
          <div className="sp-panel-head">
            <div>
              <h3 className="sp-panel-title">
                Salary Preview · {preview.employee.name} ({month})
              </h3>
              <p className="sp-panel-sub">
                Based on marked attendance and assigned salary rule
              </p>
            </div>
          </div>

          <div className="sp-kpi-grid" style={{ marginBottom: 16 }}>
            <div className="sp-kpi-card">
              <span>Working Days (Divisor)</span>
              <strong>{preview.period_divisor}</strong>
            </div>
            <div className="sp-kpi-card">
              <span>Paid Days</span>
              <strong>{preview.paid_units}</strong>
            </div>
            <div className="sp-kpi-card">
              <span>Unpaid / LOP Days</span>
              <strong>{preview.lop_units}</strong>
            </div>
            <div className="sp-kpi-card">
              <span>Earned Base + OT</span>
              <strong>
                {money(Number(preview.earned_base_paise || 0) + Number(preview.overtime_paise || 0))}
              </strong>
            </div>
          </div>

          <div className="pos-summary-card">
            <div className="pos-summary-line">
              <span>Base Salary (Before Leave Deduction)</span>
              <strong>{money(preview.base_paise)}</strong>
            </div>
            <div className="pos-summary-line">
              <span>Leave / Absent Deduction (LOP)</span>
              <strong>−{money(preview.lop_paise)}</strong>
            </div>
            <div className="pos-summary-line">
              <span>Earned Salary</span>
              <strong>{money(preview.earned_base_paise)}</strong>
            </div>
            <div className="pos-summary-line">
              <span>Overtime Pay</span>
              <strong>{money(preview.overtime_paise)}</strong>
            </div>
            {bonusPaise > 0 && (
              <div className="pos-summary-line">
                <span>Bonus (This Month)</span>
                <strong>{money(bonusPaise)}</strong>
              </div>
            )}
          </div>

          <details style={{ marginTop: 14 }}>
            <summary className="text-link" style={{ cursor: 'pointer', fontSize: 13 }}>
              Show day-by-day attendance breakdown ({preview.days?.length || 0} days)
            </summary>
            <div className="table-responsive-wrapper" style={{ marginTop: 10 }}>
              <table className="luxury-table">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Status</th>
                    <th>Paid</th>
                    <th>Unpaid</th>
                    <th>Note</th>
                  </tr>
                </thead>
                <tbody>
                  {(preview.days || []).map((d: Row) => (
                    <tr key={d.date}>
                      <td className="date-cell">{d.date}</td>
                      <td>{String(d.status || '').replaceAll('_', ' ')}</td>
                      <td>{d.paid_units}</td>
                      <td>{d.lop_units}</td>
                      <td>{d.note || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      </>)}

      {/* Salary Runs History & Actions */}
      <section className="table-widget-panel">
        <div className="widget-header">
          <div className="widget-title-group">
            <span className="widget-badge-gold">Salary Register</span>
            <h3>Monthly Salary Runs</h3>
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="button outline-btn mini-btn"
              onClick={() => void load()}
            >
              ↻ Refresh
            </button>
            {rows.length > 0 && (
              <button
                type="button"
                className="button outline-btn mini-btn"
                onClick={() =>
                  downloadCSV('payroll.csv', [
                    [
                      'Month',
                      'Code',
                      'Name',
                      'Status',
                      'Base Rs',
                      'Overtime Rs',
                      'Allowances & Bonus Rs',
                      'Deductions Rs',
                      'Net Pay Rs',
                      'Payment Reference',
                    ],
                    ...rows.map((r) => [
                      r.period,
                      r.employee_snapshot.code,
                      r.employee_snapshot.name,
                      r.status,
                      r.base_paise / 100,
                      r.overtime_paise / 100,
                      r.allowance_paise / 100,
                      r.deduction_paise / 100,
                      r.net_paise / 100,
                      r.payment_reference,
                    ]),
                  ])
                }
              >
                ⬇ Export CSV
              </button>
            )}
          </div>
        </div>

        <div className="table-responsive-wrapper">
          <table className="luxury-table">
            <thead>
              <tr>
                <th>Month</th>
                <th>Staff Member</th>
                <th>Net Salary</th>
                <th>Status</th>
                <th>Next Step / Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.length > 0 ? (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="date-cell">
                      <strong>{r.period.slice(0, 7)}</strong>
                    </td>
                    <td>
                      <strong style={{ color: 'var(--erp-maroon)' }}>
                        {r.employee_snapshot.name}
                      </strong>
                      <small style={{ display: 'block', color: 'var(--erp-text-muted)' }}>
                        {r.employee_snapshot.code}
                      </small>
                    </td>
                    <td className="money-cell">{money(r.net_paise)}</td>
                    <td>
                      <span
                        className={`pill-status ${
                          r.status === 'paid'
                            ? 'status-paid'
                            : r.status === 'approved'
                              ? 'status-processing'
                              : 'status-pending'
                        }`}
                      >
                        {r.status === 'paid'
                          ? 'Paid ✓'
                          : r.status === 'approved'
                            ? 'Approved'
                            : 'Draft'}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {r.status === 'draft' && (
                          <>
                            <button
                              type="button"
                              className="button gold-btn mini-btn"
                              disabled={busy}
                              onClick={() =>
                                send(
                                  'payroll_finalize',
                                  { id: r.id, action: 'approve' },
                                  load,
                                )
                              }
                            >
                              Approve Salary
                            </button>
                            <button
                              type="button"
                              className="button outline-btn mini-btn"
                              onClick={() => {
                                setView('one');
                                setEmployee(r.employee_id);
                                setMonth(r.period.slice(0, 7));
                                setBonusRupees(
                                  r.bonus_paise ? String(r.bonus_paise / 100) : '',
                                );
                                setAllowances(r.monthly_allowances || []);
                                setDeductions(r.monthly_deductions || []);
                                setShowExtras(
                                  Boolean(
                                    (r.monthly_allowances || []).length ||
                                      (r.monthly_deductions || []).length,
                                  ),
                                );
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}
                            >
                              Edit
                            </button>
                          </>
                        )}
                        {r.status === 'approved' && (
                          <>
                            <button
                              type="button"
                              className="button gold-btn mini-btn"
                              onClick={() => setPaying(r)}
                            >
                              Mark Salary Paid
                            </button>
                            <button
                              type="button"
                              className="button outline-btn mini-btn"
                              disabled={busy}
                              onClick={() => send('payroll_finalize', { id: r.id, action: 'reopen' }, load)}
                              title="Move back to draft to change bonus, allowances or deductions"
                            >
                              Reopen
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="button outline-btn mini-btn"
                          onClick={() => openPayslip(r, false)}
                        >
                          View Slip
                        </button>
                        <button
                          type="button"
                          className="button mini-btn"
                          onClick={() => openPayslip(r, true)}
                        >
                          🖨 Print
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={5} className="table-empty-cell">
                    No salary runs created yet. Select a staff member and month above to generate your first salary slip.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {next !== null && (
          <div style={{ padding: 14, textAlign: 'center' }}>
            <button
              type="button"
              className="button outline-btn"
              onClick={() => void load(next)}
            >
              Load More Salary Runs
            </button>
          </div>
        )}
      </section>

      {/* Mark Salary Paid Modal */}
      {paying && (
        <div
          className="luxury-modal-overlay"
          onClick={() => !busy && setPaying(null)}
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
                <span className="modal-eyebrow">✦ SALARY PAYMENT</span>
                <h2 className="modal-title">Pay {paying.employee_snapshot.name}</h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setPaying(null)}
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
                if (
                  await send(
                    'payroll_finalize',
                    {
                      id: paying.id,
                      action: 'paid',
                      method: f.get('method'),
                      reference: f.get('reference'),
                      checked: f.get('checked') === 'on',
                    },
                    load,
                  )
                ) {
                  setPaying(null);
                }
              }}
            >
              <div className="selected-product-box">
                <span className="box-label">Net Salary Amount</span>
                <span className="box-val">{money(paying.net_paise)}</span>
              </div>
              <label className="input-group">
                <span>Payment Mode</span>
                <select name="method" defaultValue="cash">
                  <option value="cash">Cash</option>
                  <option value="upi">UPI</option>
                  <option value="bank">Bank Transfer</option>
                  <option value="card">Card</option>
                </select>
              </label>
              <label className="input-group">
                <span>Payment Reference / Cash Voucher # *</span>
                <input
                  name="reference"
                  required
                  minLength={6}
                  maxLength={100}
                  placeholder="e.g. CASH-NOV-01 or UPI Ref number"
                />
              </label>
              <label className="checkbox-item">
                <input name="checked" type="checkbox" required />
                <span>I have handed over / transferred this salary amount.</span>
              </label>
              <div className="modal-actions-footer">
                <button
                  type="button"
                  className="button outline-btn"
                  disabled={busy}
                  onClick={() => setPaying(null)}
                >
                  Cancel
                </button>
                <button type="submit" className="button gold-btn" disabled={busy}>
                  {busy ? 'Saving…' : 'Confirm Paid & Log Expense'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Printable Salary Slip */}
      {slip && (
        <section ref={slipRef} className="pos-receipt-section">
          <div className="pos-receipt-controls">
            <div>
              <span className="modal-eyebrow">✦ SALARY SLIP</span>
              <h3 className="pos-panel-title">
                {slip.employee_snapshot.name} · {slip.period.slice(0, 7)}
              </h3>
            </div>
            <div className="pos-receipt-btns">
              <button type="button" className="button" onClick={() => window.print()}>
                🖨 Print Payslip
              </button>
              <button
                type="button"
                className="button outline-btn"
                onClick={() => setSlip(null)}
              >
                Close
              </button>
            </div>
          </div>

          <article className="erp-print payslip">
            <h2 style={{ marginBottom: 4 }}>மகரந்தம் சில்க்ஸ் · MAGARANTHAM SILKS</h2>
            <h3 style={{ marginTop: 0 }}>Salary Slip · {slip.period.slice(0, 7)}</h3>
            <p>
              <strong>{slip.employee_snapshot.name}</strong> ({slip.employee_snapshot.code})
              <br />
              {slip.employee_snapshot.employment === 'part_time' ? 'Part Time' : 'Full Time'} ·{' '}
              {slip.employee_snapshot.pay_basis} · Status: <strong>{slip.status}</strong>
            </p>
            <div className="receipt-divider" />
            <div className="total-row">
              <span>Paid Days / Units</span>
              <b>{slip.worked_units}</b>
            </div>
            <div className="total-row">
              <span>Unpaid / Leave Days</span>
              <b>{slip.calculation?.lop_units || 0}</b>
            </div>
            <div className="receipt-divider" />
            {[
              ['Base Salary (Before LOP)', slip.calculation?.base_paise || slip.base_paise],
              ['Leave / Absent Deduction', -(slip.calculation?.lop_paise || 0)],
              ['Earned Salary', slip.base_paise],
              ['Overtime Pay', slip.overtime_paise],
              ['Bonus', slip.bonus_paise],
              ['Other Allowances', slip.allowance_paise - slip.bonus_paise],
              ['Deductions', -slip.deduction_paise],
            ].map(([l, v]) => (
              <div className="total-row" key={String(l)}>
                <span>{l}</span>
                <b>{money(Number(v))}</b>
              </div>
            ))}
            <div className="receipt-divider" />
            <div className="total-row receipt-grand">
              <span>NET SALARY PAYABLE</span>
              <b>{money(Number(slip.net_paise))}</b>
            </div>
            {slip.payment_reference && (
              <p style={{ marginTop: 10 }}>
                Paid via <strong>{String(slip.payment_method).toUpperCase()}</strong> · Ref:{' '}
                {slip.payment_reference}
              </p>
            )}
            <small>Payroll Ref: {slip.id}</small>
          </article>
        </section>
      )}
    </div>
  );
}
