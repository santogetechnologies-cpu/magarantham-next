'use client';
import { useEffect, useState } from 'react';
import { indiaDate } from '@/lib/barcode';
import { money } from '@/lib/core';
import { api } from '../api';
import { Row, useERP, downloadCSV } from './shared';

const label = (key: string) =>
  key
    .replace(/_paise$/, '')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .replace('Pos ', 'POS ');

function shift(date: string, days: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function Reports() {
  const today = indiaDate();
  const [from, setFrom] = useState(today.slice(0, 7) + '-01');
  const [to, setTo] = useState(today);
  const [data, setData] = useState<Row | null>(null);
  const [loading, setLoading] = useState(false);
  const { notice } = useERP();

  const presets: [string, string, string][] = (() => {
    const monthStart = today.slice(0, 7) + '-01';
    const lastMonthEnd = shift(monthStart, -1);
    const lastMonthStart = lastMonthEnd.slice(0, 7) + '-01';
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    return [
      ['Today', today, today],
      ['Yesterday', shift(today, -1), shift(today, -1)],
      ['This week', shift(today, -((dow + 6) % 7)), today],
      ['This month', monthStart, today],
      ['Last month', lastMonthStart, lastMonthEnd],
      ['Last 90 days', shift(today, -89), today],
    ];
  })();

  async function run(f = from, t = to) {
    setLoading(true);
    try {
      setData(await api<Row>(`/api/erp/reports?from=${f}&to=${t}`));
    } catch (error) {
      notice((error as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const metrics = data
    ? Object.entries(data).filter(([key, v]) => v !== null && typeof v !== 'object' && !['from', 'to'].includes(key))
    : [];
  const moneyMetrics = metrics.filter(([k]) => k.endsWith('_paise'));
  const countMetrics = metrics.filter(([k]) => !k.endsWith('_paise'));
  const tenders = Object.entries((data?.pos_tenders || {}) as Record<string, number>);
  const tenderTotal = tenders.reduce((s, [, v]) => s + Number(v), 0);

  return (
    <div className="ms-stack">
      <section className="ms-card">
        <div className="ms-card-head">
          <div>
            <h2>Date range</h2>
            <p>India time. Up to 366 days.</p>
          </div>
          {data && (
            <button
              type="button"
              className="ms-btn ms-btn-ghost ms-btn-sm"
              onClick={() =>
                downloadCSV(`shop-summary-${data.from}-to-${data.to}.csv`, [
                  ['From', 'To', 'Metric', 'Amount Rs / count'],
                  ...metrics.map(([k, v]) => [data.from, data.to, label(k), k.endsWith('_paise') ? Number(v) / 100 : v]),
                  ...tenders.map(([k, v]) => [data.from, data.to, `POS gross ${k}`, Number(v) / 100]),
                ])
              }
            >
              ⬇ Export CSV
            </button>
          )}
        </div>
        <div className="ms-chips" style={{ marginBottom: 14 }}>
          {presets.map(([name, f, t]) => (
            <button
              type="button"
              key={name}
              className={`ms-chip ${from === f && to === t ? 'on' : ''}`}
              onClick={() => {
                setFrom(f);
                setTo(t);
                void run(f, t);
              }}
            >
              {name}
            </button>
          ))}
        </div>
        <form
          className="rp-range"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <label className="ms-field">
            <span>From</span>
            <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} required />
          </label>
          <label className="ms-field">
            <span>To</span>
            <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} required />
          </label>
          <button className="ms-btn ms-btn-primary" disabled={loading}>{loading ? 'Loading…' : 'Run report'}</button>
        </form>
      </section>

      {loading && !data && <div className="ms-skeleton-list"><span /><span /></div>}

      {data && (
        <>
          <div className="ms-kpis">
            {moneyMetrics.map(([k, v], i) => (
              <div key={k} className={`ms-kpi ${i === 0 ? 'ms-kpi-accent' : ''}`}>
                <span>{label(k)}</span>
                <strong>{money(Number(v))}</strong>
              </div>
            ))}
            {countMetrics.map(([k, v]) => (
              <div key={k} className="ms-kpi">
                <span>{label(k)}</span>
                <strong>{String(v)}</strong>
              </div>
            ))}
          </div>

          {tenders.length > 0 && (
            <section className="ms-card">
              <div className="ms-card-head">
                <div>
                  <h2>POS payments received</h2>
                  <p>Gross receipts by payment method on the sale day.</p>
                </div>
                <strong className="rp-total">{money(tenderTotal)}</strong>
              </div>
              <div className="rp-bars">
                {tenders.map(([k, v]) => {
                  const pct = tenderTotal ? (Number(v) / tenderTotal) * 100 : 0;
                  return (
                    <div key={k} className="rp-bar">
                      <span>{k.toUpperCase()}</span>
                      <div className="rp-track"><i style={{ width: `${pct}%` }} /></div>
                      <b>{money(Number(v))}</b>
                      <small>{pct.toFixed(0)}%</small>
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          <p className="ms-muted">
            POS returns are shown on their return date. Online figures are orders created in this period that are now paid. Supplier
            balances and stock are current balances. This is an operational summary, not a statutory accounting statement.
          </p>
        </>
      )}
    </div>
  );
}
