'use client';
import React, { useEffect, useState } from 'react';
import { code128Barcode } from '@/lib/barcode';
import { money } from '@/lib/core';
import { api } from '../api';
import { References, Row, useERP } from './shared';

type PrintableLabel = {
  key: string;
  unitId?: string;
  barcode: string;
  name: string;
  sku: string;
  pricePaise: number;
  isMsu: boolean;
  printedAt?: string | null;
};

export function Labels({ refs }: { refs: References }) {
  const [product, setProduct] = useState('');
  const [purchase, setPurchase] = useState('');
  const [quantity, setQuantity] = useState('');
  const [after, setAfter] = useState(0);
  const [next, setNext] = useState<number | null>(null);
  const [rows, setRows] = useState<PrintableLabel[]>([]);
  const [loadedOnce, setLoadedOnce] = useState(false);
  const [loading, setLoading] = useState(false);
  const [paper, setPaper] = useState<'a4' | 'roll'>('a4');
  const [width, setWidth] = useState(90);
  const [height, setHeight] = useState(35);
  const { busy, send, notice } = useERP();

  const products = refs.products || [];

  useEffect(() => {
    const pur = new URLSearchParams(window.location.search).get('purchase_id') || '';
    setPurchase(pur);
    void load(0, '', pur);
  }, []);

  async function load(cursor = 0, prodId = product, purId = purchase) {
    setLoading(true);
    try {
      const clampedQty = Math.min(500, Math.max(1, Math.round(Number(quantity) || 20)));
      const r = await api<Row>(
        `/api/erp/labels?quantity=${clampedQty}&after=${cursor}${
          prodId ? `&product_id=${prodId}` : ''
        }${purId ? `&purchase_id=${purId}` : ''}`,
      );
      const unitRows = (r.rows || []) as Row[];
      if (unitRows.length > 0) {
        const msuLabels: PrintableLabel[] = unitRows.map((u) => ({
          key: `u-${u.id}`,
          unitId: String(u.id),
          barcode: String(u.barcode),
          name: String(u.products?.name || 'Saree'),
          sku: String(u.products?.sku || ''),
          pricePaise: Number(u.products?.price_paise || 0),
          isMsu: true,
          printedAt: u.printed_at || null,
        }));
        const explicitCount = quantity.trim() !== '' ? clampedQty : 0;
        if (prodId && explicitCount > msuLabels.length) {
          const chosen = products.find((p) => p.id === prodId);
          if (chosen) {
            const code = String(chosen.barcode || chosen.sku || 'MS-001');
            const extraCount = explicitCount - msuLabels.length;
            const extraLabels: PrintableLabel[] = Array.from({ length: extraCount }, (_, idx) => ({
              key: `sku-${chosen.id}-${idx}`,
              barcode: code,
              name: String(chosen.name || 'Saree'),
              sku: String(chosen.sku || ''),
              pricePaise: Number(chosen.price_paise || 0),
              isMsu: false,
            }));
            msuLabels.push(...extraLabels);
          }
        }
        setRows(msuLabels);
        setAfter(cursor);
        setNext(r.nextAfter);
      } else if (prodId) {
        // Fallback: generate printable Code 39 SKU barcode stickers for the selected saree
        const chosen = products.find((p) => p.id === prodId);
        if (chosen) {
          const code = String(chosen.barcode || chosen.sku || 'MS-001');
          const count = Math.min(100, Math.max(1, clampedQty));
          const generated: PrintableLabel[] = Array.from({ length: count }, (_, idx) => ({
            key: `sku-${chosen.id}-${idx}`,
            barcode: code,
            name: String(chosen.name || 'Saree'),
            sku: String(chosen.sku || ''),
            pricePaise: Number(chosen.price_paise || 0),
            isMsu: false,
          }));
          setRows(generated);
          setAfter(0);
          setNext(null);
        } else {
          setRows([]);
          setAfter(0);
          setNext(null);
        }
      } else {
        setRows([]);
        setAfter(0);
        setNext(null);
      }
      setLoadedOnce(true);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function handlePrint() {
    if (!rows.length) {
      notice('Click "Load stock labels" first to generate stickers to print.');
      return;
    }
    const msuIds = rows.filter((r) => r.isMsu && r.unitId).map((r) => r.unitId!);
    if (msuIds.length > 0) {
      const ok = await send('labels', { ids: msuIds });
      if (!ok) return;
    }
    window.print();
  }

  const msuCount = rows.filter((r) => r.isMsu).length;
  const previouslyPrinted = rows.filter((r) => r.printedAt).length;

  return (
    <div className="erp-print-host sp-root">
      <form
        className="form-panel"
        onSubmit={(e) => {
          e.preventDefault();
          void load(0);
        }}
      >
        <h2 style={{ marginBottom: 6 }}>Print Stock &amp; Barcode Stickers.</h2>
        <p style={{ color: 'var(--erp-text-muted)', marginBottom: 18 }}>
          Each physical piece added to stock receives a unique MSU barcode. If a saree has no MSU stickers yet, selecting it prepares scannable SKU barcode stickers ready to print.
        </p>

        <div className="form-grid">
          <label>
            Product
            <select
              value={product}
              onChange={(e) => {
                const val = e.target.value;
                setProduct(val);
                void load(0, val, purchase);
              }}
            >
              <option value="">All products (in-stock MSU stickers)</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.sku} · {p.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Purchase ID (optional)
            <input
              value={purchase}
              onChange={(e) => setPurchase(e.target.value)}
              placeholder="Leave blank for all"
            />
          </label>
          <label>
            Stickers in this batch (maximum 500)
            <input
              type="number"
              min={1}
              max={500}
              placeholder="0"
              value={quantity}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setQuantity('');
                  return;
                }
                const num = Number(raw);
                if (!Number.isNaN(num)) {
                  setQuantity(String(Math.max(0, Math.min(500, Math.floor(num)))));
                }
              }}
            />
          </label>
          <label>
            Paper
            <select
              value={paper}
              onChange={(e) => {
                const nextPaper = e.target.value === 'roll' ? 'roll' : 'a4';
                setPaper(nextPaper);
                setWidth(nextPaper === 'roll' ? 80 : 90);
              }}
            >
              <option value="a4">A4 sticker sheet · 2 columns</option>
              <option value="roll">Single-label roll</option>
            </select>
          </label>
          <label>
            Sticker width (mm, 80–95)
            <input
              type="number"
              min={80}
              max={95}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
          </label>
          <label>
            Sticker height (mm, 30–60)
            <input
              type="number"
              min={30}
              max={60}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
            />
          </label>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 18 }}>
          <button type="submit" className="button" disabled={busy || loading}>
            {loading ? 'Loading Stickers…' : 'Load Stock Labels'}
          </button>
          <button
            type="button"
            className="button gold-btn"
            disabled={busy || loading || rows.length === 0}
            onClick={() => void handlePrint()}
          >
            🖨 Print Labels{rows.length > 0 ? ` (${rows.length})` : ''}
          </button>
        </div>

        <p className="subtle" style={{ marginTop: 12 }}>
          Enable Code 39 on your barcode scanner. Print at 100% scale with quiet margins. Test one label on your printer before printing a full batch.
        </p>
      </form>

      {/* Preview Toolbar */}
      {rows.length > 0 ? (
        <div className="form-panel" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <strong style={{ color: 'var(--erp-maroon)' }}>
              {msuCount > 0
                ? `${rows.length} unique MSU stock stickers ready to print.`
                : `${rows.length} SKU barcode stickers ready to print.`}
            </strong>
            {previouslyPrinted > 0 && (
              <span style={{ display: 'block', fontSize: 12, color: 'var(--erp-text-muted)' }}>
                {previouslyPrinted} sticker{previouslyPrinted === 1 ? '' : 's'} had a previous print request.
              </span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              className="button gold-btn"
              disabled={busy}
              onClick={() => void handlePrint()}
            >
              🖨 Print {rows.length} Labels
            </button>
            <button
              type="button"
              className="button outline-btn mini-btn"
              onClick={() => void load(after)}
            >
              ↻ Refresh Batch
            </button>
            {next !== null && (
              <button
                type="button"
                className="button outline-btn mini-btn"
                onClick={() => void load(next)}
              >
                Next Batch →
              </button>
            )}
            {after > 0 && (
              <button
                type="button"
                className="button outline-btn mini-btn"
                onClick={() => void load(0)}
              >
                ← First Batch
              </button>
            )}
          </div>
        </div>
      ) : loadedOnce && !loading ? (
        <div className="sp-empty-card">
          <h3>No stock stickers loaded</h3>
          <p>
            Select a specific saree from the <strong>Product</strong> dropdown above and click <strong>Load Stock Labels</strong> to generate printable SKU barcode stickers, or receive stock in Purchases to generate unique MSU unit stickers.
          </p>
        </div>
      ) : null}

      {/* Printable Barcode Sticker Sheet */}
      {rows.length > 0 && (
        <div
          className={`erp-print labels-sheet ${paper === 'roll' ? 'label-roll' : ''}`}
          style={{
            gridTemplateColumns: `repeat(${paper === 'roll' ? 1 : 2}, ${width}mm)`,
          }}
        >
          <style>{`@media print{@page{size:${
            paper === 'roll' ? `${width}mm ${height}mm` : 'A4'
          };margin:${paper === 'roll' ? '0' : '10mm'};}}`}</style>
          {rows.map((r) => {
            // Code 128: standard retail symbology, compact enough for small thermal labels
            const b = code128Barcode(r.barcode);
            return (
              <article
                className="stock-sticker"
                key={r.key}
                style={{ width: `${width}mm`, height: `${height}mm` }}
              >
                <b>{r.name}</b>
                <small>
                  {r.sku} · {money(r.pricePaise)}
                </small>
                <svg
                  viewBox={`0 0 ${b.width} 46`}
                  role="img"
                  aria-label={`Barcode ${r.barcode}`}
                  preserveAspectRatio="none"
                  shapeRendering="crispEdges"
                >
                  <rect width={b.width} height={46} fill="white" />
                  {b.bars.map((bar, i) => (
                    <rect
                      key={i}
                      x={bar.x}
                      y={2}
                      width={bar.width}
                      height={42}
                      fill="black"
                    />
                  ))}
                </svg>
                <span>{r.barcode}</span>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
