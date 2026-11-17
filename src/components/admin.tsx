"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Profile, capabilities, money } from "@/lib/core";
import { adminForms, adminNav, Field } from "@/lib/admin-fields";
import { api } from "./api";
import { useShop } from "./shop-context";
import { OrderView } from "./order-view";
type Row = Record<string, any>;
function FieldInput({
  field: f,
  value,
  onChange,
}: {
  field: Field;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  let show = value ?? "";
  if (f.rupees && typeof show === "number") show = show / 100;
  if (f.type === "datetime-local" && show)
    show = new Date(
      new Date(String(show)).getTime() -
        new Date(String(show)).getTimezoneOffset() * 60000,
    )
      .toISOString()
      .slice(0, 16);
  const change = (v: string) =>
    onChange(
      v === "" && f.nullable
        ? null
        : f.type === "number"
          ? Math.round(Number(v) * (f.rupees ? 100 : 1))
          : f.type === "datetime-local"
            ? v
              ? new Date(v).toISOString()
              : null
            : v,
    );
  return (
    <label className={f.type === "checkbox" ? "check" : ""}>
      {f.type === "checkbox" ? (
        <>
          <input
            type="checkbox"
            checked={Boolean(value)}
            onChange={(e) => onChange(e.target.checked)}
          />
          {f.label}
        </>
      ) : (
        <>
          {f.label}
          {f.type === "textarea" ? (
            <textarea
              value={String(show)}
              maxLength={2000}
              onChange={(e) => change(e.target.value)}
            />
          ) : f.type === "select" ? (
            <select
              value={String(show)}
              onChange={(e) => change(e.target.value)}
            >
              <option value="">Select an option</option>
              {f.choices?.map(c=><option key={c.value} value={c.value}>{c.label}</option>)}
              {f.options?.map((o) => (
                <option key={o} value={o}>
                  {o.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          ) : (
            <input
              type={f.type || "text"}
              value={String(show)}
              step={f.rupees ? ".01" : "1"}
              maxLength={1000}
              onChange={(e) => change(e.target.value)}
            />
          )}
        </>
      )}
    </label>
  );
}
export function Admin({
  section = "",
  orderId,
  profile,
}: {
  section?: string;
  orderId?: string;
  profile: Profile;
}) {
  const [rows, setRows] = useState<Row[]>([]),
    [overview, setOverview] = useState<Row | null>(null),
    [selected, setSelected] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [loadError, setLoadError] = useState(""),
    [status, setStatus] = useState(""),
    [nextPage, setNextPage] = useState<number | null>(null);
  const { notice } = useShop();
  const [categories,setCategories]=useState<Row[]>([]);
  useEffect(()=>{if(section==='products')api<Row>('/api/erp/reference').then(r=>setCategories(r.categories||[])).catch(e=>notice(e.message));},[section]);
  const requestVersion = useRef(0);
  const form = adminForms[section];
  const entity =
    form?.entity ||
    ({ staff: "profiles", audit: "audit_log" } as Record<string, string>)[
      section
    ] ||
    section ||
    "overview";
  async function load(page = 0) {
    const version = ++requestVersion.current;
    setBusy(true);
    try {
      const r = await api<Row>(
        `/api/admin/${entity}?page=${page}${section === "orders" && status ? `&status=${status}` : ""}`,
      );
      if (version !== requestVersion.current) return;
      if (entity === "overview") setOverview(r);
      else {
        setRows((old) =>
          page === 0
            ? r.rows
            : [...new Map([...old, ...r.rows].map((x) => [x.id, x])).values()],
        );
        setNextPage(r.nextPage ?? null);
        if (section === "settings" && r.rows[0])
          setSelected(
            Object.fromEntries(
              form.fields.map((f) => [f.key, r.rows[0][f.key]]),
            ),
          );
      }
      setLoadError("");
    } catch (e) {
      if (version === requestVersion.current)
        setLoadError((e as Error).message);
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }
  useEffect(() => {
    requestVersion.current++;
    setSelected(null);
    setRows([]);
    void load();
  }, [section, status]);
  async function mutate(path: string, payload: unknown) {
    setBusy(true);
    try {
      const r = await api<Row>(path, payload);
      notice(r.message || "Saved.");
      await load();
      return true;
    } catch (e) {
      notice((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function edit(r: Row) {
    setSelected({
      id: r.id,
      ...Object.fromEntries(
        form.fields.map((f) => [
          f.key,
          r[f.key] ??
            form.defaults[f.key] ??
            (f.type === "checkbox" ? false : f.type === "number" ? 0 : ""),
        ]),
      ),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!form || !selected) return;
    const data = Object.fromEntries(
      form.fields.map((f) => [
        f.key,
        selected[f.key] ??
          (f.nullable
            ? null
            : f.type === "checkbox"
              ? false
              : f.type === "number"
                ? 0
                : ""),
      ]),
    );
    if(section==='products')data.category=categories.find(c=>c.id===categories.find(s=>s.id===selected.subcategory_id)?.parent_id)?.name||'Sarees';
    if (
      (await mutate(`/api/admin/${entity}`, {
        id: typeof selected.id === "string" ? selected.id : null,
        data,
      })) &&
      section !== "settings"
    )
      setSelected(null);
  }
  const title =
    section === "staff"
      ? "Staff accounts"
      : section === "audit"
        ? "Activity log"
        : section === "inventory"
          ? "Stock adjustments"
          : section === "orders"
            ? "Orders"
            : form?.title || "Store overview";
  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <span className="eyebrow">Store management</span>
        <h2>Admin.</h2>
        <p>
          {profile.display_name || profile.email}
          <br />
          <small>{profile.role}</small>
        </p>
        <nav aria-label="Admin navigation">
          {adminNav
            .filter(
              ([, , cap]) =>
                !cap ||
                profile.role === "superadmin" ||
                (cap !== "superadmin" && profile.permissions.includes(cap)),
            )
            .map(([key, label]) => (
              <Link
                className={section === key ? "active" : ""}
                href={`/admin${key ? `/${key}` : ""}`}
                key={key}
              >
                {label}
                <span>↗</span>
              </Link>
            ))}
        </nav>
        <Link className="text-link" href="/">
          View store ↗
        </Link>
      </aside>
      <div className="admin-content">
        {orderId ? (
          <OrderView id={orderId} admin />
        ) : (
          <>
            <div className="section-heading">
              <div>
                <p className="eyebrow">மகரந்தம் சில்க்ஸ்</p>
                <h1>{title}.</h1>
              </div>
              <button className="text-link" onClick={() => void load()}>
                Refresh
              </button>
            </div>
            {loadError && (
              <div role="alert" className="notice">
                {loadError}
              </div>
            )}
            {!section && overview && (
              <>
                <div className="stats">
                  <div>
                    <span>Total orders</span>
                    <b>{overview.orders ?? "—"}</b>
                  </div>
                  <div>
                    <span>Available stock units</span>
                    <b>{overview.available ?? "—"}</b>
                  </div>
                  <div>
                    <span>Your role</span>
                    <b>{profile.role}</b>
                  </div>
                </div>
                <div className="notice">
                  Set prices and stock before enabling orders. Keep manual
                  payments pending until the bank record is checked.
                </div>
                {overview.readiness && (
                  <div className="form-panel">
                    <h2>Connection readiness.</h2>
                    <p>
                      These show whether environment values exist. Run the live
                      checks before launch.
                    </p>
                    {Object.entries(overview.readiness).map(([k, v]) => (
                      <div className="total-row" key={k}>
                        <span>{k.replaceAll("_", " ")}</span>
                        <b>{v ? "Configured" : "Not configured"}</b>
                      </div>
                    ))}
                  </div>
                )}
                <div className="quick-links">
                  {adminNav
                    .slice(1)
                    .filter(
                      ([, , cap]) =>
                        profile.role === "superadmin" ||
                        (cap !== "superadmin" &&
                          profile.permissions.includes(cap)),
                    )
                    .map(([key, label]) => (
                      <Link key={key} href={`/admin/${key}`}>
                        <h3>{label}</h3>
                        <span>Manage ↗</span>
                      </Link>
                    ))}
                </div>
              </>
            )}
            {form && (
              <>
                {section !== "settings" && section !== "bulk" && (
                  <button
                    className="button"
                    onClick={() =>
                      setSelected({
                        ...Object.fromEntries(
                          form.fields.map((f) => [
                            f.key,
                            f.nullable
                              ? null
                              : f.type === "checkbox"
                                ? false
                                : f.type === "number"
                                  ? 0
                                  : f.options?.[0] || "",
                          ]),
                        ),
                        ...form.defaults,
                      })
                    }
                  >
                    Add{" "}
                    {section === "products"
                      ? "product"
                      : section === "shipping"
                        ? "provider"
                        : section === "offers"
                          ? "offer"
                          : "banner"}{" "}
                    ＋
                  </button>
                )}
                {selected && (
                  <form className="form-panel" onSubmit={save}>
                    <h2>
                      {section === "settings"
                        ? "Store configuration"
                        : selected.id
                          ? "Edit details"
                          : "Add new"}
                    </h2>
                    <div className="form-grid">
                      {form.fields.map((f) => (
                        <FieldInput
                          key={f.key}
                          field={f.key==='subcategory_id'?{...f,choices:categories.filter(c=>c.parent_id).map(c=>({value:c.id,label:`${categories.find(m=>m.id===c.parent_id)?.name||''} / ${c.name}`}))}:f}
                          value={selected[f.key]}
                          onChange={(v) =>
                            setSelected({ ...selected, [f.key]: v })
                          }
                        />
                      ))}
                    </div>
                    {section === "offers" && (
                      <p className="subtle">
                        Fixed discounts use paise: 10000 = 100 Rs. One coupon or
                        one automatic offer applies per order; automatic offers
                        are selected by ID order. Product discounts apply first.
                      </p>
                    )}
                    {section === "products" && (
                      <p className="subtle">
                        Stock is managed separately under Stock. Price 0 shows
                        00 Rs and cannot be ordered.
                      </p>
                    )}
                    {section === "settings" && (
                      <p className="subtle">
                        Gateway keys, webhook secrets, SMTP, CAPTCHA and cron
                        are configured in the hosting environment or Supabase
                        project. They never appear in this form.
                      </p>
                    )}
                    <div className="button-row">
                      <button className="button" disabled={busy}>
                        Save {section === "settings" ? "settings" : "changes"}
                      </button>
                      {section !== "settings" && (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => setSelected(null)}
                        >
                          Cancel editing
                        </button>
                      )}
                    </div>
                  </form>
                )}
                {section !== "settings" && (
                  <div className="data-table">
                    <table>
                      <thead>
                        <tr>
                          <th>
                            {section === "products"
                              ? "Product"
                              : section === "bulk"
                                ? "Inquiry"
                                : "Name"}
                          </th>
                          <th>Details</th>
                          <th>State</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.id}>
                            <td>
                              {r.name || r.title}
                              <small>{r.sku || r.phone || r.code || ""}</small>
                            </td>
                            <td>
                              {section === "products"
                                ? money(r.price_paise)
                                : section === "bulk"
                                  ? `${r.quantity} sarees · ${r.message}`
                                  : section === "shipping"
                                    ? r.url_template
                                    : r.subtitle || r.kind}
                            </td>
                            <td>
                              {section === "bulk"
                                ? r.status
                                : r.published === false ||
                                    r.active === false ||
                                    r.enabled === false
                                  ? "Off"
                                  : "On"}
                            </td>
                            <td>
                              <button
                                className="text-link"
                                onClick={() => edit(r)}
                              >
                                Edit
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!rows.length && <p className="empty">Nothing here yet.</p>}
                  </div>
                )}
                {(profile.role === "superadmin" ||
                  profile.permissions.includes("content")) &&
                  section !== "bulk" && <MediaUpload />}
              </>
            )}
            {section === "inventory" && (
              <>
                <form
                  className="form-panel"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void mutate("/api/admin/inventory", {
                      product_id: f.get("product_id"),
                      delta: Number(f.get("delta")),
                      reason: f.get("reason"),
                    });
                  }}
                >
                  <h2>Adjust stock.</h2>
                  <label>
                    Product
                    <select name="product_id" required>
                      {rows.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.sku} · {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Change in units (positive adds, negative removes)
                    <input
                      name="delta"
                      type="number"
                      required
                      min={-100000}
                      max={100000}
                      defaultValue={1}
                    />
                  </label>
                  <label>
                    Reason
                    <input
                      name="reason"
                      minLength={3}
                      maxLength={300}
                      required
                    />
                  </label>
                  <button className="button" disabled={busy}>
                    Save stock adjustment
                  </button>
                  <p className="subtle">
                    Reserved units cannot be removed. Paid orders deduct stock
                    once; cancellations and received returns restore stock once.
                  </p>
                </form>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>On hand</th>
                        <th>Reserved</th>
                        <th>Available</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.id}>
                          <td>
                            {r.name}
                            <small>{r.sku}</small>
                          </td>
                          <td>{r.stock_on_hand}</td>
                          <td>{r.reserved}</td>
                          <td>{r.stock_on_hand - r.reserved}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {section === "orders" && (
              <>
                <label>
                  Filter order status
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                  >
                    <option value="">All orders</option>
                    {[
                      "awaiting_payment",
                      "confirmed",
                      "packing",
                      "shipped",
                      "delivered",
                      "cancelled",
                      "expired",
                      "review_required",
                      "return_requested",
                      "returned",
                    ].map((s) => (
                      <option key={s} value={s}>
                        {s.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="data-table">
                  <table>
                    <thead>
                      <tr>
                        <th>Order</th>
                        <th>Customer</th>
                        <th>Total</th>
                        <th>Order / payment</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows
                        .sort((a, b) =>
                          b.created_at.localeCompare(a.created_at),
                        )
                        .map((o) => (
                          <tr key={o.id}>
                            <td>
                              MS-{o.number}
                              <small>
                                {new Date(o.created_at).toLocaleString("en-IN")}
                              </small>
                            </td>
                            <td>
                              {o.address.name}
                              <small>{o.address.phone}</small>
                            </td>
                            <td>{money(o.total_paise)}</td>
                            <td>
                              {o.status}
                              <small>{o.payment_status}</small>
                            </td>
                            <td>
                              <Link
                                className="text-link"
                                href={`/admin/orders/${o.id}`}
                              >
                                Open order ↗
                              </Link>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {section === "staff" && (
              <>
                <form
                  className="form-panel"
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    await mutate("/api/auth/manager", {
                      name: f.get("name"),
                      email: f.get("email"),
                      password: f.get("password"),
                    });
                  }}
                >
                  <h2>Create manager.</h2>
                  <p>
                    Managers start with all configured management permissions.
                    Restrict them below after creation. Global settings and
                    staff controls remain superadmin only.
                  </p>
                  <div className="form-grid">
                    <label>
                      Name
                      <input
                        name="name"
                        minLength={2}
                        maxLength={80}
                        required
                      />
                    </label>
                    <label>
                      Email
                      <input name="email" type="email" required />
                    </label>
                    <label>
                      Temporary password (12–128 characters)
                      <input
                        name="password"
                        type="password"
                        minLength={12}
                        maxLength={128}
                        required
                        autoComplete="new-password"
                      />
                    </label>
                  </div>
                  <button disabled={busy} className="button">
                    Create manager & send confirmation
                  </button>
                </form>
                {rows.map((p) => (
                  <StaffEditor
                    key={p.id}
                    row={p}
                    self={profile.id}
                    busy={busy}
                    save={(data) => mutate("/api/admin/profiles", data)}
                  />
                ))}
              </>
            )}
            {section === "audit" && (
              <div className="data-table">
                <table>
                  <thead>
                    <tr>
                      <th>Time</th>
                      <th>Action</th>
                      <th>Entity</th>
                      <th>Actor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows
                      .sort((a, b) => b.created_at.localeCompare(a.created_at))
                      .map((r) => (
                        <tr key={r.id}>
                          <td>
                            {new Date(r.created_at).toLocaleString("en-IN")}
                          </td>
                          <td>{r.action}</td>
                          <td>
                            {r.entity}
                            <small>{r.entity_id}</small>
                          </td>
                          <td>{r.actor_id || "System"}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
            {nextPage !== null && (
              <button
                className="button button-outline"
                disabled={busy}
                onClick={() => void load(nextPage)}
              >
                Load more records
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
function StaffEditor({
  row: r,
  self,
  busy,
  save,
}: {
  row: Row;
  self: string;
  busy: boolean;
  save: (v: unknown) => Promise<boolean>;
}) {
  const [permissions, setPermissions] = useState<string[]>(r.permissions),
    [suspended, setSuspended] = useState<boolean>(r.suspended);
  return (
    <form
      className="form-panel"
      onSubmit={(e) => {
        e.preventDefault();
        void save({ user_id: r.id, permissions, suspended });
      }}
    >
      <h3>{r.display_name || r.email}</h3>
      <p>
        {r.email} · {r.role}
      </p>
      <div className="permission-grid">
        {capabilities.map((c) => (
          <label className="check" key={c}>
            <input
              type="checkbox"
              checked={permissions.includes(c)}
              disabled={r.role !== "manager" || r.id === self}
              onChange={(e) =>
                setPermissions(
                  e.target.checked
                    ? [...permissions, c]
                    : permissions.filter((p) => p !== c),
                )
              }
            />
            {c}
          </label>
        ))}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={suspended}
          disabled={r.id === self}
          onChange={(e) => setSuspended(e.target.checked)}
        />
        Suspend account
      </label>
      <button
        disabled={busy || r.id === self}
        className="button button-outline"
      >
        Save account access
      </button>
    </form>
  );
}
function MediaUpload() {
  const [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false);
  const { notice } = useShop();
  return (
    <form
      className="form-panel"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        const f = new FormData(e.currentTarget);
        f.set("kind", "media");
        try {
          const r = await api<Row>("/api/uploads", undefined, f);
          setUrl(r.url);
          notice(r.message);
        } catch (error) {
          notice((error as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <h3>Upload an image.</h3>
      <label>
        JPEG, PNG or WebP · up to 5 MB
        <input
          type="file"
          name="file"
          accept="image/jpeg,image/png,image/webp"
          required
        />
      </label>
      <button disabled={busy} className="button button-outline">
        Upload image
      </button>
      {url && (
        <label>
          Uploaded image URL (copy into an image field)
          <input value={url} readOnly onFocus={(e) => e.target.select()} />
        </label>
      )}
    </form>
  );
}
