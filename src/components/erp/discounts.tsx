'use client';
import { useEffect, useMemo, useState } from 'react';
import { money } from '@/lib/core';
import { parseDiscountChannels, formatDiscountName } from '@/lib/discounts';
import { api } from '../api';
import { References, Row, useERP } from './shared';

type Scope = 'all' | 'category' | 'subcategory' | 'product';

const SCOPES: { key: Scope; title: string; hint: string; icon: string }[] = [
  { key: 'all', title: 'All products', hint: 'Every saree in the shop and online', icon: '◎' },
  { key: 'category', title: 'A category', hint: 'All sarees in one main category', icon: '▦' },
  { key: 'subcategory', title: 'A subcategory', hint: 'All sarees in one subcategory', icon: '▤' },
  { key: 'product', title: 'One saree', hint: 'A single product and all its pieces', icon: '◇' },
];
const QUICK = [5, 10, 15, 20, 25, 30, 40, 50];

function toLocalInput(iso: string | null) {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
function fromLocalInput(v: string) {
  return v ? new Date(v).toISOString() : null;
}

export function ruleStatus(r: Row, now = Date.now()) {
  if (!r.active) return { key: 'off', label: 'Off' };
  if (r.starts_at && Date.parse(r.starts_at) > now) return { key: 'scheduled', label: 'Scheduled' };
  if (r.ends_at && Date.parse(r.ends_at) <= now) return { key: 'expired', label: 'Ended' };
  return { key: 'live', label: 'Live' };
}

function emptyDraft(): Row {
  return {
    id: null,
    name: '',
    scope: 'all',
    target_id: null,
    discount_bps: 1000,
    active: true,
    apply_in_pos: true,
    apply_online: true,
    starts_at: null,
    ends_at: null,
  };
}

export function DiscountsManager({ refs }: { refs: References }) {
  const [rules, setRules] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Row | null>(null);
  const [targetSearch, setTargetSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'live' | 'scheduled' | 'off'>('all');
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const { busy, send, notice } = useERP();

  const categories = refs.categories || [];
  const products = refs.products || [];
  const mains = categories.filter((c) => !c.parent_id);
  const subs = categories.filter((c) => c.parent_id);
  const catName = (id: string) => categories.find((c) => c.id === id)?.name || 'Unknown';

  async function load() {
    try {
      const r = await api<Row>('/api/erp/catalog_discounts?page=0');
      setRules(r.rows || []);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  function affected(scope: Scope, target: string | null): Row[] {
    if (scope === 'all') return products;
    if (!target) return [];
    if (scope === 'product') return products.filter((p) => p.id === target);
    if (scope === 'subcategory') return products.filter((p) => p.subcategory_id === target);
    return products.filter((p) => p.category_id === target || (!p.category_id && p.category === catName(target)));
  }

  function targetLabel(r: Row) {
    if (r.scope === 'all') return 'All products';
    if (r.scope === 'product') {
      const p = products.find((x) => x.id === r.target_id);
      return p ? `${p.name} · ${p.sku}` : 'Removed product';
    }
    const c = categories.find((x) => x.id === r.target_id);
    if (!c) return 'Removed category';
    return r.scope === 'subcategory' ? `${catName(c.parent_id)} › ${c.name}` : c.name;
  }

  const now = Date.now();
  const stats = useMemo(() => {
    const live = rules.filter((r) => ruleStatus(r, now).key === 'live');
    const discounted = products.filter((p) => Number(p.effective_price_paise ?? p.price_paise) < Number(p.price_paise));
    return {
      live: live.length,
      scheduled: rules.filter((r) => ruleStatus(r, now).key === 'scheduled').length,
      discounted: discounted.length,
      best: live.reduce((m, r) => Math.max(m, Number(r.discount_bps) / 100), 0),
    };
  }, [rules, products, now]);

  const visible = rules.filter((r) => {
    const s = ruleStatus(r, now).key;
    if (filter === 'all') return true;
    if (filter === 'off') return s === 'off' || s === 'expired';
    return s === filter;
  });

  async function save(rule: Row) {
    const info = parseDiscountChannels(rule.name, rule.active);
    const applyPos = rule.apply_in_pos !== undefined ? Boolean(rule.apply_in_pos) : info.applyInPos;
    const applyOnline = rule.apply_online !== undefined ? Boolean(rule.apply_online) : info.applyOnline;
    const cleanName = info.cleanName;

    const { name: formattedName, active: formattedActive } = formatDiscountName(
      cleanName,
      applyPos,
      applyOnline
    );

    const payload = {
      name: formattedName,
      scope: rule.scope,
      target_id: rule.target_id ?? null,
      discount_bps: Math.round(Number(rule.discount_bps)),
      active: rule.active !== false && formattedActive,
      starts_at: rule.starts_at || null,
      ends_at: rule.ends_at || null,
    };

    const result = await send('catalog_discounts', { id: rule.id || null, data: payload }, load);
    return Boolean(result);
  }

  // Toggle specific channel (POS or Website) with instant optimistic feedback
  async function handleToggleChannel(rule: Row, channel: 'pos' | 'online') {
    if (togglingId) return;
    const info = parseDiscountChannels(rule.name, rule.active);
    const isCurrentlyActive = rule.active !== false;

    let newPos = isCurrentlyActive ? info.applyInPos : false;
    let newOnline = isCurrentlyActive ? info.applyOnline : false;

    if (channel === 'pos') {
      newPos = !newPos;
    } else {
      newOnline = !newOnline;
    }

    const { name: newName, active: newActive } = formatDiscountName(
      info.cleanName,
      newPos,
      newOnline
    );

    let newEndsAt = rule.ends_at;
    // If turning on when expiry date has passed, offer to clear expiry so it goes live!
    if ((newPos || newOnline) && rule.ends_at && new Date(rule.ends_at).getTime() <= Date.now()) {
      const renew = window.confirm(
        `"${info.cleanName}" expired on ${new Date(rule.ends_at).toLocaleDateString('en-IN')}.\n\nDo you want to clear the expiry date so this discount goes live immediately?`
      );
      if (renew) newEndsAt = null;
    }

    setTogglingId(rule.id);

    // Optimistic UI update for 0ms delay
    const updatedRow = {
      ...rule,
      name: newName,
      active: newActive,
      ends_at: newEndsAt,
    };
    setRules((prev) => prev.map((item) => (item.id === rule.id ? updatedRow : item)));

    try {
      const payload = {
        name: newName,
        scope: rule.scope,
        target_id: rule.target_id ?? null,
        discount_bps: Math.round(Number(rule.discount_bps)),
        active: newActive,
        starts_at: rule.starts_at || null,
        ends_at: newEndsAt || null,
      };

      const result = await send('catalog_discounts', { id: rule.id, data: payload }, load);
      if (!result) {
        // Revert on error
        setRules((prev) => prev.map((item) => (item.id === rule.id ? rule : item)));
      } else {
        notice(`✓ "${info.cleanName}" updated: POS ${newPos ? 'ON' : 'OFF'}, Website ${newOnline ? 'ON' : 'OFF'}`);
      }
    } catch (e) {
      setRules((prev) => prev.map((item) => (item.id === rule.id ? rule : item)));
      notice(`Could not update status: ${(e as Error).message}`);
    } finally {
      setTogglingId(null);
    }
  }

  // Master Toggle (Entire discount On / Off)
  async function handleToggleMaster(rule: Row) {
    if (togglingId) return;
    const info = parseDiscountChannels(rule.name, rule.active);
    const willBeActive = !rule.active;

    let newEndsAt = rule.ends_at;
    if (willBeActive && rule.ends_at && new Date(rule.ends_at).getTime() <= Date.now()) {
      const renew = window.confirm(
        `"${info.cleanName}" expired on ${new Date(rule.ends_at).toLocaleDateString('en-IN')}.\n\nDo you want to clear the expiry date so this discount goes live immediately?`
      );
      if (renew) newEndsAt = null;
    }

    const { name: newName } = formatDiscountName(
      info.cleanName,
      willBeActive ? (info.applyInPos || true) : false,
      willBeActive ? (info.applyOnline || true) : false
    );

    setTogglingId(rule.id);

    const updatedRow = {
      ...rule,
      name: newName,
      active: willBeActive,
      ends_at: newEndsAt,
    };
    setRules((prev) => prev.map((item) => (item.id === rule.id ? updatedRow : item)));

    try {
      const payload = {
        name: newName,
        scope: rule.scope,
        target_id: rule.target_id ?? null,
        discount_bps: Math.round(Number(rule.discount_bps)),
        active: willBeActive,
        starts_at: rule.starts_at || null,
        ends_at: newEndsAt || null,
      };

      const result = await send('catalog_discounts', { id: rule.id, data: payload }, load);
      if (!result) {
        setRules((prev) => prev.map((item) => (item.id === rule.id ? rule : item)));
      }
    } catch (e) {
      setRules((prev) => prev.map((item) => (item.id === rule.id ? rule : item)));
      notice(`Could not toggle: ${(e as Error).message}`);
    } finally {
      setTogglingId(null);
    }
  }

  async function remove(rule: Row) {
    if (!window.confirm(`Remove “${rule.name}”? Prices go back to normal in POS and online.`)) return;
    try {
      const r = await api<Row>(`/api/erp/catalog_discounts?id=${rule.id}`, undefined, 'DELETE');
      notice(r.message || 'Discount removed.');
      await load();
    } catch (e) {
      notice((e as Error).message);
    }
  }

  // ---- builder preview -------------------------------------------------
  const pct = draft ? Number(draft.discount_bps) / 100 : 0;
  const preview = draft ? affected(draft.scope, draft.target_id) : [];
  const targetChoices: Row[] = !draft
    ? []
    : draft.scope === 'category'
      ? mains
      : draft.scope === 'subcategory'
        ? subs
        : draft.scope === 'product'
          ? products
          : [];
  const filteredChoices = targetChoices.filter((c) =>
    `${c.name} ${c.sku || ''} ${c.parent_id ? catName(c.parent_id) : ''}`.toLowerCase().includes(targetSearch.trim().toLowerCase()),
  );
  const draftValid = draft && draft.name.trim() && (draft.scope === 'all' || draft.target_id) && pct > 0 && pct <= 90;

  function setPreset(kind: 'today' | 'weekend' | 'week' | 'none') {
    if (!draft) return;
    const start = new Date();
    let end: Date | null = new Date();
    if (kind === 'today') end.setHours(23, 59, 0, 0);
    else if (kind === 'week') end.setDate(end.getDate() + 7);
    else if (kind === 'weekend') {
      const add = (6 - start.getDay() + 7) % 7;
      start.setDate(start.getDate() + add);
      start.setHours(0, 0, 0, 0);
      end = new Date(start);
      end.setDate(end.getDate() + 1);
      end.setHours(23, 59, 0, 0);
    } else end = null;
    setDraft({ ...draft, starts_at: kind === 'none' ? null : start.toISOString(), ends_at: end ? end.toISOString() : null });
  }

  return (
    <div className="ms-stack">
      <div className="ms-callout">
        <span className="ms-callout-icon" aria-hidden="true">⇄</span>
        <div>
          <strong>Channel-specific discounts.</strong> You can turn discounts on or off separately for POS Billing Counter and Website Online Shop.
          When several rules match a saree, the biggest discount wins. Product pieces always follow their saree&apos;s discount. Extra counter discounts are given in POS billing.
        </div>
      </div>

      <div className="ms-kpis">
        <div className="ms-kpi"><span>Live rules</span><strong>{stats.live}</strong><small>Applying right now</small></div>
        <div className="ms-kpi"><span>Scheduled</span><strong>{stats.scheduled}</strong><small>Start automatically</small></div>
        <div className="ms-kpi"><span>Sarees on discount</span><strong>{stats.discounted}<em>/{products.length}</em></strong><small>Across POS and online</small></div>
        <div className="ms-kpi ms-kpi-accent"><span>Biggest live discount</span><strong>{stats.best}%</strong><small>Highest rule wins</small></div>
      </div>

      {draft ? (
        <section className="ms-card ms-builder">
          <div className="ms-card-head">
            <div>
              <h2>{draft.id ? 'Edit discount' : 'New discount'}</h2>
              <p>Pick what it applies to, set the percentage, and choose when it runs.</p>
            </div>
            <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => setDraft(null)}>Cancel</button>
          </div>

          <div className="ms-builder-grid">
            <div className="ms-stack">
              <label className="ms-field">
                <span>Discount name</span>
                <input
                  value={draft.name}
                  maxLength={120}
                  placeholder="e.g. Deepavali silk sale"
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                />
              </label>

              <div className="ms-field">
                <span>Applies to</span>
                <div className="ms-choice-grid">
                  {SCOPES.map((s) => (
                    <button
                      type="button"
                      key={s.key}
                      className={`ms-choice ${draft.scope === s.key ? 'selected' : ''}`}
                      onClick={() => {
                        setDraft({ ...draft, scope: s.key, target_id: null });
                        setTargetSearch('');
                      }}
                    >
                      <span className="ms-choice-icon" aria-hidden="true">{s.icon}</span>
                      <strong>{s.title}</strong>
                      <small>{s.hint}</small>
                    </button>
                  ))}
                </div>
              </div>

              {draft.scope !== 'all' && (
                <div className="ms-field">
                  <span>
                    Choose {draft.scope === 'product' ? 'saree' : draft.scope}
                    {draft.target_id && <b className="ms-chosen"> · {targetLabel(draft)}</b>}
                  </span>
                  <input
                    type="search"
                    placeholder={draft.scope === 'product' ? 'Search by saree name or SKU…' : 'Search…'}
                    value={targetSearch}
                    onChange={(e) => setTargetSearch(e.target.value)}
                  />
                  <div className="ms-pick-list" role="listbox">
                    {filteredChoices.length === 0 && <p className="ms-muted">Nothing matches.</p>}
                    {filteredChoices.slice(0, 60).map((c) => {
                      const count = affected(draft.scope, c.id).length;
                      return (
                        <button
                          type="button"
                          role="option"
                          aria-selected={draft.target_id === c.id}
                          key={c.id}
                          className={`ms-pick ${draft.target_id === c.id ? 'selected' : ''}`}
                          onClick={() => setDraft({ ...draft, target_id: c.id })}
                        >
                          {c.image_path ? <img src={c.image_path} alt="" /> : <span className="ms-pick-ph" />}
                          <span className="ms-pick-text">
                            <strong>{c.name}</strong>
                            <small>
                              {draft.scope === 'product'
                                ? `${c.sku} · ${money(c.price_paise)} · ${c.pieces?.length || 0} pieces`
                                : draft.scope === 'subcategory'
                                  ? `${catName(c.parent_id)} · ${count} sarees`
                                  : `${count} sarees`}
                            </small>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="ms-field">
                <span>Discount</span>
                <div className="ms-pct-row">
                  <div className="ms-input-affix">
                    <input
                      type="number"
                      min={1}
                      max={90}
                      step={0.5}
                      value={pct || ''}
                      onChange={(e) => setDraft({ ...draft, discount_bps: Math.round(Number(e.target.value) * 100) })}
                    />
                    <em>% off</em>
                  </div>
                  <input
                    type="range"
                    min={1}
                    max={90}
                    step={1}
                    value={pct || 1}
                    className="ms-range"
                    onChange={(e) => setDraft({ ...draft, discount_bps: Number(e.target.value) * 100 })}
                    aria-label="Discount percentage"
                  />
                </div>
                <div className="ms-chips">
                  {QUICK.map((q) => (
                    <button type="button" key={q} className={`ms-chip ${pct === q ? 'on' : ''}`} onClick={() => setDraft({ ...draft, discount_bps: q * 100 })}>
                      {q}%
                    </button>
                  ))}
                </div>
              </div>

              <div className="ms-field">
                <span>When</span>
                <div className="ms-chips">
                  <button type="button" className={`ms-chip ${!draft.starts_at && !draft.ends_at ? 'on' : ''}`} onClick={() => setPreset('none')}>Until I turn it off</button>
                  <button type="button" className="ms-chip" onClick={() => setPreset('today')}>Today only</button>
                  <button type="button" className="ms-chip" onClick={() => setPreset('weekend')}>This weekend</button>
                  <button type="button" className="ms-chip" onClick={() => setPreset('week')}>Next 7 days</button>
                </div>
                <div className="ms-row-2">
                  <label className="ms-field ms-field-inline">
                    <span>Starts</span>
                    <input type="datetime-local" value={toLocalInput(draft.starts_at)} onChange={(e) => setDraft({ ...draft, starts_at: fromLocalInput(e.target.value) })} />
                  </label>
                  <label className="ms-field ms-field-inline">
                    <span>Ends</span>
                    <input type="datetime-local" value={toLocalInput(draft.ends_at)} onChange={(e) => setDraft({ ...draft, ends_at: fromLocalInput(e.target.value) })} />
                  </label>
                </div>
              </div>

              <div className="ms-field">
                <span style={{ fontWeight: 700, color: 'var(--erp-maroon, #800020)' }}>Channels &amp; Availability</span>
                <p style={{ margin: '2px 0 10px', fontSize: 12, color: '#64748B' }}>
                  Turn on for POS billing counter and website independently:
                </p>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }}>
                  {/* POS Counter Channel */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: draft.apply_in_pos ? '1.5px solid #166534' : '1px solid #E2E8F0',
                      background: draft.apply_in_pos ? '#F0FDF4' : '#FFFDF9',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#800020' }}>
                        <span>🛒</span>
                        <span>POS Billing Counter</span>
                      </div>
                      <small style={{ color: '#64748B', fontSize: 11, display: 'block', marginTop: 2 }}>
                        Shop counter cashier register
                      </small>
                    </div>
                    <span className="ms-switch" style={{ margin: 0, pointerEvents: 'none' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(draft.apply_in_pos)}
                        onChange={() => {}}
                      />
                      <span className="ms-switch-track" aria-hidden="true" />
                    </span>
                    <input
                      type="checkbox"
                      style={{ display: 'none' }}
                      checked={Boolean(draft.apply_in_pos)}
                      onChange={(e) => setDraft({ ...draft, apply_in_pos: e.target.checked })}
                    />
                  </label>

                  {/* Website & Online Shop Channel */}
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: draft.apply_online ? '1.5px solid #166534' : '1px solid #E2E8F0',
                      background: draft.apply_online ? '#F0FDF4' : '#FFFDF9',
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, fontSize: 13, color: '#800020' }}>
                        <span>🌐</span>
                        <span>Website &amp; Online Shop</span>
                      </div>
                      <small style={{ color: '#64748B', fontSize: 11, display: 'block', marginTop: 2 }}>
                        Storefront catalogue &amp; checkout
                      </small>
                    </div>
                    <span className="ms-switch" style={{ margin: 0, pointerEvents: 'none' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(draft.apply_online)}
                        onChange={() => {}}
                      />
                      <span className="ms-switch-track" aria-hidden="true" />
                    </span>
                    <input
                      type="checkbox"
                      style={{ display: 'none' }}
                      checked={Boolean(draft.apply_online)}
                      onChange={(e) => setDraft({ ...draft, apply_online: e.target.checked })}
                    />
                  </label>
                </div>
              </div>
            </div>

            <aside className="ms-preview">
              <div className="ms-preview-head">
                <span>Preview</span>
                <strong>{preview.length} {preview.length === 1 ? 'saree' : 'sarees'} affected</strong>
              </div>
              {preview.length === 0 ? (
                <p className="ms-muted">Choose what this discount applies to.</p>
              ) : (
                <ul className="ms-preview-list">
                  {preview.slice(0, 8).map((p) => {
                    const price = Number(p.price_paise);
                    const current = Number(p.effective_price_paise ?? price);
                    const currentPct = price > 0 ? (1 - current / price) * 100 : 0;
                    const finalPct = Math.max(currentPct, pct);
                    const finalPrice = Math.floor(price * (1 - finalPct / 100));
                    return (
                      <li key={p.id}>
                        {p.image_path ? <img src={p.image_path} alt="" /> : <span className="ms-pick-ph" />}
                        <span className="ms-preview-name">
                          <strong>{p.name}</strong>
                          <small>{p.sku}{currentPct > pct ? ' · a bigger discount already applies' : ''}</small>
                        </span>
                        <span className="ms-preview-price">
                          <s>{money(price)}</s>
                          <b>{money(finalPrice)}</b>
                        </span>
                      </li>
                    );
                  })}
                  {preview.length > 8 && <li className="ms-muted">+ {preview.length - 8} more</li>}
                </ul>
              )}
              <button
                type="button"
                className="ms-btn ms-btn-primary ms-btn-block"
                disabled={!draftValid || busy}
                onClick={async () => {
                  if (draft && (await save(draft))) setDraft(null);
                }}
              >
                {busy ? 'Saving…' : draft.id ? 'Save changes' : `Create ${pct || 0}% discount`}
              </button>
            </aside>
          </div>
        </section>
      ) : null}

      <section className="ms-card">
        <div className="ms-card-head">
          <div>
            <h2>Discount rules</h2>
            <p>Turn rules on or off without deleting them.</p>
          </div>
          <div className="ms-head-tools">
            <div className="ms-seg" role="tablist">
              {(['all', 'live', 'scheduled', 'off'] as const).map((f) => (
                <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'on' : ''} onClick={() => setFilter(f)}>
                  {f === 'all' ? 'All' : f === 'live' ? 'Live' : f === 'scheduled' ? 'Scheduled' : 'Off / ended'}
                </button>
              ))}
            </div>
            {!draft && (
              <button type="button" className="ms-btn ms-btn-primary" onClick={() => setDraft(emptyDraft())}>
                + New discount
              </button>
            )}
          </div>
        </div>

        {loading ? (
          <div className="ms-skeleton-list"><span /><span /><span /></div>
        ) : visible.length === 0 ? (
          <div className="ms-empty">
            <span aria-hidden="true">%</span>
            <h3>No discounts here yet</h3>
            <p>Create one to reduce prices in the shop and online at the same time.</p>
            {!draft && <button type="button" className="ms-btn ms-btn-primary" onClick={() => setDraft(emptyDraft())}>+ New discount</button>}
          </div>
        ) : (
          <div className="ms-rule-list">
            {visible.map((r) => {
              const st = ruleStatus(r, now);
              const count = affected(r.scope, r.target_id).length;
              const info = parseDiscountChannels(r.name, r.active);
              const isPosOn = Boolean(r.active && info.applyInPos);
              const isOnlineOn = Boolean(r.active && info.applyOnline);
              const isToggling = togglingId === r.id;

              return (
                <article key={r.id} className={`ms-rule ms-rule-${st.key}`}>
                  <div className="ms-rule-pct">{Number(r.discount_bps) / 100}<small>% off</small></div>
                  <div className="ms-rule-body">
                    <div className="ms-rule-title" style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <strong>{info.cleanName}</strong>
                      <span className={`ms-badge ms-badge-${st.key}`}>{st.label}</span>
                      {isPosOn && isOnlineOn ? (
                        <span className="ms-badge" style={{ background: '#EFF6FF', color: '#1D4ED8', border: '1px solid #BFDBFE' }}>
                          🛒 POS + 🌐 Online
                        </span>
                      ) : isPosOn ? (
                        <span className="ms-badge" style={{ background: '#FEF3C7', color: '#92400E', border: '1px solid #FDE68A' }}>
                          🛒 POS only
                        </span>
                      ) : isOnlineOn ? (
                        <span className="ms-badge" style={{ background: '#F5F3FF', color: '#6D28D9', border: '1px solid #DDD6FE' }}>
                          🌐 Website only
                        </span>
                      ) : (
                        <span className="ms-badge" style={{ background: '#F1F5F9', color: '#64748B', border: '1px solid #CBD5E1' }}>
                          ✕ Inactive
                        </span>
                      )}
                    </div>
                    <p>
                      <span className="ms-scope-tag">{SCOPES.find((s) => s.key === r.scope)?.title}</span>
                      {r.scope !== 'all' && <> {targetLabel(r)}</>} · {count} sarees
                    </p>
                    <small className="ms-muted">
                      {r.starts_at ? `From ${new Date(r.starts_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Starts immediately'}
                      {' · '}
                      {r.ends_at ? `until ${new Date(r.ends_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}` : 'no end date'}
                    </small>
                  </div>
                  <div className="ms-rule-actions" style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                    {/* Separate POS Toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isPosOn}
                      disabled={isToggling || busy}
                      onClick={() => void handleToggleChannel(r, 'pos')}
                      title={`Click to turn ${isPosOn ? 'OFF' : 'ON'} POS billing counter discount`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: isToggling ? 'wait' : 'pointer',
                        border: isPosOn ? '1.5px solid #166534' : '1px solid #CBD5E1',
                        background: isPosOn ? '#DCFCE7' : '#F8FAFC',
                        color: isPosOn ? '#14532D' : '#64748B',
                        transition: 'all 0.15s ease',
                        boxShadow: isPosOn ? '0 1px 2px rgba(22, 101, 52, 0.15)' : 'none',
                      }}
                    >
                      <span>🛒 POS</span>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: isPosOn ? '#16A34A' : '#94A3B8',
                        }}
                      />
                      <span style={{ fontSize: 11, letterSpacing: '0.02em' }}>{isPosOn ? 'ON' : 'OFF'}</span>
                    </button>

                    {/* Separate Website Toggle */}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={isOnlineOn}
                      disabled={isToggling || busy}
                      onClick={() => void handleToggleChannel(r, 'online')}
                      title={`Click to turn ${isOnlineOn ? 'OFF' : 'ON'} website online shop discount`}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        borderRadius: 20,
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: isToggling ? 'wait' : 'pointer',
                        border: isOnlineOn ? '1.5px solid #166534' : '1px solid #CBD5E1',
                        background: isOnlineOn ? '#DCFCE7' : '#F8FAFC',
                        color: isOnlineOn ? '#14532D' : '#64748B',
                        transition: 'all 0.15s ease',
                        boxShadow: isOnlineOn ? '0 1px 2px rgba(22, 101, 52, 0.15)' : 'none',
                      }}
                    >
                      <span>🌐 Web</span>
                      <span
                        style={{
                          display: 'inline-block',
                          width: 8,
                          height: 8,
                          borderRadius: '50%',
                          background: isOnlineOn ? '#16A34A' : '#94A3B8',
                        }}
                      />
                      <span style={{ fontSize: 11, letterSpacing: '0.02em' }}>{isOnlineOn ? 'ON' : 'OFF'}</span>
                    </button>

                    <button
                      type="button"
                      className="ms-btn ms-btn-ghost ms-btn-sm"
                      onClick={() => {
                        setDraft({
                          id: r.id,
                          name: info.cleanName,
                          scope: r.scope,
                          target_id: r.target_id ?? null,
                          discount_bps: r.discount_bps,
                          active: r.active,
                          apply_in_pos: info.applyInPos,
                          apply_online: info.applyOnline,
                          starts_at: r.starts_at,
                          ends_at: r.ends_at,
                        });
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="ms-btn ms-btn-ghost ms-btn-sm"
                      onClick={() =>
                        setDraft({
                          id: null,
                          name: `${info.cleanName} (copy)`,
                          scope: r.scope,
                          target_id: r.target_id ?? null,
                          discount_bps: r.discount_bps,
                          active: false,
                          apply_in_pos: info.applyInPos,
                          apply_online: info.applyOnline,
                          starts_at: r.starts_at,
                          ends_at: r.ends_at,
                        })
                      }
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      className="ms-btn ms-btn-danger-ghost ms-btn-sm"
                      onClick={() => void remove(r)}
                    >
                      Delete
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
