'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/core';
import { api } from '../api';
import { useShop } from '../shop-context';
import { Row } from './shared';

type Line = { label: string; amount_paise: number };
type StaffState = {
  calc?: Row;
  error?: string;
  loading?: boolean;
  bonus: number;
  allowances: Line[];
  deductions: Line[];
  open?: boolean;
  dirty?: boolean;
};

const sum = (l: Line[]) => l.reduce((s, x) => s + Math.max(0, Number(x.amount_paise) || 0), 0);
const clean = (l: Line[]) =>
  l.filter((x) => x.label.trim()).map((x) => ({ label: x.label.trim().slice(0, 100), amount_paise: Math.max(0, Math.round(Number(x.amount_paise) || 0)) }));

const ERRORS: Record<string, string> = {
  PAYROLL_MONTH_NOT_CLOSED: 'Month not finished yet',
  SALARY_POLICY_REQUIRED: 'No salary rule assigned',
  NO_EMPLOYMENT_IN_PERIOD: 'Not employed this month',
};
function friendly(msg: string) {
  if (msg.startsWith('MISSING_ATTENDANCE')) return `Attendance missing for ${msg.split(':')[1]?.trim() || 'a day'}`;
  return ERRORS[msg] || msg;
}

function LinesEditor({ title, lines, onChange, tone }: { title: string; lines: Line[]; onChange: (l: Line[]) => void; tone: 'plus' | 'minus' }) {
  return (
    <div className={`pr-lines pr-lines-${tone}`}>
      <div className="pr-lines-head">
        <strong>{title}</strong>
        <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => onChange([...lines, { label: '', amount_paise: 0 }])}>+ Add</button>
      </div>
      {lines.length === 0 && <p className="ms-muted">None this month.</p>}
      {lines.map((l, i) => (
        <div className="pr-line" key={i}>
          <input
            value={l.label}
            maxLength={100}
            placeholder={tone === 'plus' ? 'e.g. Festival allowance' : 'e.g. Salary advance'}
            onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
          />
          <div className="ms-input-affix pr-amount">
            <em>₹</em>
            <input
              type="number"
              min={0}
              step="1"
              value={l.amount_paise ? l.amount_paise / 100 : ''}
              onChange={(e) => onChange(lines.map((x, j) => (j === i ? { ...x, amount_paise: Math.round(Number(e.target.value) * 100) } : x)))}
            />
          </div>
          <button type="button" className="ms-btn ms-btn-danger-ghost ms-btn-sm" onClick={() => onChange(lines.filter((_, j) => j !== i))} aria-label="Remove">✕</button>
        </div>
      ))}
    </div>
  );
}

/**
 * Month-at-a-glance payroll for every active staff member: preview salary from
 * attendance, add this month's bonus / allowances / deductions per person, then
 * save drafts and approve in bulk.
 */
export function PayrollRun({
  staff,
  runs,
  month,
  setMonth,
  onChanged,
}: {
  staff: Row[];
  runs: Row[];
  month: string;
  setMonth: (m: string) => void;
  onChanged: () => Promise<void>;
}) {
  const { notice } = useShop();
  const active = useMemo(() => staff.filter((s) => s.active !== false), [staff]);
  const [state, setState] = useState<Record<string, StaffState>>({});
  const [working, setWorking] = useState('');
  const [query, setQuery] = useState('');

  const runFor = (id: string) => runs.find((r) => r.employee_id === id && String(r.period).slice(0, 7) === month);

  // Seed each person's adjustments from an existing draft for this month.
  useEffect(() => {
    const next: Record<string, StaffState> = {};
    for (const e of active) {
      const run = runFor(e.id);
      next[e.id] = {
        bonus: Number(run?.bonus_paise || 0),
        allowances: (run?.monthly_allowances || []) as Line[],
        deductions: (run?.monthly_deductions || []) as Line[],
      };
    }
    setState(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month, active.length, runs.length]);

  function patch(id: string, p: Partial<StaffState>) {
    setState((o) => ({ ...o, [id]: { ...(o[id] || { bonus: 0, allowances: [], deductions: [] }), ...p } }));
  }

  async function previewOne(id: string) {
    patch(id, { loading: true, error: '' });
    try {
      const r = await api<Row>(`/api/erp/payroll_preview?employee_id=${id}&period=${month}-01`);
      patch(id, { calc: r.calculation, loading: false });
    } catch (e) {
      patch(id, { calc: undefined, loading: false, error: friendly((e as Error).message) });
    }
  }

  async function previewAll() {
    setWorking('Calculating salaries…');
    const ids = active.map((e) => e.id);
    for (let i = 0; i < ids.length; i += 3) await Promise.all(ids.slice(i, i + 3).map(previewOne));
    setWorking('');
  }

  function net(e: Row) {
    const st = state[e.id];
    if (!st?.calc) return null;
    const recurringA = sum((e.allowances || []) as Line[]);
    const recurringD = sum((e.deductions || []) as Line[]);
    const gross = Number(st.calc.earned_base_paise) + Number(st.calc.overtime_paise) + recurringA + sum(st.allowances) + st.bonus;
    const ded = recurringD + sum(st.deductions);
    return { gross, ded, net: gross - ded };
  }

  async function saveDraft(e: Row, quiet = false) {
    const st = state[e.id];
    const run = runFor(e.id);
    if (run && run.status !== 'draft') return false;
    try {
      await api('/api/erp/payroll', {
        employee_id: e.id,
        period: `${month}-01`,
        bonus_paise: Math.max(0, Math.round(st?.bonus || 0)),
        allowances: clean(st?.allowances || []),
        deductions: clean(st?.deductions || []),
      });
      patch(e.id, { dirty: false });
      if (!quiet) {
        notice(`Salary draft saved for ${e.name}.`);
        await onChanged();
      }
      return true;
    } catch (err) {
      const m = friendly((err as Error).message);
      patch(e.id, { error: m });
      if (!quiet) notice(m);
      return false;
    }
  }

  async function saveAll() {
    setWorking('Saving drafts…');
    let ok = 0, skipped = 0;
    for (const e of active) {
      const run = runFor(e.id);
      if (run && run.status !== 'draft') { skipped++; continue; }
      if (await saveDraft(e, true)) ok++;
    }
    await onChanged();
    setWorking('');
    notice(`${ok} salary draft${ok === 1 ? '' : 's'} saved${skipped ? `, ${skipped} already approved or paid` : ''}.`);
  }

  async function approveAll() {
    const drafts = active.map((e) => runFor(e.id)).filter((r) => r && r.status === 'draft') as Row[];
    if (!drafts.length) return notice('No drafts to approve for this month.');
    if (!window.confirm(`Approve ${drafts.length} salary draft${drafts.length === 1 ? '' : 's'} for ${month}? Attendance for these staff will be locked for the month.`)) return;
    setWorking('Approving…');
    let ok = 0;
    for (const r of drafts) {
      try {
        await api('/api/erp/payroll_finalize', { id: r.id, action: 'approve' });
        ok++;
      } catch (err) {
        notice(`${r.employee_snapshot?.name}: ${friendly((err as Error).message)}`);
      }
    }
    await onChanged();
    setWorking('');
    notice(`${ok} salar${ok === 1 ? 'y' : 'ies'} approved.`);
  }

  async function reopen(r: Row) {
    try {
      await api('/api/erp/payroll_finalize', { id: r.id, action: 'reopen' });
      notice(`${r.employee_snapshot?.name}'s salary is back in draft. Make your changes and save again.`);
      await onChanged();
    } catch (err) {
      notice(friendly((err as Error).message));
    }
  }

  const totals = active.reduce(
    (t, e) => {
      const n = net(e);
      const run = runFor(e.id);
      if (n) { t.net += n.net; t.ready++; }
      if (run?.status === 'draft') t.drafts++;
      if (run?.status === 'approved') t.approved++;
      if (run?.status === 'paid') t.paid++;
      return t;
    },
    { net: 0, ready: 0, drafts: 0, approved: 0, paid: 0 },
  );
  const shown = active.filter((e) => `${e.name} ${e.code} ${e.designation || ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <section className="ms-card pr-run">
      <div className="ms-card-head">
        <div>
          <h2>Monthly payroll · all staff</h2>
          <p>Calculate from attendance, add this month&apos;s bonus or deductions for anyone, then save and approve together.</p>
        </div>
        <div className="ms-head-tools">
          <label className="pr-month">
            <span>Month</span>
            <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="pr-steps">
        <button type="button" className="ms-btn ms-btn-soft" disabled={!!working} onClick={() => void previewAll()}>
          <b>1</b> Calculate all
        </button>
        <span aria-hidden="true">→</span>
        <button type="button" className="ms-btn ms-btn-soft" disabled={!!working || totals.ready === 0} onClick={() => void saveAll()}>
          <b>2</b> Save all drafts
        </button>
        <span aria-hidden="true">→</span>
        <button type="button" className="ms-btn ms-btn-primary" disabled={!!working || totals.drafts === 0} onClick={() => void approveAll()}>
          <b>3</b> Approve {totals.drafts || ''} drafts
        </button>
        {working && <span className="pr-working"><i />{working}</span>}
        <input className="pr-search" type="search" placeholder="Find staff…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="pr-summary">
        <div><span>Staff</span><b>{active.length}</b></div>
        <div><span>Calculated</span><b>{totals.ready}</b></div>
        <div><span>Draft · Approved · Paid</span><b>{totals.drafts} · {totals.approved} · {totals.paid}</b></div>
        <div className="pr-summary-total"><span>Estimated payout</span><b>{money(totals.net)}</b></div>
      </div>

      <div className="table-responsive-wrapper">
        <table className="luxury-table pr-table">
          <thead>
            <tr>
              <th>Staff</th>
              <th>Attendance</th>
              <th>Earned + OT</th>
              <th>Bonus</th>
              <th>Extras</th>
              <th>Net pay</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((e) => {
              const st = state[e.id] || { bonus: 0, allowances: [], deductions: [] };
              const run = runFor(e.id);
              const locked = run && run.status !== 'draft';
              const n = net(e);
              const extrasCount = st.allowances.length + st.deductions.length;
              return (
                <Fragment key={e.id}>
                  <tr className={st.open ? 'pr-open' : ''}>
                    <td>
                      <div className="pr-person">
                        <span className="ms-avatar pr-avatar">{String(e.name || '?').split(' ').map((w: string) => w[0]).slice(0, 2).join('')}</span>
                        <span>
                          <strong>{e.name}</strong>
                          <small>{e.code} · {e.pay_basis} {money(e.rate_paise)}</small>
                        </span>
                      </div>
                    </td>
                    <td>
                      {st.loading ? (
                        <span className="pr-dots"><i /><i /><i /></span>
                      ) : st.error ? (
                        <span className="ms-badge ms-badge-warn" title={st.error}>{st.error}</span>
                      ) : st.calc ? (
                        <span className="pr-att">
                          <b>{Number(st.calc.paid_units).toFixed(1)}</b>/{st.calc.period_divisor} paid
                          {Number(st.calc.lop_units) > 0 && <small> · {Number(st.calc.lop_units).toFixed(1)} LOP</small>}
                        </span>
                      ) : (
                        <button type="button" className="text-link" onClick={() => void previewOne(e.id)}>Calculate</button>
                      )}
                    </td>
                    <td className="money-cell">{st.calc ? money(Number(st.calc.earned_base_paise) + Number(st.calc.overtime_paise)) : '—'}</td>
                    <td>
                      <div className="ms-input-affix pr-bonus">
                        <em>₹</em>
                        <input
                          type="number"
                          min={0}
                          step="1"
                          disabled={!!locked}
                          value={st.bonus ? st.bonus / 100 : ''}
                          placeholder="0"
                          onChange={(ev) => patch(e.id, { bonus: Math.max(0, Math.round(Number(ev.target.value) * 100)), dirty: true })}
                        />
                      </div>
                    </td>
                    <td>
                      <button type="button" className={`pr-extras-btn ${extrasCount ? 'has' : ''}`} disabled={!!locked} onClick={() => patch(e.id, { open: !st.open })}>
                        {extrasCount ? `+${money(sum(st.allowances))} / −${money(sum(st.deductions))}` : 'Add allowance / deduction'}
                      </button>
                    </td>
                    <td className="money-cell pr-net">{n ? money(n.net) : run ? money(run.net_paise) : '—'}{st.dirty && <small className="pr-unsaved">unsaved</small>}</td>
                    <td>
                      {run ? (
                        <span className={`pill-status ${run.status === 'paid' ? 'status-paid' : run.status === 'approved' ? 'status-processing' : 'status-pending'}`}>
                          {run.status === 'paid' ? 'Paid' : run.status === 'approved' ? 'Approved' : 'Draft'}
                        </span>
                      ) : (
                        <span className="ms-badge ms-badge-off">Not started</span>
                      )}
                    </td>
                    <td className="pr-actions">
                      {run?.status === 'approved' ? (
                        <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => void reopen(run)}>Reopen to edit</button>
                      ) : run?.status === 'paid' ? (
                        <span className="ms-muted">Locked</span>
                      ) : (
                        <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" disabled={!!working || !st.calc} onClick={() => void saveDraft(e)}>
                          {run ? 'Update draft' : 'Save draft'}
                        </button>
                      )}
                    </td>
                  </tr>
                  {st.open && !locked && (
                    <tr className="pr-expand">
                      <td colSpan={8}>
                        <div className="pr-expand-grid">
                          <LinesEditor title="Extra allowances this month" tone="plus" lines={st.allowances} onChange={(l) => patch(e.id, { allowances: l, dirty: true })} />
                          <LinesEditor title="Deductions / advances this month" tone="minus" lines={st.deductions} onChange={(l) => patch(e.id, { deductions: l, dirty: true })} />
                          {n && (
                            <div className="pr-breakdown">
                              <div><span>Earned salary</span><b>{money(st.calc!.earned_base_paise)}</b></div>
                              <div><span>Overtime</span><b>{money(st.calc!.overtime_paise)}</b></div>
                              <div><span>Recurring allowances</span><b>{money(sum(e.allowances || []))}</b></div>
                              <div><span>This month&apos;s extras + bonus</span><b>{money(sum(st.allowances) + st.bonus)}</b></div>
                              <div><span>All deductions</span><b>−{money(n.ded)}</b></div>
                              <div className="pr-breakdown-net"><span>Net pay</span><b>{money(n.net)}</b></div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
