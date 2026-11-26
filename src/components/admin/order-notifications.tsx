"use client";
import React, { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { money } from "@/lib/core";
import { createSupabaseBrowserClient } from "@/lib/supabase-browser";
import { api } from "../api";

export type AdminNotification = {
  id: string;
  order_id: string;
  order_number: number;
  customer_name: string;
  customer_phone: string;
  item_count: number;
  total_paise: number;
  is_read: boolean;
  created_at: string;
};

function playOrderChime() {
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;
    const notes = [587.33, 880, 1174.66]; // D5, A5, D6
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq, now + idx * 0.11);
      gain.gain.setValueAtTime(0.001, now + idx * 0.11);
      gain.gain.exponentialRampToValueAtTime(0.14, now + idx * 0.11 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.11 + 0.35);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + idx * 0.11);
      osc.stop(now + idx * 0.11 + 0.36);
    });
  } catch {
    // Browser autoplay policy may block until user interacts
  }
}

const SEEN_STORAGE_KEY = "ms_seen_admin_notifs_v1";

function getSeenSet(): Set<string> {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

function saveSeenSet(set: Set<string>) {
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Array.from(set).slice(-100)));
  } catch {}
}

export function OrderNotificationsManager({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const [notifications, setNotifications] = useState<AdminNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [activePopup, setActivePopup] = useState<AdminNotification | null>(null);
  const initializedRef = useRef(false);
  const seenOrdersRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!enabled) return;
    seenOrdersRef.current = getSeenSet();

    function handleIncoming(n: AdminNotification, isInitialLoad: boolean) {
      if (seenOrdersRef.current.has(n.order_id)) return;
      seenOrdersRef.current.add(n.order_id);
      saveSeenSet(seenOrdersRef.current);

      if (!isInitialLoad && !n.is_read) {
        setActivePopup(n);
        if (soundEnabled) playOrderChime();
      }
    }

    async function fetchNotifications() {
      try {
        const res = await api<{
          notifications: AdminNotification[];
          unreadCount: number;
        }>("/api/admin/notifications");
        const list = res.notifications || [];
        setNotifications(list);
        setUnreadCount(res.unreadCount || 0);

        const isInitial = !initializedRef.current;
        initializedRef.current = true;
        for (const item of list) {
          handleIncoming(item, isInitial);
        }
      } catch {
        // Ignore transient fetch errors
      }
    }

    void fetchNotifications();
    const poll = setInterval(() => {
      if (document.visibilityState === "visible") void fetchNotifications();
    }, 12000);

    // Supabase Realtime subscription
    const supabase = createSupabaseBrowserClient();
    const channel = supabase
      ? supabase
          .channel("admin-order-notifications")
          .on(
            "postgres_changes",
            { event: "INSERT", schema: "public", table: "admin_notifications" },
            (payload) => {
              const row = payload.new as AdminNotification;
              if (!row?.order_id) return;
              setNotifications((prev) => {
                if (prev.some((x) => x.order_id === row.order_id)) return prev;
                return [row, ...prev].slice(0, 30);
              });
              setUnreadCount((c) => c + 1);
              handleIncoming(row, false);
            },
          )
          .subscribe()
      : null;

    return () => {
      clearInterval(poll);
      if (channel && supabase) {
        void supabase.removeChannel(channel);
      }
    };
  }, [enabled, soundEnabled]);

  if (!enabled) return null;

  async function markRead(id: string) {
    try {
      await api("/api/admin/notifications", { id });
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch {}
  }

  async function markAllRead() {
    try {
      await api("/api/admin/notifications", { markAllRead: true });
      setNotifications((prev) => prev.map((n) => ({ ...n, is_read: true })));
      setUnreadCount(0);
    } catch {}
  }

  function openOrder(n: AdminNotification, hash = "") {
    if (!n.is_read) void markRead(n.id);
    setActivePopup(null);
    setHistoryOpen(false);
    router.push(`/admin/orders/${n.order_id}${hash}`);
  }

  return (
    <>
      {/* Topbar Bell & History Dropdown */}
      <div style={{ position: "relative" }}>
        <button
          type="button"
          className="ms-icon-btn"
          onClick={() => setHistoryOpen((o) => !o)}
          aria-label={`Order notifications (${unreadCount} unread)`}
          title="Order Notifications"
          style={{ position: "relative" }}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" aria-hidden="true">
            <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {unreadCount > 0 && (
            <span
              style={{
                position: "absolute",
                top: -4,
                right: -4,
                minWidth: 18,
                height: 18,
                padding: "0 5px",
                borderRadius: 999,
                background: "#800020",
                color: "#FFFFFF",
                fontSize: 11,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "2px solid #FFFDF9",
              }}
            >
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {historyOpen && (
          <div
            style={{
              position: "absolute",
              top: "calc(100% + 10px)",
              right: 0,
              width: 360,
              maxWidth: "90vw",
              background: "#FFFFFF",
              border: "1px solid #EAD5C0",
              borderRadius: 12,
              boxShadow: "0 18px 40px rgba(0,0,0,0.16)",
              zIndex: 9990,
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "12px 16px",
                background: "#FAF5EE",
                borderBottom: "1px solid #EAD5C0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 8,
              }}
            >
              <strong style={{ fontSize: 13, color: "#6B1724" }}>
                Order Notifications ({unreadCount} new)
              </strong>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => setSoundEnabled((s) => !s)}
                  style={{
                    background: "none",
                    border: "1px solid #D4B99F",
                    borderRadius: 6,
                    padding: "3px 8px",
                    fontSize: 11,
                    cursor: "pointer",
                    color: "#4B5563",
                  }}
                  title="Toggle notification sound"
                >
                  {soundEnabled ? "🔔 Sound On" : "🔕 Muted"}
                </button>
                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllRead}
                    style={{
                      background: "none",
                      border: "none",
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#800020",
                      cursor: "pointer",
                      textDecoration: "underline",
                    }}
                  >
                    Mark all read
                  </button>
                )}
              </div>
            </div>

            <div style={{ maxHeight: 340, overflowY: "auto" }}>
              {notifications.length === 0 ? (
                <div style={{ padding: 24, textAlign: "center", fontSize: 13, color: "#6B7280" }}>
                  No order notifications yet.
                </div>
              ) : (
                notifications.map((n) => (
                  <div
                    key={n.id}
                    onClick={() => openOrder(n)}
                    style={{
                      padding: "12px 16px",
                      borderBottom: "1px solid #F3EAE0",
                      background: n.is_read ? "#FFFFFF" : "#FFFBEB",
                      cursor: "pointer",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "flex-start",
                      gap: 10,
                    }}
                  >
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: "#1F2937" }}>
                        Order #MS-{n.order_number} · {n.customer_name}
                      </div>
                      <div style={{ fontSize: 12, color: "#4B5563", marginTop: 2 }}>
                        {n.item_count} item(s) · {money(n.total_paise)}
                        {n.customer_phone ? ` · ${n.customer_phone}` : ""}
                      </div>
                      <div style={{ fontSize: 11, color: "#9CA3AF", marginTop: 4 }}>
                        {new Date(n.created_at).toLocaleString("en-IN")}
                      </div>
                    </div>
                    {!n.is_read && (
                      <span
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: "50%",
                          background: "#800020",
                          marginTop: 6,
                          flexShrink: 0,
                        }}
                      />
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Incoming Order Popup */}
      {activePopup && (
        <div
          role="alertdialog"
          aria-labelledby="new-order-popup-title"
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            width: 360,
            maxWidth: "calc(100vw - 32px)",
            background: "#FFFFFF",
            border: "2px solid #800020",
            borderRadius: 14,
            boxShadow: "0 20px 50px rgba(107, 23, 36, 0.28)",
            zIndex: 9999,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #800020 0%, #580016 100%)",
              color: "#FFFFFF",
              padding: "12px 16px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              borderBottom: "2px solid #C49A52",
            }}
          >
            <strong id="new-order-popup-title" style={{ fontSize: 13, letterSpacing: "0.06em" }}>
              🔔 NEW ORDER RECEIVED!
            </strong>
            <button
              type="button"
              onClick={() => setActivePopup(null)}
              aria-label="Dismiss notification"
              style={{
                background: "none",
                border: "none",
                color: "#FFFFFF",
                cursor: "pointer",
                fontSize: 15,
              }}
            >
              ✕
            </button>
          </div>
          <div style={{ padding: "16px" }}>
            <div style={{ display: "grid", gap: 6, fontSize: 13, color: "#1F2937" }}>
              <div>
                <strong>Order ID:</strong> #MS-{activePopup.order_number}
              </div>
              <div>
                <strong>Customer:</strong> {activePopup.customer_name}
              </div>
              <div>
                <strong>Mobile:</strong> {activePopup.customer_phone || "—"}
              </div>
              <div>
                <strong>Items:</strong> {activePopup.item_count}
              </div>
              <div style={{ fontSize: 15, color: "#800020", fontWeight: 700, marginTop: 2 }}>
                Total: {money(activePopup.total_paise)}
              </div>
            </div>
            <div style={{ display: "flex", gap: 10, marginTop: 14 }}>
              <button
                type="button"
                onClick={() => openOrder(activePopup)}
                style={{
                  flex: 1,
                  background: "#800020",
                  color: "#FFFFFF",
                  border: "none",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                VIEW ORDER
              </button>
              <button
                type="button"
                onClick={() => openOrder(activePopup, "#whatsapp-bill")}
                style={{
                  flex: 1,
                  background: "#FAF5EE",
                  color: "#6B1724",
                  border: "1px solid #C49A52",
                  borderRadius: 8,
                  padding: "10px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                PREPARE BILL
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
