"use client";
import React, { useEffect, useRef, useState } from "react";
import { api } from "../api";
import { compressImage, validateImageFile } from "@/lib/image-compress";
import { ColourStock } from "@/lib/core";

/**
 * Colour stock of ONE individual saree (one barcode, one price).
 * Total pieces = coloured pieces + undefined pieces. A colour is sold online only when it has a photo.
 */
export const COLOUR_PRESETS: { name: string; hex: string }[] = [
  { name: "Red", hex: "#C62828" }, { name: "Maroon", hex: "#800020" }, { name: "Wine", hex: "#650019" },
  { name: "Pink", hex: "#DB2777" }, { name: "Magenta", hex: "#A21CAF" }, { name: "Violet", hex: "#7C3AED" },
  { name: "Purple", hex: "#6B21A8" }, { name: "Blue", hex: "#1D4ED8" }, { name: "Navy", hex: "#1E3A8A" },
  { name: "Teal", hex: "#0F766E" }, { name: "Green", hex: "#2E7D32" }, { name: "Bottle Green", hex: "#14532D" },
  { name: "Yellow", hex: "#CA8A04" }, { name: "Mustard", hex: "#B7791F" }, { name: "Orange", hex: "#EA580C" },
  { name: "Gold", hex: "#C49A52" }, { name: "Beige", hex: "#D4A373" }, { name: "Cream", hex: "#F1E4C8" },
  { name: "White", hex: "#F8F8F2" }, { name: "Black", hex: "#111111" }, { name: "Grey", hex: "#6B7280" },
];
export const presetHex = (name: string) =>
  COLOUR_PRESETS.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())?.hex || "";

type Row = { key: string; id?: string; colour: string; colour_hex: string; quantity: string; image_path: string; reserved: number; uploading?: boolean };

const toRow = (c: ColourStock): Row => ({
  key: c.id, id: c.id, colour: c.colour, colour_hex: c.colour_hex, quantity: String(c.quantity), image_path: c.image_path, reserved: c.reserved,
});

async function upload(file: File): Promise<string> {
  if (!validateImageFile(file).valid) throw new Error("Choose a JPG, PNG or WebP photo.");
  const compressed = await compressImage(file, { maxSizeKB: 60, minSizeKB: 1, maxWidth: 1200, maxHeight: 1200, preferFormat: "image/webp" });
  const form = new FormData();
  form.append("kind", "product");
  form.append("file", compressed.file);
  const data = await api<{ url: string }>("/api/uploads", undefined, form);
  return String(data.url);
}

export function ColourStockEditor({
  productId,
  onSaved,
  notice,
  compact = false,
}: {
  productId: string;
  onSaved?: () => void;
  notice?: (m: string) => void;
  compact?: boolean;
}) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState("0");
  const [stockLoaded, setStockLoaded] = useState(0);
  const [reserved, setReserved] = useState(0);
  const [legacy, setLegacy] = useState<{ colour: string; quantity: number; image_path: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const uploadFor = useRef<string | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const r = await api<{ product: { stock_on_hand: number; reserved: number }; colours: ColourStock[]; legacy: typeof legacy }>(
        `/api/admin/colours?product_id=${productId}`,
      );
      setRows(r.colours.map(toRow));
      setTotal(String(r.product.stock_on_hand));
      setStockLoaded(r.product.stock_on_hand);
      setReserved(r.product.reserved);
      setLegacy(r.legacy || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const totalNum = Math.max(0, parseInt(total, 10) || 0);
  const coloured = rows.reduce((s, r) => s + (parseInt(r.quantity, 10) || 0), 0);
  const undef = totalNum - coloured;
  const online = rows.filter((r) => r.image_path && (parseInt(r.quantity, 10) || 0) > 0).length;

  const patch = (key: string, p: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...p } : r)));
  function addColour(name = "", hex = "") {
    if (name && rows.some((r) => r.colour.trim().toLowerCase() === name.toLowerCase())) {
      setError(`${name} is already listed.`);
      return;
    }
    setError("");
    setRows((rs) => [...rs, { key: `new-${Date.now()}-${rs.length}`, colour: name, colour_hex: hex || presetHex(name), quantity: String(Math.max(0, undef > 0 ? Math.min(1, undef) : 0)), image_path: "", reserved: 0 }]);
  }

  async function onFile(file: File) {
    const key = uploadFor.current;
    if (!key) return;
    patch(key, { uploading: true });
    try {
      patch(key, { image_path: await upload(file), uploading: false });
    } catch (e) {
      patch(key, { uploading: false });
      setError((e as Error).message);
    }
  }

  async function save() {
    setError("");
    if (undef < 0) {
      setError(`Colours add up to ${coloured} pieces but the saree has ${totalNum}. Increase total pieces or reduce a colour.`);
      return;
    }
    if (rows.some((r) => !r.colour.trim())) {
      setError("Give every colour row a name, or delete it.");
      return;
    }
    setSaving(true);
    try {
      await api("/api/admin/colours", {
        product_id: productId,
        rows: rows.map((r, i) => ({
          id: r.id || null,
          colour: r.colour.trim(),
          colour_hex: /^#[0-9A-Fa-f]{6}$/.test(r.colour_hex) ? r.colour_hex : "",
          quantity: parseInt(r.quantity, 10) || 0,
          image_path: r.image_path,
          sort_order: i,
        })),
        total: totalNum !== stockLoaded ? totalNum : null,
        reason: "Colour stock edit",
      });
      notice?.("Colour stock saved. POS and website now use these counts.");
      await load();
      onSaved?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <p className="cs-help">Loading colour stock…</p>;

  return (
    <div className="cs-panel">
      <input
        ref={fileRef}
        type="file"
        accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
      <div className="cs-summary">
        <span className="cs-pill">Total pieces: {totalNum}</span>
        <span className="cs-pill ok">Coloured: {coloured}</span>
        <span className={`cs-pill ${undef > 0 ? "warn" : undef < 0 ? "" : "muted"}`}>Undefined: {undef}</span>
        <span className={`cs-pill ${online ? "ok" : "muted"}`}>{online ? `${online} colour${online === 1 ? "" : "s"} on website` : "Not on website yet"}</span>
        {reserved > 0 && <span className="cs-pill warn">Held by online orders: {reserved}</span>}
      </div>
      {!compact && (
        <p className="cs-help">
          One barcode and one price for this saree. Split its pieces by colour when you know them; pieces without a colour stay
          <b> undefined</b> and can still be billed at the POS. A colour appears on the website only after it has a photo.
        </p>
      )}
      <div className="cs-total">
        <label>
          Total pieces in shop
          <input type="number" min={reserved} value={total} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => setTotal(e.target.value)} />
        </label>
        {totalNum !== stockLoaded && (
          <span className="cs-help">Stock will change by {totalNum - stockLoaded > 0 ? "+" : ""}{totalNum - stockLoaded} (logged as a stock adjustment).</span>
        )}
      </div>

      <table className="cs-table">
        <thead>
          <tr>
            <th style={{ width: 44 }}>Shade</th>
            <th>Colour</th>
            <th style={{ width: 100 }}>Pieces</th>
            <th>Photo</th>
            <th style={{ width: 110 }}>Website</th>
            <th style={{ width: 40 }} />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const q = parseInt(r.quantity, 10) || 0;
            return (
              <tr key={r.key}>
                <td>
                  <input type="color" value={/^#[0-9A-Fa-f]{6}$/.test(r.colour_hex) ? r.colour_hex : "#cccccc"} onChange={(e) => patch(r.key, { colour_hex: e.target.value })} aria-label="Shade" />
                </td>
                <td>
                  <input type="text" value={r.colour} placeholder="e.g. Violet" list="cs-colour-names" maxLength={50}
                    onChange={(e) => patch(r.key, { colour: e.target.value, colour_hex: r.colour_hex || presetHex(e.target.value) })} />
                </td>
                <td>
                  <input type="number" min={r.reserved} value={r.quantity} onWheel={(e) => e.currentTarget.blur()} onChange={(e) => patch(r.key, { quantity: e.target.value })} aria-label={`${r.colour} pieces`} />
                  {r.reserved > 0 && <div className="cs-help">{r.reserved} held online</div>}
                </td>
                <td>
                  <div className="cs-photo">
                    {r.image_path ? <img src={r.image_path} alt={r.colour} /> : <span className="cs-photo-empty">No photo</span>}
                    <button type="button" className="button outline-btn" style={{ fontSize: 12, padding: "4px 10px" }} disabled={r.uploading}
                      onClick={() => { uploadFor.current = r.key; fileRef.current?.click(); }}>
                      {r.uploading ? "Uploading…" : r.image_path ? "Change" : "Add photo"}
                    </button>
                    {r.image_path && (
                      <button type="button" className="button outline-btn" style={{ fontSize: 12, padding: "4px 8px" }} onClick={() => patch(r.key, { image_path: "" })} title="Remove photo (hides this colour online)">✕</button>
                    )}
                  </div>
                </td>
                <td>
                  <span className={`cs-status ${r.image_path && q > 0 ? "on" : "off"}`}>{r.image_path ? (q > 0 ? "Visible" : "Sold out") : "Needs photo"}</span>
                </td>
                <td>
                  <button type="button" className="ap-variant-del-btn" disabled={r.reserved > 0} title={r.reserved > 0 ? "Held by an online order" : "Remove colour (pieces become undefined)"}
                    onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} aria-label={`Remove ${r.colour}`}>✕</button>
                </td>
              </tr>
            );
          })}
          <tr className="cs-row-undefined">
            <td />
            <td>Undefined (colour not recorded)</td>
            <td style={{ textAlign: "center" }}>{undef}</td>
            <td colSpan={3}>{undef > 0 ? "POS only — set a colour to sell online" : undef < 0 ? "Colours exceed total pieces" : "All pieces have a colour"}</td>
          </tr>
        </tbody>
      </table>
      <datalist id="cs-colour-names">{COLOUR_PRESETS.map((c) => <option key={c.name} value={c.name} />)}</datalist>

      <div className="cs-presets">
        {COLOUR_PRESETS.filter((c) => !rows.some((r) => r.colour.trim().toLowerCase() === c.name.toLowerCase())).slice(0, 14).map((c) => (
          <button key={c.name} type="button" onClick={() => addColour(c.name, c.hex)}><i style={{ background: c.hex }} />{c.name}</button>
        ))}
        <button type="button" onClick={() => addColour()}>＋ Other colour</button>
      </div>

      {legacy.length > 0 && rows.length === 0 && (
        <div className="cs-help" style={{ background: "#FFFBEB", padding: 10, borderRadius: 8 }}>
          Found an older piece list: {legacy.map((l) => `${l.colour} × ${l.quantity}`).join(", ")}.{" "}
          <button type="button" className="button outline-btn" style={{ fontSize: 12, padding: "3px 10px" }}
            onClick={() => setRows(legacy.map((l, i) => ({ key: `legacy-${i}`, colour: l.colour, colour_hex: presetHex(l.colour), quantity: String(l.quantity), image_path: l.image_path, reserved: 0 })))}>
            Use it
          </button>
        </div>
      )}

      {error && <div className="ap-error-banner" role="alert"><span>⚠️ {error}</span></div>}
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
        <button type="button" className="button outline-btn" disabled={saving} onClick={() => void load()}>Reset</button>
        <button type="button" className="button" disabled={saving || rows.some((r) => r.uploading)} onClick={() => void save()}>
          {saving ? "Saving…" : "Save colour stock"}
        </button>
      </div>
    </div>
  );
}
