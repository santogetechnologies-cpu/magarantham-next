'use client';
import React, { useEffect, useState } from 'react';
import { api } from '../api';
import { Row, useERP } from './shared';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type PolicyForm = {
  id: string | null;
  name: string;
  divisor_mode: 'scheduled' | 'calendar';
  work_weekdays: number[];
  paid_leave_units: number;
  half_day_pay_pct: number;
  default_leave_lop_pct: number;
  paid_permission_minutes: number;
  permission_lop: 'proportional' | 'half_day' | 'full_day';
  holiday_paid: boolean;
  active: boolean;
};

export function SalaryPoliciesManager({
  refreshRefs,
}: {
  refreshRefs: () => Promise<void>;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [modal, setModal] = useState<PolicyForm | null>(null);
  const { busy, send, notice } = useERP();

  async function load() {
    try {
      const r = await api<Row>('/api/erp/salary_policies?page=0');
      setRows(r.rows || []);
    } catch (e) {
      notice((e as Error).message);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openAdd() {
    setModal({
      id: null,
      name: '',
      divisor_mode: 'scheduled',
      work_weekdays: [1, 2, 3, 4, 5, 6],
      paid_leave_units: 1,
      half_day_pay_pct: 50,
      default_leave_lop_pct: 100,
      paid_permission_minutes: 0,
      permission_lop: 'proportional',
      holiday_paid: true,
      active: true,
    });
  }

  function openEdit(r: Row) {
    setModal({
      id: r.id,
      name: r.name || '',
      divisor_mode: r.divisor_mode === 'calendar' ? 'calendar' : 'scheduled',
      work_weekdays: Array.isArray(r.work_weekdays) ? r.work_weekdays : [1, 2, 3, 4, 5, 6],
      paid_leave_units: Number(r.paid_leave_units || 0),
      half_day_pay_pct: Math.round(Number(r.half_day_pay_bps ?? 5000) / 100),
      default_leave_lop_pct: Math.round(Number(r.default_leave_lop_bps ?? 10000) / 100),
      paid_permission_minutes: Number(r.paid_permission_minutes || 0),
      permission_lop: r.permission_lop || 'proportional',
      holiday_paid: Boolean(r.holiday_paid),
      active: r.active !== false,
    });
  }

  function toggleDay(dayIdx: number) {
    if (!modal) return;
    const exists = modal.work_weekdays.includes(dayIdx);
    const next = exists
      ? modal.work_weekdays.filter((d) => d !== dayIdx)
      : [...modal.work_weekdays, dayIdx].sort((a, b) => a - b);
    if (next.length === 0) return;
    setModal({ ...modal, work_weekdays: next });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!modal) return;
    const res = await send(
      'salary_policies',
      {
        id: modal.id,
        data: {
          name: modal.name.trim(),
          divisor_mode: modal.divisor_mode,
          work_weekdays: modal.work_weekdays,
          paid_leave_units: modal.paid_leave_units,
          leave_rule_mode: 'ordinal',
          leave_tiers: [],
          default_leave_lop_bps: Math.min(100, Math.max(0, modal.default_leave_lop_pct)) * 100,
          half_day_pay_bps: Math.min(100, Math.max(0, modal.half_day_pay_pct)) * 100,
          paid_permission_minutes: Math.max(0, Math.round(modal.paid_permission_minutes)),
          permission_lop: modal.permission_lop,
          holiday_paid: modal.holiday_paid,
          active: modal.active,
        },
      },
      async () => {
        await load();
        await refreshRefs();
      },
    );
    if (res) setModal(null);
  }

  return (
    <div className="sp-root">
      <div className="cat-mgmt-toolbar">
        <div>
          <p style={{ margin: 0, fontSize: 13, color: 'var(--erp-text-muted)' }}>
            Salary rules define working days, paid leaves, and half-day pay. A ready-to-use shop default rule is already set up.
          </p>
        </div>
        <button type="button" className="button" onClick={openAdd}>
          + Add Salary Rule
        </button>
      </div>

      <div className="sp-rules-grid">
        {rows.map((r) => {
          const days = Array.isArray(r.work_weekdays)
            ? r.work_weekdays.map((i: number) => WEEKDAYS[i]).join(', ')
            : 'Mon–Sat';
          return (
            <section className="sp-panel" key={r.id}>
              <div className="sp-panel-head">
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h3 className="sp-panel-title" style={{ margin: 0 }}>
                      {r.name}
                    </h3>
                    <span
                      className={`pill-status ${
                        r.active === false ? 'status-pending' : 'status-paid'
                      }`}
                    >
                      {r.active === false ? 'Off' : 'Active'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="button outline-btn mini-btn"
                  onClick={() => openEdit(r)}
                >
                  Edit Rule
                </button>
              </div>

              <div className="sp-rule-facts">
                <div>
                  <span>Working Days</span>
                  <strong>{days}</strong>
                </div>
                <div>
                  <span>Paid Leaves / Month</span>
                  <strong>{r.paid_leave_units || 0} days</strong>
                </div>
                <div>
                  <span>Half-Day Pay</span>
                  <strong>{Math.round(Number(r.half_day_pay_bps || 5000) / 100)}%</strong>
                </div>
                <div>
                  <span>Shop Holidays</span>
                  <strong>{r.holiday_paid ? 'Paid' : 'Unpaid'}</strong>
                </div>
              </div>
            </section>
          );
        })}
      </div>

      {modal && (
        <div
          className="luxury-modal-overlay"
          onClick={() => !busy && setModal(null)}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="luxury-modal-card"
            style={{ maxWidth: 540 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <span className="modal-eyebrow">✦ SALARY RULES</span>
                <h2 className="modal-title">
                  {modal.id ? 'Edit Salary Rule' : 'New Salary Rule'}
                </h2>
              </div>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setModal(null)}
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form className="modal-form-body" onSubmit={handleSave}>
              <label className="input-group">
                <span>Rule Name *</span>
                <input
                  required
                  maxLength={120}
                  placeholder="e.g. Standard 6-Day Shop Rule (1 Paid Leave)"
                  value={modal.name}
                  onChange={(e) => setModal({ ...modal, name: e.target.value })}
                />
              </label>

              <div className="input-group">
                <span>Working Days in a Week</span>
                <div className="sp-weekdays-row">
                  {WEEKDAYS.map((day, idx) => {
                    const active = modal.work_weekdays.includes(idx);
                    return (
                      <button
                        key={day}
                        type="button"
                        className={`sp-day-chip ${active ? 'active' : ''}`}
                        onClick={() => toggleDay(idx)}
                      >
                        {day}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="row-inputs-2">
                <label className="input-group">
                  <span>Free Paid Leaves / Month</span>
                  <input
                    type="number"
                    min={0}
                    max={31}
                    step="0.5"
                    value={modal.paid_leave_units}
                    onChange={(e) =>
                      setModal({
                        ...modal,
                        paid_leave_units: Math.max(0, Number(e.target.value || 0)),
                      })
                    }
                  />
                </label>
                <label className="input-group">
                  <span>Half-Day Salary Paid (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="1"
                    value={modal.half_day_pay_pct}
                    onChange={(e) =>
                      setModal({
                        ...modal,
                        half_day_pay_pct: Math.min(100, Math.max(0, Math.round(Number(e.target.value || 0)))),
                      })
                    }
                  />
                </label>
              </div>

              <label className="input-group">
                <span>How Monthly Salary Is Divided</span>
                <select
                  value={modal.divisor_mode}
                  onChange={(e) =>
                    setModal({
                      ...modal,
                      divisor_mode: e.target.value === 'calendar' ? 'calendar' : 'scheduled',
                    })
                  }
                >
                  <option value="scheduled">By working days in the month (e.g. 26 days)</option>
                  <option value="calendar">By total calendar days (30 / 31 days)</option>
                </select>
              </label>

              <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap' }}>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={modal.holiday_paid}
                    onChange={(e) =>
                      setModal({ ...modal, holiday_paid: e.target.checked })
                    }
                  />
                  <span>Pay staff on marked shop holidays</span>
                </label>
                <label className="checkbox-item">
                  <input
                    type="checkbox"
                    checked={modal.active}
                    onChange={(e) => setModal({ ...modal, active: e.target.checked })}
                  />
                  <span>Active rule</span>
                </label>
              </div>

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
                  {busy ? 'Saving…' : 'Save Rule'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
