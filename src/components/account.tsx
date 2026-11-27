"use client";
import React, { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Profile, Product, Settings, money, unitPrice, statusLabel } from "@/lib/core";
import { api } from "./api";
import { buyableColours, useShop } from "./shop-context";
import { addressFields } from "./storefront";

type Row = Record<string, any>;
type AccountTab = "overview" | "orders" | "wishlist" | "addresses" | "profile" | "support";
type OrderFilter = "all" | "processing" | "shipped" | "delivered" | "cancelled";

const DEEP_MAROON = "#79051E";
const WARM_CARD = "#FFFDF9";
const BORDER_COLOR = "#EAD5C0";

function statusBadgeStyle(status: string): React.CSSProperties {
  const s = status.toLowerCase();
  if (s === "paid" || s === "delivered" || s === "confirmed") {
    return { background: "#ECFDF5", color: "#065F46", border: "1px solid #A7F3D0" };
  }
  if (s === "packing" || s === "shipped" || s === "submitted") {
    return { background: "#EFF6FF", color: "#1E40AF", border: "1px solid #BFDBFE" };
  }
  if (s === "cancelled" || s === "failed" || s === "expired") {
    return { background: "#FEF2F2", color: "#991B1B", border: "1px solid #FECACA" };
  }
  return { background: "#FFFBEB", color: "#92400E", border: "1px solid #FDE68A" };
}

function getInitials(name?: string, email?: string) {
  const src = (name || email || "M").trim();
  const parts = src.split(/\s+/);
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

async function resizeImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Could not read image file."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Invalid image file."));
      img.onload = () => {
        const size = 256;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("Canvas unavailable."));
        const minDim = Math.min(img.width, img.height);
        const sx = (img.width - minDim) / 2;
        const sy = (img.height - minDim) / 2;
        ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });
}

export function Account({
  profile: initialProfile,
  products,
  ordering,
  settings,
}: {
  profile: Profile;
  products: Product[];
  ordering: boolean;
  settings?: Settings;
}) {
  const [tab, setTab] = useState<AccountTab>("overview");
  const [profile, setProfile] = useState<Profile & { avatar_url?: string }>(initialProfile);
  const [ordersCount, setOrdersCount] = useState(0);
  const [wishlistCount, setWishlistCount] = useState(0);
  const [addressesCount, setAddressesCount] = useState(0);
  const [recentOrders, setRecentOrders] = useState<Row[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [nextPage, setNextPage] = useState<number | null>(null);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("all");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");

  // Address form state (Add or Edit)
  const [editingAddress, setEditingAddress] = useState<Row | null>(null);
  const [addrLabel, setAddrLabel] = useState("Home");
  const [addrValues, setAddrValues] = useState<Record<string, string>>({
    name: initialProfile.display_name || "",
    phone: initialProfile.phone || "",
    line1: "",
    line2: "",
    city: "",
    state: "",
    pin: "",
  });
  const [addrDefault, setAddrDefault] = useState(false);

  // Profile Settings state
  const [displayName, setDisplayName] = useState(initialProfile.display_name || "");
  const [emailInput, setEmailInput] = useState(initialProfile.email || "");
  const [avatarUrl, setAvatarUrl] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [showPwd, setShowPwd] = useState(false);

  const { add, notice } = useShop();
  const requestVersion = useRef(0);

  async function loadSummary() {
    setLoading(true);
    setLoadError("");
    try {
      const res = await api<{
        profile?: Profile & { avatar_url?: string };
        ordersCount: number;
        wishlistCount: number;
        addressesCount: number;
        recentOrders: Row[];
      }>("/api/account/summary");
      if (res.profile) {
        setProfile(res.profile);
        setDisplayName(res.profile.display_name || "");
        setEmailInput(res.profile.email || "");
        setAvatarUrl(res.profile.avatar_url || "");
      }
      setOrdersCount(res.ordersCount || 0);
      setWishlistCount(res.wishlistCount || 0);
      setAddressesCount(res.addressesCount || 0);
      setRecentOrders(res.recentOrders || []);
    } catch (e) {
      setLoadError((e as Error).message || "Could not load your account overview.");
    } finally {
      setLoading(false);
    }
  }

  async function loadTabResource(resource: "orders" | "wishlist" | "addresses", page = 0) {
    const version = ++requestVersion.current;
    setLoading(true);
    setLoadError("");
    try {
      const r = await api<{ rows: Row[]; nextPage: number | null }>(
        `/api/account/${resource}?page=${page}`,
      );
      if (version !== requestVersion.current) return;
      setRows((old) => (page === 0 ? r.rows : [...old, ...r.rows]));
      setNextPage(r.nextPage);
    } catch (e) {
      if (version === requestVersion.current) {
        setLoadError((e as Error).message || "Could not load data.");
      }
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  useEffect(() => {
    requestVersion.current++;
    setNextPage(null);
    setRows([]);
    setLoadError("");
    if (tab === "overview") {
      void loadSummary();
    } else if (tab === "orders" || tab === "wishlist" || tab === "addresses") {
      void loadTabResource(tab, 0);
    }
  }, [tab]);

  async function mutate(resource: string, data: unknown) {
    setBusy(true);
    try {
      const res = await api<{ message?: string }>(`/api/account/${resource}`, data);
      notice(res.message || "Saved.");
      await loadSummary();
      if (tab === "orders" || tab === "wishlist" || tab === "addresses") {
        await loadTabResource(tab, 0);
      }
      return true;
    } catch (e) {
      notice((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  function startEditAddress(a: Row) {
    setEditingAddress(a);
    setAddrLabel(String(a.label || "Home").replace(/^Default · /i, ""));
    setAddrDefault(String(a.label || "").startsWith("Default · ") || Boolean(a.is_default));
    setAddrValues({
      name: a.address?.name || "",
      phone: a.address?.phone || "",
      line1: a.address?.line1 || "",
      line2: a.address?.line2 || "",
      city: a.address?.city || "",
      state: a.address?.state || "",
      pin: a.address?.pin || "",
    });
  }

  function resetAddressForm() {
    setEditingAddress(null);
    setAddrLabel("Home");
    setAddrDefault(false);
    setAddrValues({
      name: profile.display_name || "",
      phone: profile.phone || "",
      line1: "",
      line2: "",
      city: "",
      state: "",
      pin: "",
    });
  }

  async function handleSaveAddress(e: FormEvent) {
    e.preventDefault();
    if (!/^[1-9][0-9]{5}$/.test(addrValues.pin.trim())) {
      notice("Please enter a valid 6-digit Indian pincode.");
      return;
    }
    const ok = await mutate("addresses", {
      ...(editingAddress ? { id: editingAddress.id } : {}),
      label: addrLabel.trim() || "Home",
      is_default: addrDefault,
      address: {
        name: addrValues.name.trim(),
        phone: addrValues.phone.trim(),
        line1: addrValues.line1.trim(),
        line2: addrValues.line2.trim(),
        city: addrValues.city.trim(),
        state: addrValues.state.trim(),
        pin: addrValues.pin.trim(),
      },
    });
    if (ok) resetAddressForm();
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    if (displayName.trim().length < 2) {
      notice("Full name must be at least 2 characters.");
      return;
    }
    await mutate("profile", {
      display_name: displayName.trim(),
      email: emailInput.trim(),
      avatar_url: avatarUrl,
    });
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (newPassword.length < 6) {
      notice("Password must be at least 6 characters.");
      return;
    }
    if (newPassword !== confirmNewPassword) {
      notice("New password and confirm password do not match.");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ message?: string }>("/api/auth/password", {
        password: newPassword,
      });
      notice(res.message || "Password updated successfully.");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch (err) {
      notice((err as Error).message || "Could not update password.");
    } finally {
      setBusy(false);
    }
  }

  const filteredOrders = rows.filter((o) => {
    if (orderFilter === "all") return true;
    if (orderFilter === "processing") {
      return ["awaiting_payment", "confirmed", "packing"].includes(o.status);
    }
    if (orderFilter === "shipped") return o.status === "shipped";
    if (orderFilter === "delivered") return o.status === "delivered";
    if (orderFilter === "cancelled") {
      return ["cancelled", "expired"].includes(o.status);
    }
    return true;
  });

  const whatsappDigits = (settings?.whatsapp_phone || settings?.support_phone || "").replace(/\D/g, "");
  const whatsappSupportUrl = whatsappDigits
    ? `https://wa.me/${whatsappDigits}?text=${encodeURIComponent("Hello Magarantham Silks, I need help with my account / order.")}`
    : "";

  const quickActions: Array<{
    key: AccountTab;
    title: string;
    subtitle: string;
    count?: number;
    icon: string;
  }> = [
    { key: "orders", title: "My Orders", subtitle: "Track & download invoices", count: ordersCount, icon: "📦" },
    { key: "wishlist", title: "My Wishlist", subtitle: "Saved silk sarees", count: wishlistCount, icon: "♥" },
    { key: "addresses", title: "My Addresses", subtitle: "Delivery locations", count: addressesCount, icon: "📍" },
    { key: "profile", title: "Profile Settings", subtitle: "Name, email & password", icon: "⚙" },
  ];

  function renderOrderCard(o: Row) {
    const items = Array.isArray(o.order_items) ? o.order_items : [];
    const totalQty = items.reduce((sum: number, item: Row) => sum + Number(item.quantity || 1), 0);

    return (
      <div
        key={o.id}
        style={{
          background: WARM_CARD,
          border: `1px solid ${BORDER_COLOR}`,
          borderRadius: 14,
          padding: "20px 22px",
          marginBottom: 16,
          boxShadow: "0 4px 16px rgba(121, 5, 30, 0.05)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 12,
            paddingBottom: 14,
            borderBottom: `1px solid ${BORDER_COLOR}`,
          }}
        >
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: DEEP_MAROON, letterSpacing: "0.06em" }}>
              ORDER #MS-{o.number}
            </span>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
              {new Date(o.created_at).toLocaleDateString("en-IN", {
                day: "2-digit",
                month: "short",
                year: "numeric",
              })}{" "}
              · {totalQty} {totalQty === 1 ? "saree" : "sarees"}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span
              style={{
                ...statusBadgeStyle(o.payment_status),
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                textTransform: "capitalize",
              }}
            >
              Payment: {o.payment_status.replaceAll("_", " ")}
            </span>
            <span
              style={{
                ...statusBadgeStyle(o.status),
                padding: "4px 10px",
                borderRadius: 999,
                fontSize: 11,
                fontWeight: 600,
                textTransform: "capitalize",
              }}
            >
              {statusLabel(o.status)}
            </span>
            <strong style={{ fontSize: 16, color: DEEP_MAROON, marginLeft: 6 }}>
              {money(o.total_paise)}
            </strong>
          </div>
        </div>

        {items.length > 0 && (
          <div style={{ padding: "14px 0", display: "grid", gap: 10 }}>
            {items.map((item: Row) => (
              <div
                key={item.id || item.name}
                style={{ display: "flex", alignItems: "center", gap: 14 }}
              >
                <img
                  src={item.image_path || "/assets/product-01.jpg"}
                  alt={item.name}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/assets/product-01.jpg";
                  }}
                  style={{
                    width: 54,
                    height: 68,
                    objectFit: "cover",
                    borderRadius: 8,
                    border: `1px solid ${BORDER_COLOR}`,
                  }}
                />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1F2937" }}>
                    {item.name}
                  </div>
                  <div style={{ fontSize: 12, color: "#6B7280", marginTop: 2 }}>
                    Qty: {item.quantity} × {money(item.unit_price_paise)}
                  </div>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, color: "#1F2937" }}>
                  {money(item.quantity * item.unit_price_paise)}
                </div>
              </div>
            ))}
          </div>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 10,
            paddingTop: 12,
            borderTop: `1px solid #F3EAE0`,
          }}
        >
          <span style={{ fontSize: 12, color: "#6B7280" }}>
            {o.tracking_id ? `Tracking: ${o.tracking_id}` : "Magarantham Silks Order"}
          </span>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link
              href={`/account/orders/${o.id}`}
              className="button button-outline"
              style={{ minHeight: 38, padding: "8px 16px", fontSize: 12 }}
            >
              View Details ↗
            </Link>
            <a
              href={`/api/orders/${o.id}/invoice`}
              download={`Invoice-MS-${o.number}.pdf`}
              className="button"
              style={{
                minHeight: 38,
                padding: "8px 16px",
                fontSize: 12,
                background: DEEP_MAROON,
                borderColor: DEEP_MAROON,
              }}
            >
              Download Invoice 📄
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <section className="section" style={{ paddingTop: 32, paddingBottom: 64 }}>
      {/* 1. Customer Profile Header Card */}
      <div
        style={{
          background: WARM_CARD,
          border: `1px solid ${BORDER_COLOR}`,
          borderRadius: 16,
          padding: "26px 28px",
          marginBottom: 24,
          boxShadow: "0 8px 24px rgba(121, 5, 30, 0.06)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 20,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={profile.display_name || "Customer"}
              style={{
                width: 68,
                height: 68,
                borderRadius: "50%",
                objectFit: "cover",
                border: `2px solid ${DEEP_MAROON}`,
              }}
            />
          ) : (
            <div
              style={{
                width: 68,
                height: 68,
                borderRadius: "50%",
                background: DEEP_MAROON,
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 22,
                fontWeight: 700,
                fontFamily: "var(--serif)",
                border: "2px solid #C49A52",
                flexShrink: 0,
              }}
            >
              {getInitials(profile.display_name, profile.email)}
            </div>
          )}

          <div>
            <p className="eyebrow" style={{ marginBottom: 4, color: "#A27731" }}>
              My Account Dashboard
            </p>
            <h1 style={{ fontSize: "clamp(26px, 3vw, 34px)", margin: "0 0 4px", color: DEEP_MAROON }}>
              {profile.display_name || "Valued Customer"}
            </h1>
            <p style={{ margin: 0, fontSize: 13, color: "#6B7280" }}>
              {profile.email}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
          {profile.role !== "customer" && (
            <Link
              className="button"
              href="/admin"
              style={{ minHeight: 40, padding: "8px 16px", fontSize: 13 }}
            >
              Open Admin ↗
            </Link>
          )}
          <button
            type="button"
            onClick={() => setTab("profile")}
            className="button button-outline"
            style={{ minHeight: 40, padding: "8px 16px", fontSize: 13 }}
          >
            Edit Profile
          </button>
          <button
            type="button"
            className="button"
            style={{
              minHeight: 40,
              padding: "8px 16px",
              fontSize: 13,
              background: DEEP_MAROON,
              borderColor: DEEP_MAROON,
            }}
            onClick={async () => {
              await api("/api/auth/logout", {});
              window.location.assign("/");
            }}
          >
            Sign Out
          </button>
        </div>
      </div>

      {/* 2. Four Interactive Quick Action Cards */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
          gap: 14,
          marginBottom: 26,
        }}
      >
        {quickActions.map((qa) => {
          const active = tab === qa.key;
          return (
            <button
              key={qa.key}
              type="button"
              onClick={() => setTab(qa.key)}
              style={{
                textAlign: "left",
                background: active ? DEEP_MAROON : WARM_CARD,
                color: active ? "#FFFFFF" : "#1F2937",
                border: `1px solid ${active ? DEEP_MAROON : BORDER_COLOR}`,
                borderRadius: 14,
                padding: "18px 20px",
                cursor: "pointer",
                boxShadow: active
                  ? "0 10px 24px rgba(121, 5, 30, 0.22)"
                  : "0 3px 10px rgba(0,0,0,0.03)",
                transition: "all 0.2s ease",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 10,
                    background: active ? "rgba(255,255,255,0.16)" : "rgba(121, 5, 30, 0.08)",
                    color: active ? "#FFFFFF" : DEEP_MAROON,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 17,
                  }}
                >
                  {qa.icon}
                </span>
                {qa.count !== undefined && (
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 700,
                      color: active ? "#FDE047" : DEEP_MAROON,
                    }}
                  >
                    {qa.count}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 15, fontWeight: 700, marginTop: 12 }}>{qa.title}</div>
              <div style={{ fontSize: 12, opacity: active ? 0.85 : 0.7, marginTop: 2 }}>
                {qa.subtitle}
              </div>
            </button>
          );
        })}
      </div>

      {/* Navigation Tabs */}
      <div className="tabs" style={{ marginBottom: 24 }}>
        {(
          [
            ["overview", "Overview"],
            ["orders", "My Orders"],
            ["wishlist", "My Wishlist"],
            ["addresses", "My Addresses"],
            ["profile", "Profile Settings"],
            ["support", "Support"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            className={tab === key ? "active" : ""}
            onClick={() => setTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Error State */}
      {loadError && (
        <div
          style={{
            background: "#FEF2F2",
            border: "1px solid #FECACA",
            color: "#991B1B",
            padding: "14px 18px",
            borderRadius: 12,
            marginBottom: 20,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>{loadError}</span>
          <button
            type="button"
            onClick={() =>
              tab === "overview"
                ? void loadSummary()
                : tab === "orders" || tab === "wishlist" || tab === "addresses"
                  ? void loadTabResource(tab, 0)
                  : undefined
            }
            className="button button-outline"
            style={{ minHeight: 34, padding: "6px 12px", fontSize: 12 }}
          >
            Retry
          </button>
        </div>
      )}

      {/* Loading Skeleton */}
      {loading && (tab === "overview" || tab === "orders" || tab === "wishlist" || tab === "addresses") && (
        <div style={{ display: "grid", gap: 14, marginBottom: 20 }}>
          {[1, 2].map((i) => (
            <div
              key={i}
              style={{
                height: 110,
                borderRadius: 14,
                background: "rgba(255, 253, 249, 0.7)",
                border: `1px solid ${BORDER_COLOR}`,
                padding: 20,
                color: "#9CA3AF",
                fontSize: 13,
              }}
            >
              Loading your {tab}…
            </div>
          ))}
        </div>
      )}

      {/* TAB: OVERVIEW */}
      {tab === "overview" && !loading && (
        <div style={{ display: "grid", gap: 24 }}>
          <div
            style={{
              background: WARM_CARD,
              border: `1px solid ${BORDER_COLOR}`,
              borderRadius: 16,
              padding: "24px",
              boxShadow: "0 4px 16px rgba(0,0,0,0.03)",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 12,
                marginBottom: 18,
              }}
            >
              <div>
                <h2 style={{ margin: 0, fontSize: 22, color: DEEP_MAROON }}>Recent Orders</h2>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#6B7280" }}>
                  Your latest 3 saree orders
                </p>
              </div>
              {recentOrders.length > 0 && (
                <button
                  type="button"
                  onClick={() => setTab("orders")}
                  className="button button-outline"
                  style={{ minHeight: 38, padding: "8px 16px", fontSize: 12 }}
                >
                  View All Orders ↗
                </button>
              )}
            </div>

            {recentOrders.length === 0 ? (
              <div style={{ textAlign: "center", padding: "36px 16px" }}>
                <div style={{ fontSize: 34, marginBottom: 8 }}>🥻</div>
                <h3 style={{ margin: "0 0 6px", color: DEEP_MAROON }}>
                  You haven&apos;t placed any orders yet.
                </h3>
                <p style={{ margin: "0 0 18px", fontSize: 13, color: "#6B7280" }}>
                  Explore our handwoven Kanchipuram, soft silk, and bridal collections.
                </p>
                <Link
                  href="/shop"
                  className="button"
                  style={{ background: DEEP_MAROON, borderColor: DEEP_MAROON }}
                >
                  Shop Sarees ↗
                </Link>
              </div>
            ) : (
              recentOrders.slice(0, 3).map((o) => renderOrderCard(o))
            )}
          </div>
        </div>
      )}

      {/* TAB: MY ORDERS */}
      {tab === "orders" && !loading && (
        <div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
            {(
              [
                ["all", "All Orders"],
                ["processing", "Processing"],
                ["shipped", "Dispatched"],
                ["delivered", "Delivered"],
                ["cancelled", "Cancelled"],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                onClick={() => setOrderFilter(k)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: "pointer",
                  border: `1px solid ${orderFilter === k ? DEEP_MAROON : BORDER_COLOR}`,
                  background: orderFilter === k ? DEEP_MAROON : WARM_CARD,
                  color: orderFilter === k ? "#FFFFFF" : "#374151",
                }}
              >
                {label}
              </button>
            ))}
          </div>

          {filteredOrders.length === 0 ? (
            <div
              style={{
                background: WARM_CARD,
                border: `1px solid ${BORDER_COLOR}`,
                borderRadius: 16,
                padding: "48px 20px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 36, marginBottom: 10 }}>🥻</div>
              <h3 style={{ margin: "0 0 6px", color: DEEP_MAROON }}>
                {orderFilter === "all"
                  ? "You haven't placed any orders yet."
                  : `No ${orderFilter} orders found.`}
              </h3>
              <p style={{ margin: "0 0 18px", fontSize: 13, color: "#6B7280" }}>
                Browse our pure silk and handloom sarees.
              </p>
              <Link
                href="/shop"
                className="button"
                style={{ background: DEEP_MAROON, borderColor: DEEP_MAROON }}
              >
                Shop Sarees ↗
              </Link>
            </div>
          ) : (
            filteredOrders.map((o) => renderOrderCard(o))
          )}
        </div>
      )}

      {/* TAB: MY WISHLIST */}
      {tab === "wishlist" && !loading && (
        <div>
          {rows.length === 0 ? (
            <div
              style={{
                background: WARM_CARD,
                border: `1px solid ${BORDER_COLOR}`,
                borderRadius: 16,
                padding: "48px 20px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: 34, marginBottom: 10 }}>♥</div>
              <h3 style={{ margin: "0 0 6px", color: DEEP_MAROON }}>
                Your wishlist is empty.
              </h3>
              <p style={{ margin: "0 0 18px", fontSize: 13, color: "#6B7280" }}>
                Save your favourite sarees here to revisit them anytime.
              </p>
              <Link
                href="/shop"
                className="button"
                style={{ background: DEEP_MAROON, borderColor: DEEP_MAROON }}
              >
                Shop Sarees ↗
              </Link>
            </div>
          ) : (
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
                gap: 18,
              }}
            >
              {rows.map((r) => {
                const p = products.find((item) => item.id === r.product_id);
                if (!p) return null;
                return (
                  <div
                    key={p.id}
                    style={{
                      background: WARM_CARD,
                      border: `1px solid ${BORDER_COLOR}`,
                      borderRadius: 14,
                      overflow: "hidden",
                      display: "flex",
                      flexDirection: "column",
                      boxShadow: "0 4px 14px rgba(0,0,0,0.04)",
                    }}
                  >
                    <Link href={`/products/${p.slug}`} style={{ display: "block", aspectRatio: "4/5", overflow: "hidden" }}>
                      <img
                        src={p.image_path || "/assets/product-01.jpg"}
                        alt={p.name}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = "/assets/product-01.jpg";
                        }}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }}
                      />
                    </Link>
                    <div style={{ padding: 14, flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between", gap: 10 }}>
                      <div>
                        <div style={{ fontSize: 11, color: "#A27731", fontWeight: 600 }}>{p.category}</div>
                        <Link href={`/products/${p.slug}`} style={{ textDecoration: "none", color: "#1F2937" }}>
                          <h4 style={{ margin: "4px 0", fontSize: 15, fontWeight: 600 }}>{p.name}</h4>
                        </Link>
                        <div style={{ fontSize: 15, fontWeight: 700, color: DEEP_MAROON }}>
                          {money(unitPrice(p))}
                          {p.price_paise > unitPrice(p) && (
                            <del style={{ marginLeft: 6, color: "#9CA3AF", fontSize: 12, fontWeight: 400 }}>
                              {money(p.price_paise)}
                            </del>
                          )}
                        </div>
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          disabled={!ordering || p.available < 1 || busy}
                          onClick={() => {
                            const free = buyableColours(p);
                            if (free.length === 1) add(p.id, free[0], free[0].quantity - free[0].reserved);
                            else window.location.href = `/products/${p.slug}`;
                          }}
                          className="button"
                          style={{
                            flex: 1,
                            minHeight: 38,
                            padding: "8px 10px",
                            fontSize: 12,
                            background: DEEP_MAROON,
                            borderColor: DEEP_MAROON,
                          }}
                        >
                          {p.available < 1 ? "Sold out" : "Add to Cart"}
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void mutate("wishlist", { product_id: p.id, remove: true })}
                          className="button button-outline"
                          style={{ minHeight: 38, padding: "8px 12px", fontSize: 12 }}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* TAB: MY ADDRESSES */}
      {tab === "addresses" && !loading && (
        <div className="two-column">
          <div>
            <h2 style={{ margin: "0 0 14px", fontSize: 22, color: DEEP_MAROON }}>
              Saved Addresses
            </h2>
            {rows.length === 0 ? (
              <div
                style={{
                  background: WARM_CARD,
                  border: `1px solid ${BORDER_COLOR}`,
                  borderRadius: 14,
                  padding: 28,
                  color: "#6B7280",
                  fontSize: 13,
                }}
              >
                No saved addresses yet. Add a delivery address using the form.
              </div>
            ) : (
              <div style={{ display: "grid", gap: 14 }}>
                {rows.map((a) => {
                  const isDefault =
                    Boolean(a.is_default) || String(a.label || "").startsWith("Default · ");
                  const displayLabel = String(a.label || "Home").replace(/^Default · /i, "");
                  return (
                    <div
                      key={a.id}
                      style={{
                        background: WARM_CARD,
                        border: `1.5px solid ${isDefault ? DEEP_MAROON : BORDER_COLOR}`,
                        borderRadius: 14,
                        padding: 18,
                        boxShadow: "0 3px 10px rgba(0,0,0,0.03)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                        <strong style={{ fontSize: 15, color: DEEP_MAROON }}>
                          {displayLabel}
                        </strong>
                        {isDefault && (
                          <span
                            style={{
                              background: DEEP_MAROON,
                              color: "#FFFFFF",
                              padding: "3px 10px",
                              borderRadius: 999,
                              fontSize: 10,
                              fontWeight: 700,
                              textTransform: "uppercase",
                            }}
                          >
                            Default Address
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 13, color: "#1F2937", lineHeight: 1.6 }}>
                        <strong>{a.address?.name}</strong> · {a.address?.phone}
                        <br />
                        {a.address?.line1}
                        {a.address?.line2 ? `, ${a.address.line2}` : ""}
                        <br />
                        {a.address?.city}, {a.address?.state} – {a.address?.pin}
                      </div>
                      <div style={{ display: "flex", gap: 12, marginTop: 12, flexWrap: "wrap" }}>
                        {!isDefault && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void mutate("addresses", { id: a.id, set_default: true })}
                            className="text-link"
                            style={{ fontSize: 12, fontWeight: 600, color: DEEP_MAROON }}
                          >
                            Set as Default
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => startEditAddress(a)}
                          className="text-link"
                          style={{ fontSize: 12, fontWeight: 600 }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void mutate("addresses", { id: a.id, remove: true })}
                          className="text-link"
                          style={{ fontSize: 12, color: "#991B1B" }}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <form
            className="form-panel"
            onSubmit={handleSaveAddress}
            style={{ background: WARM_CARD, borderRadius: 14, border: `1px solid ${BORDER_COLOR}` }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h2 style={{ margin: 0, fontSize: 22, color: DEEP_MAROON }}>
                {editingAddress ? "Edit Address" : "Add New Address"}
              </h2>
              {editingAddress && (
                <button
                  type="button"
                  onClick={resetAddressForm}
                  className="text-link"
                  style={{ fontSize: 12 }}
                >
                  Cancel Edit
                </button>
              )}
            </div>

            <label>
              Address Label (e.g. Home, Office)
              <input
                value={addrLabel}
                onChange={(e) => setAddrLabel(e.target.value)}
                required
                maxLength={40}
              />
            </label>

            {addressFields.map(([k, labelText]) => (
              <label key={k}>
                {k === "phone" ? "Mobile Number (for delivery & WhatsApp billing)" : labelText}
                <input
                  value={addrValues[k] || ""}
                  onChange={(e) =>
                    setAddrValues((prev) => ({ ...prev, [k]: e.target.value }))
                  }
                  required={k !== "line2"}
                  maxLength={k === "pin" ? 6 : 180}
                />
              </label>
            ))}

            <label className="check" style={{ marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={addrDefault}
                onChange={(e) => setAddrDefault(e.target.checked)}
              />
              Set as default delivery address
            </label>

            <button
              type="submit"
              disabled={busy}
              className="button"
              style={{ width: "100%", background: DEEP_MAROON, borderColor: DEEP_MAROON }}
            >
              {busy ? "Saving…" : editingAddress ? "Update Address" : "Save Address"}
            </button>
          </form>
        </div>
      )}

      {/* TAB: PROFILE SETTINGS */}
      {tab === "profile" && (
        <div className="two-column">
          <form
            className="form-panel"
            onSubmit={handleSaveProfile}
            style={{ background: WARM_CARD, borderRadius: 14, border: `1px solid ${BORDER_COLOR}` }}
          >
            <h2 style={{ color: DEEP_MAROON, marginTop: 0 }}>Profile Details</h2>

            <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 18 }}>
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="Avatar preview"
                  style={{ width: 64, height: 64, borderRadius: "50%", objectFit: "cover", border: `2px solid ${DEEP_MAROON}` }}
                />
              ) : (
                <div
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: "50%",
                    background: DEEP_MAROON,
                    color: "#FFF",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 20,
                    fontWeight: 700,
                  }}
                >
                  {getInitials(displayName, emailInput)}
                </div>
              )}
              <div>
                <label style={{ margin: 0, cursor: "pointer" }}>
                  <span
                    className="button button-outline"
                    style={{ minHeight: 36, padding: "6px 14px", fontSize: 12 }}
                  >
                    Upload Profile Image
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    style={{ display: "none" }}
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (!file) return;
                      try {
                        const resized = await resizeImageToDataUrl(file);
                        setAvatarUrl(resized);
                      } catch (err) {
                        notice((err as Error).message);
                      }
                    }}
                  />
                </label>
                {avatarUrl && (
                  <button
                    type="button"
                    onClick={() => setAvatarUrl("")}
                    className="text-link"
                    style={{ display: "block", marginTop: 6, fontSize: 11, color: "#991B1B" }}
                  >
                    Remove photo
                  </button>
                )}
              </div>
            </div>

            <label>
              Full Name
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                required
                minLength={2}
                maxLength={80}
              />
            </label>

            <label>
              Email Address (changing email sends verification link)
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                required
                maxLength={254}
              />
            </label>

            <button
              type="submit"
              disabled={busy}
              className="button"
              style={{ width: "100%", background: DEEP_MAROON, borderColor: DEEP_MAROON }}
            >
              {busy ? "Saving…" : "Save Profile Changes"}
            </button>
          </form>

          <form
            className="form-panel"
            onSubmit={handleChangePassword}
            style={{ background: WARM_CARD, borderRadius: 14, border: `1px solid ${BORDER_COLOR}` }}
          >
            <h2 style={{ color: DEEP_MAROON, marginTop: 0 }}>Change Password</h2>
            <p style={{ fontSize: 13, color: "#6B7280" }}>
              Keep your Magarantham Silks account secure with a strong password.
            </p>
            <label>
              New Password
              <input
                type={showPwd ? "text" : "password"}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={6}
                maxLength={128}
                required
                placeholder="Minimum 6 characters"
              />
            </label>
            <label>
              Confirm New Password
              <input
                type={showPwd ? "text" : "password"}
                value={confirmNewPassword}
                onChange={(e) => setConfirmNewPassword(e.target.value)}
                minLength={6}
                maxLength={128}
                required
                placeholder="Re-enter new password"
              />
            </label>
            <label className="check" style={{ marginBottom: 16 }}>
              <input
                type="checkbox"
                checked={showPwd}
                onChange={(e) => setShowPwd(e.target.checked)}
              />
              Show passwords
            </label>
            <button
              type="submit"
              disabled={busy}
              className="button"
              style={{ width: "100%", background: DEEP_MAROON, borderColor: DEEP_MAROON }}
            >
              {busy ? "Updating…" : "Update Password"}
            </button>
          </form>
        </div>
      )}

      {/* TAB: SUPPORT */}
      {tab === "support" && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 18,
          }}
        >
          <div
            style={{
              background: WARM_CARD,
              border: `1px solid ${BORDER_COLOR}`,
              borderRadius: 14,
              padding: 24,
            }}
          >
            <h3 style={{ margin: "0 0 8px", color: DEEP_MAROON }}>Contact Support</h3>
            <p style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.6 }}>
              Have a question about silk care, sizing, or delivery? Reach our boutique team directly.
            </p>
            <div style={{ fontSize: 13, color: "#1F2937", display: "grid", gap: 6, marginTop: 12 }}>
              {settings?.support_email && (
                <div>
                  Email: <a href={`mailto:${settings.support_email}`} className="text-link">{settings.support_email}</a>
                </div>
              )}
              {settings?.support_phone && (
                <div>
                  Phone: <a href={`tel:${settings.support_phone}`} className="text-link">{settings.support_phone}</a>
                </div>
              )}
            </div>
          </div>

          <div
            style={{
              background: WARM_CARD,
              border: `1px solid ${BORDER_COLOR}`,
              borderRadius: 14,
              padding: 24,
            }}
          >
            <h3 style={{ margin: "0 0 8px", color: DEEP_MAROON }}>Order Help</h3>
            <p style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.6 }}>
              Track shipments, download GST invoices, or request a return from your order details page.
            </p>
            <button
              type="button"
              onClick={() => setTab("orders")}
              className="button button-outline"
              style={{ marginTop: 12, minHeight: 40, fontSize: 13 }}
            >
              Go to My Orders ↗
            </button>
          </div>

          {whatsappSupportUrl && (
            <div
              style={{
                background: WARM_CARD,
                border: `1px solid ${BORDER_COLOR}`,
                borderRadius: 14,
                padding: 24,
              }}
            >
              <h3 style={{ margin: "0 0 8px", color: DEEP_MAROON }}>WhatsApp Support</h3>
              <p style={{ fontSize: 13, color: "#4B5563", lineHeight: 1.6 }}>
                Chat with our team on WhatsApp for quick billing or saree inquiries.
              </p>
              <a
                href={whatsappSupportUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="button"
                style={{
                  marginTop: 12,
                  minHeight: 40,
                  fontSize: 13,
                  background: DEEP_MAROON,
                  borderColor: DEEP_MAROON,
                }}
              >
                Chat on WhatsApp ↗
              </a>
            </div>
          )}
        </div>
      )}

      {nextPage !== null && (tab === "orders" || tab === "wishlist" || tab === "addresses") && (
        <button
          type="button"
          className="button button-outline"
          disabled={busy}
          onClick={() => void loadTabResource(tab, nextPage)}
          style={{ marginTop: 16 }}
        >
          Load more
        </button>
      )}
    </section>
  );
}
