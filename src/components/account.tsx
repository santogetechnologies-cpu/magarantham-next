"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Profile, Product, money } from "@/lib/core";
import { api } from "./api";
import { useShop } from "./shop-context";
import { addressFields } from "./storefront";
import { ProductCard } from "./catalogue";
type Row = Record<string, any>;
export function Account({
  profile,
  products,
  ordering,
}: {
  profile: Profile;
  products: Product[];
  ordering: boolean;
}) {
  const [tab, setTab] = useState("orders"),
    [rows, setRows] = useState<Row[]>([]),
    [busy, setBusy] = useState(false),
    [nextPage, setNextPage] = useState<number | null>(null);
  const { notice } = useShop();
  const requestVersion = useRef(0);
  async function load(page = 0) {
    const version = ++requestVersion.current;
    setBusy(true);
    try {
      const r = await api<{ rows: Row[]; nextPage: number | null }>(
        `/api/account/${tab}?page=${page}`,
      );
      if (version !== requestVersion.current) return;
      setRows((old) => (page === 0 ? r.rows : [...old, ...r.rows]));
      setNextPage(r.nextPage);
    } catch (e) {
      if (version === requestVersion.current) notice((e as Error).message);
    } finally {
      if (version === requestVersion.current) setBusy(false);
    }
  }
  useEffect(() => {
    requestVersion.current++;
    setNextPage(null);
    setRows([]);
    if (tab !== "profile") void load();
  }, [tab]);
  async function mutate(resource: string, data: unknown) {
    setBusy(true);
    try {
      await api(`/api/account/${resource}`, data);
      notice("Saved.");
      if (resource === tab) await load();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Welcome, {profile.display_name || "friend"}</p>
          <h1>My account.</h1>
        </div>
        <div className="button-row">
          {profile.role !== "customer" && (
            <Link className="button" href="/admin">
              Open admin ↗
            </Link>
          )}
          <button
            className="text-link"
            onClick={async () => {
              await api("/api/auth/logout", {});
              window.location.assign("/");
            }}
          >
            Sign out
          </button>
        </div>
      </div>
      <div className="tabs">
        {["orders", "wishlist", "addresses", "notifications", "profile"].map(
          (t) => (
            <button
              className={tab === t ? "active" : ""}
              onClick={() => setTab(t)}
              key={t}
            >
              {t === "wishlist"
                ? "Favourites"
                : t[0].toUpperCase() + t.slice(1)}
            </button>
          ),
        )}
      </div>
      {tab === "orders" && (
        <div className="order-list">
          {rows
            .sort((a, b) => b.created_at.localeCompare(a.created_at))
            .map((o) => (
              <Link
                className="order-card"
                key={o.id}
                href={`/account/orders/${o.id}`}
              >
                <div>
                  <span className="eyebrow">MS-{o.number}</span>
                  <h3>{o.status.replaceAll("_", " ")}</h3>
                  <span>
                    {new Date(o.created_at).toLocaleDateString("en-IN")}
                  </span>
                </div>
                <div>
                  <b>{money(o.total_paise)}</b>
                  <p>{o.payment_status.replaceAll("_", " ")} ↗</p>
                </div>
              </Link>
            ))}
          {!rows.length && (
            <p className="empty">Your orders will appear here.</p>
          )}
        </div>
      )}
      {tab === "wishlist" && (
        <div className="product-grid">
          {rows.map((r) => {
            const p = products.find((p) => p.id === r.product_id);
            return (
              p && (
                <div key={p.id}>
                  <ProductCard product={p} ordering={ordering} />
                  <button
                    disabled={busy}
                    className="text-link"
                    onClick={() =>
                      mutate("wishlist", { product_id: p.id, remove: true })
                    }
                  >
                    Remove favourite
                  </button>
                </div>
              )
            );
          })}
        </div>
      )}
      {tab === "notifications" &&
        rows.map((n) => (
          <div className="notification" key={n.id}>
            <h3>{n.title}</h3>
            <p>{n.body}</p>
            {n.order_id && (
              <Link
                className="text-link"
                href={`/account/orders/${n.order_id}`}
              >
                View order ↗
              </Link>
            )}
            {!n.read_at && (
              <button
                className="text-link"
                onClick={() => mutate("notifications", { id: n.id })}
              >
                Mark as read
              </button>
            )}
          </div>
        ))}
      {tab === "addresses" && (
        <div className="two-column">
          <div>
            {rows.map((a) => (
              <div className="notification" key={a.id}>
                <h3>{a.label}</h3>
                <p>{Object.values(a.address).join(", ")}</p>
                <button
                  disabled={busy}
                  className="text-link"
                  onClick={() =>
                    mutate("addresses", { id: a.id, remove: true })
                  }
                >
                  Delete address
                </button>
              </div>
            ))}
          </div>
          <form
            className="form-panel"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void mutate("addresses", {
                label: f.get("label"),
                address: Object.fromEntries(
                  addressFields.map(([k]) => [k, String(f.get(k) || "")]),
                ),
              });
            }}
          >
            <h2>Add an address.</h2>
            <label>
              Address label
              <input name="label" defaultValue="Home" required maxLength={40} />
            </label>
            {addressFields.map(([k, l]) => (
              <label key={k}>
                {l}
                <input
                  name={k}
                  required={k !== "line2"}
                  maxLength={k === "pin" ? 6 : 180}
                />
              </label>
            ))}
            <button disabled={busy} className="button">
              Save address
            </button>
          </form>
        </div>
      )}
      {tab === "profile" && (
        <div className="two-column">
          <form
            className="form-panel"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate("profile", {
                display_name: new FormData(e.currentTarget).get("display_name"),
              });
            }}
          >
            <h2>Your details.</h2>
            <p>{profile.email}</p>
            <label>
              Name
              <input
                name="display_name"
                defaultValue={profile.display_name}
                required
                maxLength={80}
              />
            </label>
            <button disabled={busy} className="button">
              Save name
            </button>
          </form>
          <div className="form-panel">
            <h2>Password.</h2>
            <p>Choose a long, unique password for your account.</p>
            <Link href="/reset-password" className="button">
              Change password ↗
            </Link>
          </div>
        </div>
      )}
      {nextPage !== null && tab !== "profile" && (
        <button
          className="button button-outline"
          disabled={busy}
          onClick={() => void load(nextPage)}
        >
          Load more
        </button>
      )}
    </section>
  );
}
