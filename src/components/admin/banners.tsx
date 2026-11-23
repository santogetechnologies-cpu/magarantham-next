"use client";
import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { useShop } from "../shop-context";
import { ImageUploader } from "./image-uploader";
import { BannerCard, bannerPlacements, StoreBanner } from "../banner-slot";

type Row = Record<string, any>;

const empty = (): Row => ({
  id: null,
  title: "",
  subtitle: "",
  image_path: "",
  mobile_image_path: "",
  button_label: "Shop now",
  link_path: "/shop",
  position: "home_hero",
  category_id: null,
  text_align: "left",
  show_text: true,
  theme: "dark",
  sort_order: 0,
  published: true,
  starts_at: null,
  ends_at: null,
});

const FIELDS = ["title", "subtitle", "image_path", "mobile_image_path", "button_label", "link_path", "position", "category_id", "text_align", "show_text", "theme", "sort_order", "published", "starts_at", "ends_at"];

function toLocal(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function status(b: Row, now: number) {
  if (!b.published) return { key: "off", label: "Hidden" };
  if (b.starts_at && Date.parse(b.starts_at) > now) return { key: "scheduled", label: "Scheduled" };
  if (b.ends_at && Date.parse(b.ends_at) <= now) return { key: "expired", label: "Ended" };
  return { key: "live", label: "Live" };
}

export function BannersManager() {
  const { notice } = useShop();
  const [rows, setRows] = useState<Row[]>([]);
  const [cats, setCats] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<Row | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  async function load() {
    try {
      const r = await api<Row>("/api/admin/banners?page=0");
      setRows(r.rows || []);
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
    api<Row>("/api/erp/reference")
      .then((r) => setCats(r.categories || []))
      .catch(() => setCats([]));
  }, []);

  async function save(b: Row) {
    setBusy(true);
    try {
      const data = Object.fromEntries(FIELDS.map((k) => [k, b[k] ?? (k === "category_id" || k.endsWith("_at") ? null : "")]));
      data.sort_order = Number(data.sort_order || 0);
      if (data.position !== "category") data.category_id = null;
      const r = await api<Row>("/api/admin/banners", { id: b.id || null, data });
      notice(r.message || "Banner saved.");
      await load();
      return true;
    } catch (e) {
      notice((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function remove(b: Row) {
    if (!window.confirm(`Delete the banner “${b.title}”?`)) return;
    try {
      await api(`/api/admin/banners?id=${b.id}`, undefined, "DELETE");
      notice("Banner deleted.");
      await load();
    } catch (e) {
      notice((e as Error).message);
    }
  }

  async function move(b: Row, dir: -1 | 1) {
    const peers = rows.filter((r) => r.position === b.position).sort((a, c) => a.sort_order - c.sort_order);
    const i = peers.findIndex((r) => r.id === b.id);
    if (!peers[i + dir]) return;
    [peers[i], peers[i + dir]] = [peers[i + dir], peers[i]];
    for (const [order, r] of peers.entries()) {
      if (Number(r.sort_order) !== order) await save({ ...r, sort_order: order });
    }
  }

  const now = Date.now();
  const grouped = useMemo(
    () =>
      bannerPlacements.map((p) => ({
        ...p,
        items: rows.filter((r) => r.position === p.key).sort((a, b) => a.sort_order - b.sort_order),
      })),
    [rows],
  );
  const live = rows.filter((r) => status(r, now).key === "live").length;
  const valid = draft && draft.title.trim() && draft.image_path && /^\/(?!\/)/.test(draft.link_path || "/");
  const mainCats = cats.filter((c) => !c.parent_id);

  return (
    <div className="ms-stack">
      <div className="ms-kpis">
        <div className="ms-kpi"><span>Live banners</span><strong>{live}</strong><small>Showing on the website now</small></div>
        <div className="ms-kpi"><span>Total banners</span><strong>{rows.length}</strong><small>Including hidden and scheduled</small></div>
        <div className="ms-kpi"><span>Placements used</span><strong>{grouped.filter((g) => g.items.length).length}<em>/{bannerPlacements.length}</em></strong><small>Home, shop and category pages</small></div>
      </div>

      {draft && (
        <section className="ms-card ms-builder">
          <div className="ms-card-head">
            <div>
              <h2>{draft.id ? "Edit banner" : "New offer banner"}</h2>
              <p>Upload a wide image for computers and a tall one for phones. Each screen gets its own crop.</p>
            </div>
            <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => setDraft(null)}>Cancel</button>
          </div>

          <div className="ms-builder-grid">
            <div className="ms-stack">
              <div className="ms-row-2">
                <div className="ms-upload-box">
                  <ImageUploader
                    kind="media"
                    label="Desktop image · 1920 × 640 (3:1)"
                    currentImageUrl={draft.image_path}
                    maxWidth={1920}
                    maxHeight={1080}
                    maxSizeKB={350}
                    onUploadComplete={(url) => setDraft((d) => (d ? { ...d, image_path: url } : d))}
                  />
                </div>
                <div className="ms-upload-box">
                  <ImageUploader
                    kind="media"
                    label="Mobile image · 1080 × 1350 (4:5)"
                    currentImageUrl={draft.mobile_image_path}
                    maxWidth={1080}
                    maxHeight={1350}
                    maxSizeKB={250}
                    onUploadComplete={(url) => setDraft((d) => (d ? { ...d, mobile_image_path: url } : d))}
                  />
                  <small className="ms-muted">Optional. Without it, phones use the desktop image.</small>
                </div>
              </div>

              <label className="ms-field">
                <span>Headline</span>
                <input value={draft.title} maxLength={120} placeholder="e.g. Deepavali Silk Festival · Up to 30% off" onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
              </label>
              <label className="ms-field">
                <span>Short text (optional)</span>
                <input value={draft.subtitle} maxLength={300} placeholder="e.g. Kanchipuram and soft silks, this week only" onChange={(e) => setDraft({ ...draft, subtitle: e.target.value })} />
              </label>
              <div className="ms-row-2">
                <label className="ms-field">
                  <span>Button text</span>
                  <input value={draft.button_label} maxLength={40} onChange={(e) => setDraft({ ...draft, button_label: e.target.value })} />
                </label>
                <label className="ms-field">
                  <span>Opens page</span>
                  <select value={draft.link_path} onChange={(e) => setDraft({ ...draft, link_path: e.target.value })}>
                    <option value="/shop">All sarees</option>
                    {mainCats.map((c) => (
                      <option key={c.id} value={`/category/${c.slug}`}>Category · {c.name}</option>
                    ))}
                    {!["/shop", ...mainCats.map((c) => `/category/${c.slug}`)].includes(draft.link_path) && (
                      <option value={draft.link_path}>{draft.link_path}</option>
                    )}
                  </select>
                </label>
              </div>

              <div className="ms-field">
                <span>Where it shows</span>
                <div className="ms-choice-grid ms-choice-grid-5">
                  {bannerPlacements.map((p) => (
                    <button
                      type="button"
                      key={p.key}
                      className={`ms-choice ${draft.position === p.key ? "selected" : ""}`}
                      onClick={() => setDraft({ ...draft, position: p.key })}
                    >
                      <span className={`ms-place-diagram ms-place-${p.key}`} aria-hidden="true"><i /></span>
                      <strong>{p.label}</strong>
                      <small>{p.hint}</small>
                    </button>
                  ))}
                </div>
              </div>

              {draft.position === "category" && (
                <label className="ms-field">
                  <span>Category page</span>
                  <select value={draft.category_id || ""} onChange={(e) => setDraft({ ...draft, category_id: e.target.value || null })}>
                    <option value="">Every category page</option>
                    {cats.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.parent_id ? `${mainCats.find((m) => m.id === c.parent_id)?.name || ""} › ` : ""}
                        {c.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              <div className="ms-row-2">
                <div className="ms-field">
                  <span>Text position</span>
                  <div className="ms-seg">
                    {(["left", "center", "right"] as const).map((a) => (
                      <button type="button" key={a} className={draft.text_align === a ? "on" : ""} onClick={() => setDraft({ ...draft, text_align: a })}>
                        {a[0].toUpperCase() + a.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="ms-field">
                  <span>Text colour</span>
                  <div className="ms-seg">
                    <button type="button" className={draft.theme === "dark" ? "on" : ""} onClick={() => setDraft({ ...draft, theme: "dark" })}>White on image</button>
                    <button type="button" className={draft.theme === "light" ? "on" : ""} onClick={() => setDraft({ ...draft, theme: "light" })}>Dark on image</button>
                  </div>
                </div>
              </div>

              <div className="ms-row-2">
                <label className="ms-field">
                  <span>Show from (optional)</span>
                  <input type="datetime-local" value={toLocal(draft.starts_at)} onChange={(e) => setDraft({ ...draft, starts_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </label>
                <label className="ms-field">
                  <span>Hide after (optional)</span>
                  <input type="datetime-local" value={toLocal(draft.ends_at)} onChange={(e) => setDraft({ ...draft, ends_at: e.target.value ? new Date(e.target.value).toISOString() : null })} />
                </label>
              </div>

              <div className="ms-chips" style={{ gap: 18 }}>
                <label className="ms-switch">
                  <input type="checkbox" checked={draft.show_text !== false} onChange={(e) => setDraft({ ...draft, show_text: e.target.checked })} />
                  <span className="ms-switch-track" aria-hidden="true" />
                  <span>Show text over image</span>
                </label>
                <label className="ms-switch">
                  <input type="checkbox" checked={Boolean(draft.published)} onChange={(e) => setDraft({ ...draft, published: e.target.checked })} />
                  <span className="ms-switch-track" aria-hidden="true" />
                  <span>Publish on website</span>
                </label>
              </div>
            </div>

            <aside className="ms-preview">
              <div className="ms-preview-head">
                <span>Live preview</span>
                <div className="ms-seg">
                  <button type="button" className={device === "desktop" ? "on" : ""} onClick={() => setDevice("desktop")}>Desktop</button>
                  <button type="button" className={device === "mobile" ? "on" : ""} onClick={() => setDevice("mobile")}>Mobile</button>
                </div>
              </div>
              <div className={`ms-device ms-device-${device}`}>
                {draft.image_path ? (
                  <BannerCard banner={draft as StoreBanner} preview={device} />
                ) : (
                  <div className="ms-device-empty">Upload an image to preview</div>
                )}
              </div>
              <button type="button" className="ms-btn ms-btn-primary ms-btn-block" disabled={!valid || busy} onClick={async () => { if (draft && (await save(draft))) setDraft(null); }}>
                {busy ? "Saving…" : draft.id ? "Save banner" : "Create banner"}
              </button>
            </aside>
          </div>
        </section>
      )}

      <section className="ms-card">
        <div className="ms-card-head">
          <div>
            <h2>Banners by placement</h2>
            <p>Banners in the same place show in order. Use the arrows to reorder.</p>
          </div>
          {!draft && (
            <button type="button" className="ms-btn ms-btn-primary" onClick={() => setDraft(empty())}>+ New banner</button>
          )}
        </div>

        {loading ? (
          <div className="ms-skeleton-list"><span /><span /></div>
        ) : rows.length === 0 ? (
          <div className="ms-empty">
            <span aria-hidden="true">▣</span>
            <h3>No banners yet</h3>
            <p>Promote a festival offer on the home page, shop page or a category.</p>
            {!draft && <button type="button" className="ms-btn ms-btn-primary" onClick={() => setDraft(empty())}>+ New banner</button>}
          </div>
        ) : (
          <div className="ms-stack">
            {grouped.filter((g) => g.items.length).map((g) => (
              <div key={g.key} className="ms-banner-group">
                <h3>{g.label} <small>{g.items.length}</small></h3>
                <div className="ms-banner-grid">
                  {g.items.map((b, i) => {
                    const st = status(b, now);
                    return (
                      <article key={b.id} className="ms-banner-item">
                        <div className="ms-banner-thumbs">
                          <img src={b.image_path} alt="" />
                          {b.mobile_image_path && <img className="ms-banner-thumb-m" src={b.mobile_image_path} alt="" />}
                        </div>
                        <div className="ms-banner-meta">
                          <div className="ms-rule-title">
                            <strong>{b.title}</strong>
                            <span className={`ms-badge ms-badge-${st.key}`}>{st.label}</span>
                          </div>
                          <small className="ms-muted">
                            {b.mobile_image_path ? "Desktop + mobile images" : "Desktop image only"} · links to {b.link_path}
                            {b.position === "category" && ` · ${b.category_id ? cats.find((c) => c.id === b.category_id)?.name || "one category" : "all categories"}`}
                          </small>
                        </div>
                        <div className="ms-rule-actions">
                          <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" disabled={i === 0 || busy} onClick={() => void move(b, -1)} aria-label="Move up">↑</button>
                          <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" disabled={i === g.items.length - 1 || busy} onClick={() => void move(b, 1)} aria-label="Move down">↓</button>
                          <label className="ms-switch" title={b.published ? "Hide" : "Publish"}>
                            <input type="checkbox" checked={Boolean(b.published)} disabled={busy} onChange={(e) => void save({ ...b, published: e.target.checked })} />
                            <span className="ms-switch-track" aria-hidden="true" />
                          </label>
                          <button type="button" className="ms-btn ms-btn-ghost ms-btn-sm" onClick={() => { setDraft({ ...empty(), ...b }); window.scrollTo({ top: 0, behavior: "smooth" }); }}>Edit</button>
                          <button type="button" className="ms-btn ms-btn-danger-ghost ms-btn-sm" onClick={() => void remove(b)}>Delete</button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
