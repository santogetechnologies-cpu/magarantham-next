"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Profile } from "@/lib/core";
import { pageMeta } from "@/lib/admin-pages";
import { api } from "../api";
import { adminNavGroups } from "./sidebar";
import { OrderNotificationsManager } from "./order-notifications";

function can(profile: Profile, cap?: string) {
  if (!cap) return true;
  if (profile.role === "superadmin") return true;
  if (profile.role === "billing") return cap === "pos" || cap === "expenses";
  if (cap === "superadmin") return false;
  return profile.permissions?.includes(cap);
}

/** Ctrl/⌘+K quick navigation across every ERP page the user can open. */
function CommandPalette({ profile, open, onClose }: { profile: Profile; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const all = adminNavGroups.flatMap((g) =>
      g.items.filter((i) => can(profile, i.cap)).map((i) => ({ ...i, group: g.title })),
    );
    const term = q.trim().toLowerCase();
    const list = term
      ? all.filter((i) => `${i.label} ${i.group}`.toLowerCase().includes(term))
      : all;
    if (term && can(profile, "catalogue"))
      list.push({ key: "products", label: `Search sarees for “${q.trim()}”`, href: `/admin/products?search=${encodeURIComponent(q.trim())}`, icon: "layers", group: "Catalogue" });
    return list.slice(0, 12);
  }, [q, profile]);

  useEffect(() => {
    if (open) {
      setQ("");
      setIndex(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  if (!open) return null;

  function go(href: string) {
    onClose();
    router.push(href);
  }

  return (
    <div className="ms-cmd-overlay" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Quick navigation">
      <div className="ms-cmd" onMouseDown={(e) => e.stopPropagation()}>
        <div className="ms-cmd-input">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <input
            ref={inputRef}
            className="ms-cmd-search"
            value={q}
            placeholder="Jump to a page or search sarees…"
            onChange={(e) => {
              setQ(e.target.value);
              setIndex(0);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setIndex((i) => Math.min(items.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setIndex((i) => Math.max(0, i - 1));
              } else if (e.key === "Enter" && items[index]) {
                e.preventDefault();
                go(items[index].href);
              } else if (e.key === "Escape") onClose();
            }}
          />
          <button
            type="button"
            className="ms-btn ms-btn-ghost ms-btn-sm"
            onClick={onClose}
            aria-label="Back"
            style={{ flexShrink: 0, height: 30, padding: "0 10px" }}
          >
            ← Back
          </button>
        </div>
        <ul className="ms-cmd-list">
          {items.length === 0 && <li className="ms-cmd-empty">No matching page.</li>}
          {items.map((item, i) => (
            <li key={item.href + item.label}>
              <button
                type="button"
                className={i === index ? "active" : ""}
                onMouseEnter={() => setIndex(i)}
                onClick={() => go(item.href)}
              >
                <span>{item.label}</span>
                <small>{item.group}</small>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function AdminTopbar({
  section,
  profile,
  onOpenSidebar,
}: {
  section: string;
  profile: Profile;
  onOpenSidebar: () => void;
}) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    try {
      if (sessionStorage.getItem("ms_admin_tab_session") !== "1") {
        void api("/api/auth/logout", {})
          .catch(() => {})
          .finally(() => {
            window.location.replace("/login?returnTo=/admin");
          });
        return;
      }
    } catch {}
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30000);
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      clearInterval(t);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const title = pageMeta(section).title;
  const canCatalogue = can(profile, "catalogue");
  const canPos = can(profile, "pos");
  const canOrders = can(profile, "orders");

  return (
    <>
      <header className="luxury-admin-topbar ms-top">
        <div className="ms-top-left">
          <button type="button" className="ms-icon-btn ms-menu-btn" onClick={onOpenSidebar} aria-label="Open navigation menu">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
          </button>
          <nav className="ms-crumbs" aria-label="Breadcrumb">
            <Link href="/admin">ERP</Link>
            <span aria-hidden="true">/</span>
            <strong>{title}</strong>
          </nav>
        </div>

        <button type="button" className="ms-top-search" onClick={() => setPaletteOpen(true)}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" /></svg>
          <span>Search pages, sarees…</span>
          <kbd>Ctrl K</kbd>
        </button>

        <div className="ms-top-right">
          <OrderNotificationsManager enabled={Boolean(canOrders)} />
          {now && (
            <span className="ms-top-date" suppressHydrationWarning>
              {now.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short" })}
              <b>{now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</b>
            </span>
          )}
          {canPos && section !== "pos" && (
            <Link href="/admin/pos" className="ms-btn ms-btn-soft ms-btn-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="2" y="4" width="20" height="14" rx="2" /><path d="M8 21h8M12 18v3" /></svg>
              New bill
            </Link>
          )}
          {canCatalogue && (
            <Link href="/admin/products?action=new" className="ms-btn ms-btn-primary ms-btn-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
              Add saree
            </Link>
          )}
        </div>
      </header>
      <CommandPalette profile={profile} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  );
}
