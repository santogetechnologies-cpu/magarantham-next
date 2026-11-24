'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { money } from '@/lib/core';
import { api } from '../api';
import { References, Row, useERP, downloadCSV } from './shared';

type Line = { product_id: string; quantity: number; unit_cost_paise: number; tax_bps: number };
const STATUS: Record<string, { label: string; badge: string }> = {
  draft: { label: 'Draft', badge: 'off' },
  ordered: { label: 'Ordered', badge: 'scheduled' },
  partial: { label: 'Part received', badge: 'warn' },
  received: { label: 'Received', badge: 'live' },
  cancelled: { label: 'Cancelled', badge: 'expired' },
};
const lineTotal = (l: Line) => Math.round(l.quantity * l.unit_cost_paise * (1 + l.tax_bps / 10000));
const poTotal = (lines: Line[]) => lines.reduce((s, l) => s + lineTotal(l), 0);
const esc = (v: unknown) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function ProductPicker({ products, value, exclude, onChange }: { products: Row[]; value: string; exclude: string[]; onChange: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const chosen = products.find((p) => p.id === value);
  const list = products
    .filter((p) => !exclude.includes(p.id) || p.id === value)
    .filter((p) => `${p.name} ${p.sku} ${p.barcode || ''} ${p.category || ''}`.toLowerCase().includes(q.trim().toLowerCase()))
    .slice(0, 40);
  return (
    <div className="pu-picker">
      <input
        value={open ? q : chosen ? `${chosen.sku} · ${chosen.name}` : ''}
        placeholder="Search saree by name, SKU or barcode…"
        onFocus={() => { setOpen(true); setQ(''); }}
        onClick={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
          if (e.key === 'Enter' && open && list[0]) { e.preventDefault(); onChange(list[0].id); setOpen(false); }
        }}
        required={!value}
      />
      {open && (
        <ul className="pu-picker-list" role="listbox">
          {list.length === 0 && <li className="ms-muted">No matching saree.</li>}
          {list.map((p) => (
            <li key={p.id}>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); onChange(p.id); setOpen(false); }}>
                {p.image_path ? <img src={p.image_path} alt="" /> : <span className="ms-pick-ph" />}
                <span><strong>{p.name}</strong><small>{p.sku} · sells {money(p.price_paise)} · {p.stock_on_hand ?? 0} in stock</small></span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Purchases({ refs }: { refs: References }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Row | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [kind, setKind] = useState<'receive' | 'return'>('receive');
  const [qty, setQty] = useState<Record<string, number>>({});
  const [note, setNote] = useState('');
  const [updateCost, setUpdateCost] = useState(true);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('open');
  const [supplier, setSupplier] = useState('');
  const { busy, send, notice } = useERP();

  const products = refs.products || [];
  const suppliers = refs.suppliers || [];
  const product = (id: string) => products.find((p) => p.id === id);

  async function load(page = 0) {
    try {
      const r = await api<Row>(`/api/erp/purchases?page=${page}`);
      setRows((old) => (page === 0 ? r.rows : [...old, ...r.rows]));
      setNext(r.nextPage);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const current = rows.find((r) => r.id === selected);
  useEffect(() => {
    setQty({});
    setNote('');
    setKind('receive');
  }, [selected]);

  function edit(r?: Row, copy = false) {
    setSelected(null);
    setDraft(
      r
        ? {
            id: copy ? crypto.randomUUID() : r.id,
            isNew: copy,
            data: { supplier_id: r.supplier_id, supplier_invoice: copy ? '' : r.supplier_invoice, note: r.note, expected_on: copy ? null : r.expected_on },
            lines: r.purchase_items.map((i: Row) => ({ product_id: i.product_id, quantity: i.quantity, unit_cost_paise: i.unit_cost_paise, tax_bps: i.tax_bps })),
          }
        : {
            id: crypto.randomUUID(),
            isNew: true,
            data: { supplier_id: suppliers.find((s) => s.active)?.id || '', supplier_invoice: '', note: '', expected_on: null },
            lines: [{ product_id: '', quantity: 1, unit_cost_paise: 0, tax_bps: 0 }],
          },
    );
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  function setLine(i: number, patch: Partial<Line>) {
    if (!draft) return;
    setDraft({ ...draft, lines: draft.lines.map((l: Line, j: number) => (j === i ? { ...l, ...patch } : l)) });
  }

  const stats = useMemo(() => {
    const open = rows.filter((r) => ['draft', 'ordered', 'partial'].includes(r.status));
    const toReceive = rows
      .filter((r) => ['ordered', 'partial'].includes(r.status))
      .reduce((s, r) => s + r.purchase_items.reduce((t: number, i: Row) => t + (i.quantity - i.received), 0), 0);
    return {
      open: open.length,
      toReceive,
      due: rows.reduce((s, r) => s + Math.max(0, Number(r.due_paise || 0)), 0),
      credit: rows.reduce((s, r) => s + Math.max(0, -Number(r.due_paise || 0)), 0),
    };
  }, [rows]);

  const visible = rows.filter((r) => {
    if (status === 'open' && !['draft', 'ordered', 'partial'].includes(r.status)) return false;
    if (status === 'due' && Number(r.due_paise || 0) === 0) return false;
    if (!['open', 'due', 'all'].includes(status) && r.status !== status) return false;
    if (supplier && r.supplier_id !== supplier) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const names = r.purchase_items.map((i: Row) => `${product(i.product_id)?.name || ''} ${product(i.product_id)?.sku || ''}`).join(' ');
    return `po-${r.number} ${r.suppliers?.name || ''} ${r.supplier_invoice || ''} ${names}`.toLowerCase().includes(q);
  });

  function printPO(r: Row) {
    const sup = suppliers.find((s) => s.id === r.supplier_id) || r.suppliers || {};
    const lines = r.purchase_items as Line[];
    const body = lines
      .map((l) => {
        const p = product(l.product_id);
        return `<tr><td>${esc(p?.sku)}</td><td>${esc(p?.name || l.product_id)}</td><td class="n">${l.quantity}</td><td class="n">${esc(money(l.unit_cost_paise))}</td><td class="n">${l.tax_bps / 100}%</td><td class="n">${esc(money(lineTotal(l)))}</td></tr>`;
      })
      .join('');
    const w = window.open('', '_blank', 'width=860,height=900');
    if (!w) return notice('Allow pop-ups to print the purchase order.');
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>PO-${r.number}</title><style>body{font-family:Arial,sans-serif;color:#111;margin:32px;font-size:13px}h1{margin:0;font-size:22px;color:#7a1230}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border-bottom:1px solid #ddd;padding:8px;text-align:left}th{font-size:11px;text-transform:uppercase;color:#666}.n{text-align:right}.tot{font-size:16px;font-weight:700;text-align:right;margin-top:14px}.grid{display:flex;justify-content:space-between;gap:24px;margin-top:16px}.muted{color:#666}</style></head><body><h1>Purchase Order PO-${r.number}</h1><div class="muted">மகரந்தம் சில்க்ஸ் · MAGARANTHAM SILKS</div><div class="grid"><div><strong>Supplier</strong><br>${esc(sup.name)}<br>${esc(sup.phone || '')}<br>${esc(sup.address || '')}${sup.gstin ? `<br>GSTIN ${esc(sup.gstin)}` : ''}</div><div><strong>Date</strong> ${esc(new Date(r.created_at).toLocaleDateString('en-IN'))}<br>${r.expected_on ? `<strong>Expected</strong> ${esc(r.expected_on)}<br>` : ''}${r.supplier_invoice ? `<strong>Supplier invoice</strong> ${esc(r.supplier_invoice)}<br>` : ''}<strong>Status</strong> ${esc(STATUS[r.status]?.label || r.status)}</div></div><table><thead><tr><th>SKU</th><th>Saree</th><th class="n">Qty</th><th class="n">Unit cost</th><th class="n">Tax</th><th class="n">Amount</th></tr></thead><tbody>${body}</tbody></table><div class="tot">Total ${esc(money(poTotal(lines)))}</div>${r.note ? `<p class="muted">Note: ${esc(r.note)}</p>` : ''}<script>window.onload=()=>window.print()</script></body></html>`);
    w.document.close();
  }

  const draftTotal = draft ? poTotal(draft.lines) : 0;
  const draftValid = draft && draft.data.supplier_id && draft.lines.length > 0 && draft.lines.every((l: Line) => l.product_id && l.quantity >= 1);

  return (
    <div className="ms-stack">
      <div className="ms-kpis">
        <div className="ms-kpi"><span>Open purchases</span><strong>{stats.open}</strong><small>Draft, ordered or part received</small></div>
        <div className="ms-kpi"><span>Units to receive</span><strong>{stats.toReceive}</strong><small>Ordered but not yet in stock</small></div>
        <div className="ms-kpi ms-kpi-accent"><span>Due to suppliers</span><strong>{money(stats.due)}</strong><small>For stock already received</small></div>
        <div className="ms-kpi"><span>Supplier credit</span><strong>{money(stats.credit)}</strong><small>Refunds owed to you</small></div>
      </div>

      {draft && (
        <form
          className="ms-card ms-builder"
          onSubmit={async (e) => {
            e.preventDefault();
            const ids = draft.lines.map((l: Line) => l.product_id);
            if (new Set(ids).size !== ids.length) return notice('Each saree can appear once per purchase. Change the quantity instead.');
            const { isNew: _n, ...payload } = draft;
            if (await send('purchases', payload, () => load())) {
              setDraft(null);
              setSelected(draft.id);
            }
          }}
        >
          <div className="ms-card-head">
            <div>
              <h2>{draft.isNew ? 'New purchase order' : 'Edit purchase draft'}</h2>
              <p>Drafts don&apos;t change stock. Confirm the order, then receive what actually arrives.</p>
            </div>
            <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => setDraft(null)}>Cancel</button>
          </div>
          <div className="pu-head-grid">
            <label className="ms-field">
              <span>Supplier</span>
              <select required value={draft.data.supplier_id} onChange={(e) => setDraft({ ...draft, data: { ...draft.data, supplier_id: e.target.value } })}>
                <option value="">Select supplier</option>
                {suppliers.filter((s) => s.active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <Link href="/admin/suppliers" className="text-link pu-small-link">+ Add supplier</Link>
            </label>
            <label className="ms-field">
              <span>Supplier invoice no. (optional)</span>
              <input value={draft.data.supplier_invoice} maxLength={100} onChange={(e) => setDraft({ ...draft, data: { ...draft.data, supplier_invoice: e.target.value } })} />
            </label>
            <label className="ms-field">
              <span>Expected delivery (optional)</span>
              <input type="date" value={draft.data.expected_on || ''} onChange={(e) => setDraft({ ...draft, data: { ...draft.data, expected_on: e.target.value || null } })} />
            </label>
            <label className="ms-field pu-note">
              <span>Note</span>
              <input value={draft.data.note} maxLength={2000} placeholder="e.g. Deepavali stock, pay in 30 days" onChange={(e) => setDraft({ ...draft, data: { ...draft.data, note: e.target.value } })} />
            </label>
          </div>

          <div className="table-responsive-wrapper pu-lines">
            <table className="luxury-table">
              <thead>
                <tr><th style={{ minWidth: 280 }}>Saree</th><th>Qty</th><th>Unit cost (₹)</th><th>Tax %</th><th>Margin</th><th>Amount</th><th /></tr>
              </thead>
              <tbody>
                {draft.lines.map((l: Line, i: number) => {
                  const p = product(l.product_id);
                  const sell = Number(p?.price_paise || 0);
                  const margin = sell > 0 && l.unit_cost_paise > 0 ? Math.round(((sell - l.unit_cost_paise) / sell) * 100) : null;
                  return (
                    <tr key={i}>
                      <td><ProductPicker products={products} value={l.product_id} exclude={draft.lines.map((x: Line) => x.product_id)} onChange={(id) => setLine(i, { product_id: id, unit_cost_paise: l.unit_cost_paise || Number(product(id)?.purchase_price_paise || 0) })} /></td>
                      <td><input className="pu-num" type="number" min={1} max={10000} value={l.quantity} onChange={(e) => setLine(i, { quantity: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /></td>
                      <td><input className="pu-num" type="number" min={0} step=".01" value={l.unit_cost_paise / 100} onChange={(e) => setLine(i, { unit_cost_paise: Math.max(0, Math.round(Number(e.target.value) * 100)) })} /></td>
                      <td><input className="pu-num pu-tax" type="number" min={0} max={100} step=".01" value={l.tax_bps / 100} onChange={(e) => setLine(i, { tax_bps: Math.max(0, Math.min(10000, Math.round(Number(e.target.value) * 100))) })} /></td>
                      <td>{margin === null ? <span className="ms-muted">—</span> : <span className={`ms-badge ${margin < 15 ? 'ms-badge-warn' : 'ms-badge-live'}`} title={`Sells at ${money(sell)}`}>{margin}%</span>}</td>
                      <td className="money-cell">{money(lineTotal(l))}</td>
                      <td><button type="button" className="ms-btn ms-btn-danger-ghost ms-btn-sm" disabled={draft.lines.length === 1} onClick={() => setDraft({ ...draft, lines: draft.lines.filter((_: Line, j: number) => j !== i) })} aria-label="Remove line">✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="pu-foot">
            <button type="button" className="ms-btn ms-btn-soft ms-btn-sm" disabled={draft.lines.length >= 100} onClick={() => setDraft({ ...draft, lines: [...draft.lines, { product_id: '', quantity: 1, unit_cost_paise: 0, tax_bps: draft.lines[draft.lines.length - 1]?.tax_bps || 0 }] })}>+ Add saree</button>
            <div className="pu-total"><span>{draft.lines.reduce((s: number, l: Line) => s + l.quantity, 0)} units · total incl. tax</span><strong>{money(draftTotal)}</strong></div>
            <button className="ms-btn ms-btn-primary" disabled={busy || !draftValid}>{busy ? 'Saving…' : 'Save draft'}</button>
          </div>
        </form>
      )}

      {current && (
        <section className="ms-card pu-detail">
          <div className="ms-card-head">
            <div>
              <h2>PO-{current.number} · {current.suppliers?.name}</h2>
              <p>
                <span className={`ms-badge ms-badge-${STATUS[current.status]?.badge || 'off'}`}>{STATUS[current.status]?.label || current.status}</span>
                {' '}Created {new Date(current.created_at).toLocaleDateString('en-IN')}
                {current.supplier_invoice ? ` · Invoice ${current.supplier_invoice}` : ''}
                {current.expected_on ? ` · Expected ${current.expected_on}` : ''}
              </p>
            </div>
            <div className="ms-head-tools">
              {current.status === 'draft' && (
                <>
                  <button className="ms-btn ms-btn-primary ms-btn-sm" disabled={busy} onClick={() => send('purchase_status', { id: current.id, status: 'ordered' }, () => load())}>Confirm order</button>
                  <button className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => edit(current)}>Edit</button>
                </>
              )}
              <button className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => edit(current, true)}>Duplicate</button>
              <button className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => printPO(current)}>Print PO</button>
              {['partial', 'received'].includes(current.status) && <Link href={`/admin/labels?purchase_id=${current.id}`} className="ms-btn ms-btn-ghost ms-btn-sm">Print labels</Link>}
              {['draft', 'ordered'].includes(current.status) && current.purchase_items.every((i: Row) => i.received === 0) && (
                <button className="ms-btn ms-btn-danger-ghost ms-btn-sm" disabled={busy} onClick={() => window.confirm(`Cancel PO-${current.number}?`) && send('purchase_status', { id: current.id, status: 'cancelled' }, () => load())}>Cancel PO</button>
              )}
              <button className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => setSelected(null)} aria-label="Close">✕</button>
            </div>
          </div>

          <div className="table-responsive-wrapper">
            <table className="luxury-table">
              <thead><tr><th>Saree</th><th>Ordered</th><th>Received</th><th>Returned</th><th>Unit cost</th><th>Amount</th>{['ordered', 'partial', 'received'].includes(current.status) && <th>{kind === 'receive' ? 'Receive now' : 'Return now'}</th>}</tr></thead>
              <tbody>
                {current.purchase_items.map((i: Row) => {
                  const p = product(i.product_id);
                  const max = kind === 'receive' ? i.quantity - i.received : i.received - i.returned;
                  return (
                    <tr key={i.id}>
                      <td><strong>{p?.name || 'Removed saree'}</strong><small className="pu-sub">{p?.sku}</small></td>
                      <td>{i.quantity}</td>
                      <td>
                        <div className="pu-progress"><i style={{ width: `${Math.min(100, (i.received / i.quantity) * 100)}%` }} /></div>
                        {i.received}
                      </td>
                      <td>{i.returned}</td>
                      <td className="money-cell">{money(i.unit_cost_paise)}<small className="pu-sub">+{i.tax_bps / 100}% tax</small></td>
                      <td className="money-cell">{money(lineTotal(i as Line))}</td>
                      {['ordered', 'partial', 'received'].includes(current.status) && (
                        <td>
                          <input className="pu-num" type="number" min={0} max={max} disabled={max <= 0} value={qty[i.product_id] ?? ''} placeholder={max > 0 ? `max ${max}` : '—'} onChange={(e) => setQty({ ...qty, [i.product_id]: Math.max(0, Math.min(max, Math.round(Number(e.target.value) || 0))) })} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {['ordered', 'partial', 'received'].includes(current.status) && (
            <div className="pu-receive">
              <div className="ms-seg">
                <button type="button" className={kind === 'receive' ? 'on' : ''} onClick={() => { setKind('receive'); setQty({}); }}>Receive stock</button>
                <button type="button" className={kind === 'return' ? 'on' : ''} onClick={() => { setKind('return'); setQty({}); }}>Return to supplier</button>
              </div>
              {kind === 'receive' && (
                <button type="button" className="ms-btn ms-btn-soft ms-btn-sm" onClick={() => setQty(Object.fromEntries(current.purchase_items.map((i: Row) => [i.product_id, i.quantity - i.received]).filter(([, n]: [string, number]) => n > 0)))}>Fill all remaining</button>
              )}
              <input className="pu-note-input" value={note} maxLength={1000} placeholder={kind === 'return' ? 'Reason for return (required)' : 'Receipt note (optional)'} onChange={(e) => setNote(e.target.value)} />
              {kind === 'receive' && (
                <label className="ms-switch" title="Copy this purchase's unit cost to each saree's cost price">
                  <input type="checkbox" checked={updateCost} onChange={(e) => setUpdateCost(e.target.checked)} />
                  <span className="ms-switch-track" aria-hidden="true" />
                  <span>Update saree cost price</span>
                </label>
              )}
              <button
                type="button"
                className="ms-btn ms-btn-primary"
                disabled={busy || !Object.values(qty).some((n) => n > 0) || (kind === 'return' && note.trim().length < 3)}
                onClick={async () => {
                  const lines = Object.entries(qty).filter(([, n]) => n > 0).map(([product_id, quantity]) => ({ product_id, quantity }));
                  const ok = await send('purchase_receive', { id: current.id, kind, lines, note, ...(kind === 'receive' && updateCost ? { update_cost: true } : {}) }, () => load());
                  if (ok) { setQty({}); setNote(''); }
                }}
              >
                {kind === 'receive' ? `Receive ${Object.values(qty).reduce((s, n) => s + n, 0) || ''} units` : `Return ${Object.values(qty).reduce((s, n) => s + n, 0) || ''} units`}
              </button>
              <p className="ms-muted pu-hint">{kind === 'receive' ? 'Received units go into stock for POS and the website straight away, each with its own barcode sticker.' : 'Only unsold units from this purchase can be returned; stock held by online orders is protected.'}</p>
            </div>
          )}

          {Number(current.due_paise || 0) !== 0 && (
            <form
              className="pu-pay"
              onSubmit={async (e) => {
                e.preventDefault();
                const form = e.currentTarget;
                const f = new FormData(form);
                const ok = await send('purchase_pay', { id: current.id, direction: current.due_paise < 0 ? 'refund' : 'paid', amount_paise: Math.round(Number(f.get('amount')) * 100), method: f.get('method'), reference: String(f.get('reference') || ''), checked: f.get('checked') === 'on' }, () => load());
                if (ok) form.reset();
              }}
            >
              <div className="pu-pay-head">
                <strong>{current.due_paise < 0 ? 'Supplier owes you' : 'You owe the supplier'}</strong>
                <span>{money(Math.abs(current.due_paise))}</span>
              </div>
              <div className="pu-pay-grid">
                <label className="ms-field"><span>Amount (₹)</span><input name="amount" type="number" step=".01" min=".01" max={Math.abs(current.due_paise) / 100} defaultValue={Math.abs(current.due_paise) / 100} required /></label>
                <label className="ms-field"><span>Method</span><select name="method" defaultValue="bank">{['bank', 'upi', 'cash', 'card'].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</select></label>
                <label className="ms-field"><span>Reference / voucher no.</span><input name="reference" minLength={6} maxLength={100} required placeholder="Bank ref or cash voucher" /></label>
              </div>
              <label className="check"><input type="checkbox" name="checked" required /> I have completed this {current.due_paise < 0 ? 'refund' : 'payment'} outside the app.</label>
              <button className="ms-btn ms-btn-primary ms-btn-sm" disabled={busy}>{current.due_paise < 0 ? 'Record refund' : 'Record payment'}</button>
            </form>
          )}
        </section>
      )}

      <section className="ms-card">
        <div className="ms-card-head">
          <div>
            <h2>Purchase orders</h2>
            <p>{visible.length} shown</p>
          </div>
          <div className="ms-head-tools">
            {!draft && <button type="button" className="ms-btn ms-btn-primary" onClick={() => edit()}>+ New purchase</button>}
          </div>
        </div>
        <div className="pu-toolbar">
          <input type="search" placeholder="Search PO no., supplier, invoice or saree…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <div className="ms-seg">
            {[['open', 'Open'], ['due', 'Unpaid'], ['received', 'Received'], ['cancelled', 'Cancelled'], ['all', 'All']].map(([k, l]) => (
              <button type="button" key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>
            ))}
          </div>
          <select value={supplier} onChange={(e) => setSupplier(e.target.value)}>
            <option value="">All suppliers</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button
            type="button"
            className="ms-btn ms-btn-ghost ms-btn-sm"
            disabled={!visible.length}
            onClick={() =>
              downloadCSV('purchases.csv', [
                ['PO', 'Date', 'Supplier', 'Invoice', 'Status', 'Units ordered', 'Units received', 'Total Rs', 'Due Rs'],
                ...visible.map((r) => [`PO-${r.number}`, String(r.created_at).slice(0, 10), r.suppliers?.name, r.supplier_invoice, r.status, r.purchase_items.reduce((s: number, i: Row) => s + i.quantity, 0), r.purchase_items.reduce((s: number, i: Row) => s + i.received, 0), poTotal(r.purchase_items) / 100, Number(r.due_paise || 0) / 100]),
              ])
            }
          >
            ⬇ CSV
          </button>
        </div>

        {loading ? (
          <div className="ms-skeleton-list"><span /><span /><span /></div>
        ) : visible.length === 0 ? (
          <div className="ms-empty">
            <span aria-hidden="true">▤</span>
            <h3>{rows.length ? 'No purchases match' : 'No purchases yet'}</h3>
            <p>{rows.length ? 'Try another filter.' : 'Create a purchase order when you buy stock from a weaver or mill.'}</p>
          </div>
        ) : (
          <div className="table-responsive-wrapper">
            <table className="luxury-table">
              <thead><tr><th>PO</th><th>Supplier</th><th>Status</th><th>Received</th><th>Total</th><th>Due</th><th /></tr></thead>
              <tbody>
                {visible.map((r) => {
                  const ordered = r.purchase_items.reduce((s: number, i: Row) => s + i.quantity, 0);
                  const got = r.purchase_items.reduce((s: number, i: Row) => s + i.received, 0);
                  return (
                    <tr key={r.id} className={selected === r.id ? 'pr-open' : ''} onClick={() => setSelected(r.id)} style={{ cursor: 'pointer' }}>
                      <td><strong>PO-{r.number}</strong><small className="pu-sub">{new Date(r.created_at).toLocaleDateString('en-IN')}{r.supplier_invoice ? ` · ${r.supplier_invoice}` : ''}</small></td>
                      <td>{r.suppliers?.name}</td>
                      <td><span className={`ms-badge ms-badge-${STATUS[r.status]?.badge || 'off'}`}>{STATUS[r.status]?.label || r.status}</span></td>
                      <td><div className="pu-progress"><i style={{ width: `${ordered ? (got / ordered) * 100 : 0}%` }} /></div><small className="pu-sub">{got}/{ordered} units</small></td>
                      <td className="money-cell">{money(poTotal(r.purchase_items))}</td>
                      <td className="money-cell">{Number(r.due_paise || 0) === 0 ? <span className="ms-muted">—</span> : Number(r.due_paise) < 0 ? <span className="pu-credit">credit {money(-r.due_paise)}</span> : money(r.due_paise)}</td>
                      <td><button type="button" className="ms-btn ms-btn-ghost ms-btn-sm">Open</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {next !== null && <button type="button" className="ms-btn ms-btn-ghost" style={{ marginTop: 12 }} onClick={() => void load(next)}>Load more</button>}
      </section>
    </div>
  );
}
