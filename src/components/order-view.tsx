"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { useSearchParams } from "next/navigation";
import { Profile, money } from "@/lib/core";
import { api } from "./api";
import { useShop } from "./shop-context";
type Row = Record<string, any>;
export function OrderView({
  id,
  admin = false,
}: {
  id: string;
  admin?: boolean;
}) {
  const searchParams = useSearchParams();
  const isNewlyPlaced = searchParams.get("placed") === "1";
  const [data, setData] = useState<Row | null>(null),
    [busy, setBusy] = useState(false),
    [providers, setProviders] = useState<Row[]>([]),
    [proofs, setProofs] = useState<Row[]>([]),
    [loadError, setLoadError] = useState(""),
    [now, setNow] = useState(Date.now());
  const { notice } = useShop();
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(timer);
  }, []);
  const base = admin ? `/api/admin/orders/${id}` : `/api/orders/${id}`;
  async function load() {
    try {
      setData(await api(`${base}/view`));
      setLoadError("");
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
    if (admin)
      api<{
        rows: Row[];
      }>("/api/admin/tracking_providers")
        .then((r) => setProviders(r.rows.filter((x) => x.enabled)))
        .catch(() => {});
  }, [id, admin]);
  async function action(name: string, payload: unknown) {
    setBusy(true);
    try {
      const r = await api<Row>(`${base}/${name}`, payload);
      notice(r.message || "Updated.");
      await load();
    } catch (e) {
      notice((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section className="section">
        <p role="status">{loadError || "Loading order…"}</p>
        <Link className="text-link" href={admin ? "/admin/orders" : "/account"}>
          Back to orders
        </Link>
      </section>
    );
  const o = data.order;
  const profile = data.profile as Profile | undefined;
  const whatsappNotif = data.whatsappNotification as Row | null | undefined;
  const storeSettings = data.storeSettings as Row | null | undefined;
  const skuMap = (data.skuMap || {}) as Record<string, string>;
  const customerEmail = (data.customerEmail as string) || "";
  const whatsappClickToChatUrl = (data.whatsappClickToChatUrl as string) || "";
  const can = (cap: string) =>
    admin &&
    (profile?.role === "superadmin" || profile?.permissions.includes(cap));
  const waStatus = whatsappNotif?.status || o.whatsapp_status || "pending";
  const waSentAt = whatsappNotif?.sent_at || o.whatsapp_sent_at || null;
  const waError = whatsappNotif?.error_message || o.whatsapp_error || "";
  const invoiceNumber = o.invoice_number || `${storeSettings?.invoice_prefix || "MS-INV-"}${o.number}`;
  async function pay() {
    setBusy(true);
    try {
      const r = await api<Row>(`${base}/gateway`, {});
      if (!window.Razorpay)
        throw new Error(
          "Payment checkout is still loading. Try again shortly.",
        );
      const checkout = new window.Razorpay({
        key: r.key,
        order_id: r.order_id,
        amount: r.amount,
        currency: "INR",
        name: "மகரந்தம் சில்க்ஸ்",
        description: `Order MS-${o.number}`,
        config: {
          display: {
            blocks: {
              upi: { name: "Pay using UPI", instruments: [{ method: "upi" }] },
            },
            sequence: ["block.upi"],
            preferences: { show_default_blocks: false },
          },
        },
        handler: async (response: Row) => {
          await action("verify", {
            payment_id: response.razorpay_payment_id,
            signature: response.razorpay_signature,
          });
        },
        modal: {
          ondismiss: () => {
            setBusy(false);
            notice(
              "Payment window closed. Check your order before paying again.",
            );
          },
        },
      });
      checkout.open();
    } catch (e) {
      notice((e as Error).message);
      setBusy(false);
    }
  }
  function formAction(
    e: FormEvent<HTMLFormElement>,
    name: string,
    build: (f: FormData) => unknown,
  ) {
    e.preventDefault();
    void action(name, build(new FormData(e.currentTarget)));
  }
  return (
    <section className="section order-page">
      <Link className="text-link" href={admin ? "/admin/orders" : "/account"}>
        ← Back to orders
      </Link>

      {/* Customer Order Confirmation Banner */}
      {!admin && isNewlyPlaced && (
        <div
          style={{
            marginTop: 18,
            marginBottom: 24,
            padding: "28px 26px",
            background: "linear-gradient(135deg, #FFFDF9 0%, #FAF5EE 100%)",
            border: "2px solid #C49A52",
            borderRadius: 14,
            boxShadow: "0 12px 30px rgba(107, 23, 36, 0.08)",
          }}
        >
          <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 16 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: "0.1em", color: "#15803D", textTransform: "uppercase" }}>
                ✓ ORDER PLACED SUCCESSFULLY!
              </div>
              <h2 style={{ margin: "6px 0 4px", fontSize: 26, color: "#6B1724" }}>
                Thank you for shopping with Magarantham.
              </h2>
              <p style={{ margin: 0, fontSize: 14, color: "#4B5563" }}>
                Order ID: <strong style={{ color: "#800020" }}>#MS-{o.number}</strong> · Estimated Delivery:{" "}
                <strong>3–5 business days</strong> across India
              </p>
            </div>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Link href="/shop" className="button" style={{ minHeight: 42, padding: "10px 18px", fontSize: 13 }}>
                CONTINUE SHOPPING
              </Link>
              <Link href="/account" className="button button-outline" style={{ minHeight: 42, padding: "10px 18px", fontSize: 13 }}>
                VIEW MY ORDERS
              </Link>
            </div>
          </div>
        </div>
      )}

      <div className="section-heading">
        <div>
          <p className="eyebrow" style={{ marginBottom: 4 }}>Order #MS-{o.number}</p>
          <h1>{o.status.replaceAll("_", " ")}.</h1>
        </div>
        <div
          style={{
            display: "flex",
            gap: "16px",
            alignItems: "center",
            flexWrap: "wrap",
            justifyContent: "flex-end",
          }}
        >
          <a
            href={`/api/orders/${o.id}/invoice`}
            download={`Invoice-MS-${o.number}.pdf`}
            className="button button-outline"
            style={{
              minHeight: "42px",
              padding: "10px 18px",
              gap: "8px",
              fontSize: "13px",
              textDecoration: "none",
            }}
          >
            Download Invoice 📄
          </a>
          <div style={{ textAlign: "right" }}>
            <span
              className={`status status-${o.payment_status}`}
              style={{ display: "inline-block", marginBottom: 4 }}
            >
              {o.payment_status.replaceAll("_", " ")}
            </span>
            <p style={{ margin: 0, fontSize: 12, color: "#6B7280" }}>
              {new Date(o.created_at).toLocaleString("en-IN")}
            </p>
          </div>
        </div>
      </div>

      {/* Customer Visual Order Progress Stepper */}
      {!admin && !["cancelled", "expired", "returned", "return_requested"].includes(o.status) && (
        <div
          style={{
            background: "#FFFDF9",
            border: "1px solid #EAD5C0",
            borderRadius: 14,
            padding: "20px 24px",
            marginBottom: 24,
            boxShadow: "0 4px 16px rgba(121, 5, 30, 0.04)",
          }}
        >
          {(() => {
            const steps = [
              { key: "awaiting_payment", label: "Order Placed", icon: "🛍️" },
              { key: "confirmed", label: "Confirmed", icon: "✓" },
              { key: "packing", label: "Packing", icon: "📦" },
              { key: "shipped", label: "Shipped", icon: "🚚" },
              { key: "delivered", label: "Delivered", icon: "✨" },
            ];
            const currentIdx = Math.max(
              0,
              steps.findIndex((st) => st.key === o.status),
            );
            return (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
                  gap: 8,
                  alignItems: "center",
                }}
              >
                {steps.map((st, idx) => {
                  const done = idx <= currentIdx;
                  const active = idx === currentIdx;
                  return (
                    <div key={st.key} style={{ textAlign: "center", position: "relative" }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: "50%",
                          margin: "0 auto 8px",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 15,
                          fontWeight: 700,
                          background: done ? "#79051E" : "#FAF5EE",
                          color: done ? "#FFFFFF" : "#9CA3AF",
                          border: active
                            ? "3px solid #C49A52"
                            : done
                              ? "2px solid #79051E"
                              : "1px solid #EAD5C0",
                          boxShadow: active ? "0 0 0 4px rgba(196, 154, 82, 0.2)" : "none",
                        }}
                      >
                        {st.icon}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          fontWeight: active ? 700 : done ? 600 : 400,
                          color: done ? "#79051E" : "#9CA3AF",
                        }}
                      >
                        {st.label}
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Admin Structured Customer / Payment / Delivery Cards */}
      {admin && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
            marginBottom: 24,
          }}
        >
          <div className="form-panel" style={{ margin: 0, padding: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#800020", letterSpacing: "0.08em", marginBottom: 8 }}>
              CUSTOMER INFORMATION
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#1F2937" }}>{o.address?.name || "Customer"}</div>
            {customerEmail && <div style={{ fontSize: 13, color: "#4B5563", marginTop: 2 }}>{customerEmail}</div>}
            <div style={{ fontSize: 13, color: "#4B5563", marginTop: 2 }}>
              Mobile: <strong>{o.customer_phone || o.address?.phone || "—"}</strong>
            </div>
            <div style={{ fontSize: 12, color: "#6B7280", marginTop: 6, lineHeight: 1.5 }}>
              {o.address?.line1} {o.address?.line2}
              <br />
              {o.address?.city}, {o.address?.state} – {o.address?.pin}
            </div>
          </div>

          <div className="form-panel" style={{ margin: 0, padding: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#800020", letterSpacing: "0.08em", marginBottom: 8 }}>
              PAYMENT INFORMATION
            </div>
            <div style={{ fontSize: 13, color: "#374151", display: "grid", gap: 4 }}>
              <div>Method: <strong style={{ textTransform: "uppercase" }}>{o.channel}</strong></div>
              <div>Status: <strong style={{ textTransform: "capitalize" }}>{o.payment_status.replaceAll("_", " ")}</strong></div>
              <div>Reference: <code>{o.provider_payment_id || o.payment_reference || "—"}</code></div>
              <div>Total Paid / Due: <strong style={{ color: "#800020" }}>{money(o.total_paise)}</strong></div>
            </div>
          </div>

          <div className="form-panel" style={{ margin: 0, padding: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#800020", letterSpacing: "0.08em", marginBottom: 8 }}>
              DELIVERY INFORMATION
            </div>
            <div style={{ fontSize: 13, color: "#374151", display: "grid", gap: 4 }}>
              <div>Delivery Status: <strong style={{ textTransform: "capitalize" }}>{o.status.replaceAll("_", " ")}</strong></div>
              <div>Tracking ID: <strong>{o.tracking_id || "Not assigned yet"}</strong></div>
              <div>Destination: {o.address?.city}, {o.address?.state} {o.address?.pin}</div>
            </div>
          </div>
        </div>
      )}

      {/* Admin WhatsApp Bill Section */}
      {admin && (
        <div
          id="whatsapp-bill"
          style={{
            marginBottom: 28,
            background: "#FFFFFF",
            border: "2px solid #C49A52",
            borderRadius: 14,
            overflow: "hidden",
            boxShadow: "0 10px 28px rgba(107, 23, 36, 0.08)",
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #6B1724 0%, #4A0E17 100%)",
              color: "#FFFFFF",
              padding: "14px 20px",
              display: "flex",
              flexWrap: "wrap",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 11, letterSpacing: "0.1em", color: "#FDE047", fontWeight: 700 }}>
                WHATSAPP BILL SECTION · GST-READY INVOICE
              </div>
              <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>
                Order #MS-{o.number} · {o.address?.name || "Customer"} ({o.customer_phone || o.address?.phone || "No mobile"})
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span
                style={{
                  padding: "5px 12px",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  background:
                    waStatus === "sent" || waStatus === "delivered"
                      ? "#166534"
                      : waStatus === "failed"
                        ? "#991B1B"
                        : "#92400E",
                  color: "#FFFFFF",
                }}
              >
                WhatsApp: {waStatus}
              </span>
            </div>
          </div>

          <div style={{ padding: 20 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
                gap: 14,
                marginBottom: 16,
                padding: 14,
                background: "#FAF5EE",
                borderRadius: 10,
                border: "1px solid #EAD5C0",
                fontSize: 13,
              }}
            >
              <div>
                <strong>Invoice No:</strong> {invoiceNumber}
              </div>
              <div>
                <strong>Customer WhatsApp:</strong> {o.customer_phone || o.address?.phone || "—"}
              </div>
              <div>
                <strong>GSTIN:</strong> {storeSettings?.gstin || "Configurable in Store Settings"}
              </div>
              <div>
                <strong>Sent Timestamp:</strong>{" "}
                {waSentAt ? new Date(waSentAt).toLocaleString("en-IN") : "Not sent yet"}
              </div>
            </div>

            {waError && (
              <div
                style={{
                  marginBottom: 16,
                  padding: "10px 14px",
                  borderRadius: 8,
                  background: "#FEF2F2",
                  border: "1px solid #FECACA",
                  color: "#991B1B",
                  fontSize: 12,
                }}
              >
                <strong>WhatsApp Status Note:</strong> {waError}
              </div>
            )}

            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const res = await api<Row>(`${base}/generate-invoice`, {});
                    notice(res.message || "Invoice PDF generated.");
                    await load();
                    window.open(`/api/orders/${o.id}/invoice`, "_blank", "noopener,noreferrer");
                  } catch (err) {
                    notice((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
                className="button button-outline"
                style={{ minHeight: 44, padding: "10px 18px", fontSize: 13 }}
              >
                GENERATE INVOICE PDF 📄
              </button>

              <button
                type="button"
                disabled={busy}
                onClick={() => action("send-whatsapp", {})}
                className="button"
                style={{ minHeight: 44, padding: "10px 18px", fontSize: 13 }}
              >
                SEND BILL ON WHATSAPP 📲
              </button>

              {whatsappClickToChatUrl && (
                <a
                  href={whatsappClickToChatUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="button button-outline"
                  style={{ minHeight: 44, padding: "10px 18px", fontSize: 13, textDecoration: "none" }}
                >
                  Open WhatsApp Click-to-Chat ↗
                </a>
              )}
            </div>
          </div>
        </div>
      )}

      <div className="two-column">
        <div>
          <div className="form-panel">
            {o.order_items.map((i: Row) => (
              <div className="cart-line" key={i.id}>
                <img
                  src={i.image_path || "/assets/product-01.jpg"}
                  alt={i.name}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).src = "/assets/product-01.jpg";
                  }}
                />
                <div>
                  <h3>{i.name}</h3>
                  {admin && skuMap[i.product_id] && (
                    <p style={{ fontSize: 11, color: "#6B7280", margin: "0 0 2px" }}>
                      SKU: {skuMap[i.product_id]}
                    </p>
                  )}
                  <p>
                    {i.quantity} × {money(i.unit_price_paise)}
                  </p>
                </div>
                <b>{money(i.line_total_paise)}</b>
              </div>
            ))}
            {[
              ["Items", o.subtotal_paise],
              ["Discount", -o.discount_paise],
              ["Delivery", o.shipping_paise],
              ["Tax", o.tax_paise],
              ["Total", o.total_paise],
            ].map(([l, v]) => (
              <div className="total-row" key={String(l)}>
                <span>{l}</span>
                <b>{money(Number(v))}</b>
              </div>
            ))}
            <h3>Delivery address</h3>
            <p>
              {o.address.name}
              <br />
              {o.address.line1} {o.address.line2}
              <br />
              {o.address.city}, {o.address.state} {o.address.pin}
              <br />
              {o.address.phone}
            </p>
            {o.tracking_id && (
              <p>
                Tracking ID: <b>{o.tracking_id}</b>
              </p>
            )}
            {data.tracking_url && (
              <a
                href={data.tracking_url}
                target="_blank"
                rel="noopener noreferrer"
                className="button button-outline"
              >
                Track with {data.tracking_provider} ↗
              </a>
            )}
            <p className="subtle">Order reference: {o.id}</p>
          </div>
          <div className="timeline">
            <h2>Order Updates</h2>
            {[...o.order_events]
              .sort((a: Row, b: Row) =>
                b.created_at.localeCompare(a.created_at),
              )
              .map((e: Row, idx: number) => (
                <div key={e.id}>
                  <span />
                  <p>
                    {idx === 0 && (
                      <span
                        style={{
                          display: "inline-block",
                          marginRight: 8,
                          padding: "2px 8px",
                          borderRadius: 999,
                          background: "#FEF3C7",
                          color: "#92400E",
                          fontSize: 10,
                          fontWeight: 700,
                          textTransform: "uppercase",
                          verticalAlign: "middle",
                        }}
                      >
                        Latest
                      </span>
                    )}
                    {e.message}
                    <small>
                      {new Date(e.created_at).toLocaleString("en-IN", {
                        day: "2-digit",
                        month: "short",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </small>
                  </p>
                </div>
              ))}
          </div>
        </div>
        <div>
          {!admin && (
            <>
              <div className="form-panel">
                <h2 style={{ marginBottom: 14 }}>Payment.</h2>
                <p style={{ marginBottom: 10 }}>
                  Final total: <b style={{ color: "var(--wine)", fontSize: 16 }}>{money(o.total_paise)}</b>
                </p>
                {o.payment_status === "paid" ? (
                  <div
                    style={{
                      padding: "10px 14px",
                      borderRadius: 8,
                      background: "#ECFDF5",
                      border: "1px solid #A7F3D0",
                      color: "#065F46",
                      fontSize: 13,
                      fontWeight: 600,
                    }}
                  >
                    ✓ Payment confirmed
                    {o.paid_at ? ` on ${new Date(o.paid_at).toLocaleString("en-IN")}` : ""}
                  </div>
                ) : (
                  o.status === "awaiting_payment" && (
                    <p className="subtle" style={{ marginBottom: 12 }}>
                      Stock hold ends{" "}
                      {new Date(o.expires_at).toLocaleString("en-IN")}. Do not pay
                      after this time.
                    </p>
                  )
                )}
                {o.payment_status === "late_paid" && (
                  <p>
                    Your payment needs staff review because the stock hold
                    ended. Please contact the store for your refund.
                  </p>
                )}
                {o.status === "awaiting_payment" &&
                  Date.parse(o.expires_at) > now && (
                    <>
                      {o.channel === "whatsapp" && data.whatsapp_url && (
                        <>
                          <p>
                            Your order is saved. Open WhatsApp and press Send.
                            Staff will tell you how to pay and check your
                            payment manually.
                          </p>
                          <a
                            className="button"
                            href={data.whatsapp_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Send order on WhatsApp ↗
                          </a>
                        </>
                      )}
                      {o.channel === "upi" && (
                        <>
                          <p>
                            Payee: <b>{data.upi_name}</b>
                            <br />
                            UPI ID: <b>{data.upi_id}</b>
                          </p>
                          <a className="button" href={data.upi_url}>
                            Open UPI app ↗
                          </a>
                          <p className="subtle">
                            On a computer, use the UPI ID and exact amount in
                            your phone’s payment app.
                          </p>
                        </>
                      )}
                      {o.channel === "razorpay" && (
                        <>
                          <Script src="https://checkout.razorpay.com/v1/checkout.js" />
                          <button
                            className="button"
                            disabled={busy}
                            onClick={pay}
                          >
                            Pay by UPI ↗
                          </button>
                          <p className="subtle">
                            If payment was taken but your order is not updated,
                            refresh after a minute or contact the store with
                            your payment ID. Do not pay twice.
                          </p>
                        </>
                      )}
                    </>
                  )}
                {o.channel !== "razorpay" &&
                  ["pending", "submitted", "failed"].includes(
                    o.payment_status,
                  ) &&
                  ["awaiting_payment", "expired", "cancelled"].includes(
                    o.status,
                  ) && (
                    <form
                      onSubmit={async (e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        f.set("kind", "proof");
                        f.set("order_id", id);
                        setBusy(true);
                        try {
                          const r = await api<Row>(
                            "/api/uploads",
                            undefined,
                            f,
                          );
                          notice(r.message);
                          await load();
                        } catch (error) {
                          notice((error as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <h3>Already paid? Send proof.</h3>
                      <label>
                        UPI transaction reference / UTR
                        <input
                          name="reference"
                          minLength={6}
                          maxLength={80}
                          required
                        />
                      </label>
                      <label>
                        Payment screenshot (JPEG, PNG or WebP, up to 5 MB)
                        <input
                          type="file"
                          name="file"
                          accept="image/jpeg,image/png,image/webp"
                          required
                        />
                      </label>
                      <button disabled={busy} className="button button-outline">
                        Submit payment proof
                      </button>
                      <p className="subtle">
                        A screenshot does not confirm payment. Staff must check
                        the bank record.
                      </p>
                    </form>
                  )}
              </div>
              {o.status === "awaiting_payment" && (
                <button
                  disabled={busy}
                  className="button button-outline"
                  onClick={() =>
                    action("status", {
                      status: "cancelled",
                      note: "Cancelled by customer",
                    })
                  }
                >
                  Cancel unpaid order
                </button>
              )}
              {o.status === "delivered" && (
                <form
                  className="form-panel"
                  onSubmit={(e) =>
                    formAction(e, "status", (f) => ({
                      status: "return_requested",
                      note: f.get("note"),
                    }))
                  }
                >
                  <label>
                    Reason for return
                    <textarea name="note" maxLength={500} required />
                  </label>
                  <button disabled={busy} className="button button-outline">
                    Request a return
                  </button>
                </form>
              )}
            </>
          )}
          {can("payments") && (
            <div className="form-panel">
              <h2>Payment check.</h2>
              <button
                className="text-link"
                onClick={async () => {
                  try {
                    const r = await api<{
                      rows: Row[];
                    }>(`${base}/proofs`);
                    setProofs(r.rows);
                  } catch (e) {
                    notice((e as Error).message);
                  }
                }}
              >
                View payment proofs
              </button>
              {proofs.map((p) => (
                <p key={p.id}>
                  {p.reference} ·{" "}
                  <a
                    href={p.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-link"
                  >
                    Open private proof (60 seconds) ↗
                  </a>
                </p>
              ))}
              {o.channel !== "razorpay" &&
                ["pending", "submitted", "failed"].includes(
                  o.payment_status,
                ) && (
                  <form
                    onSubmit={(e) =>
                      formAction(e, "confirm", (f) => ({
                        reference: f.get("reference"),
                        bank_checked: f.get("checked") === "on",
                      }))
                    }
                  >
                    <label>
                      Bank payment reference
                      <input
                        name="reference"
                        required
                        minLength={6}
                        maxLength={80}
                      />
                    </label>
                    <label className="check">
                      <input name="checked" type="checkbox" required />I checked
                      the bank record, payee and exact amount. This payment is
                      received.
                    </label>
                    <button className="button" disabled={busy}>
                      Confirm manual payment
                    </button>
                  </form>
                )}
              {o.channel === "razorpay" && (
                <form
                  onSubmit={(e) =>
                    formAction(e, "reconcile", (f) => ({
                      payment_id: f.get("payment_id"),
                    }))
                  }
                >
                  <label>
                    Razorpay payment ID
                    <input name="payment_id" required placeholder="pay_…" />
                  </label>
                  <button disabled={busy} className="button button-outline">
                    Verify gateway payment
                  </button>
                </form>
              )}
              {["refund_pending", "late_paid"].includes(o.payment_status) &&
                (o.channel !== "razorpay" || !(o.refunds || []).length) && (
                  <form
                    onSubmit={(e) =>
                      formAction(e, "refund", (f) => ({
                        note: f.get("note"),
                        reference: f.get("reference") || "",
                        bank_checked: f.get("checked") === "on",
                      }))
                    }
                  >
                    <h3>Full refund</h3>
                    <label>
                      Refund reason
                      <textarea
                        name="note"
                        minLength={3}
                        maxLength={500}
                        required
                      />
                    </label>
                    {o.channel !== "razorpay" && (
                      <>
                        <label>
                          Completed bank refund reference
                          <input name="reference" minLength={6} required />
                        </label>
                        <label className="check">
                          <input name="checked" type="checkbox" required />I
                          have completed the refund outside the app and checked
                          the bank record.
                        </label>
                      </>
                    )}
                    <button disabled={busy} className="button">
                      {o.channel === "razorpay"
                        ? "Start full gateway refund"
                        : "Record completed manual refund"}
                    </button>
                  </form>
                )}
              {o.channel === "razorpay" &&
                (o.refunds || []).length > 0 &&
                o.payment_status !== "refunded" && (
                  <form
                    onSubmit={(e) =>
                      formAction(e, "refund-check", (f) => ({
                        refund_id: f.get("refund_id"),
                      }))
                    }
                  >
                    <p>
                      Refund status: {o.refunds[0].status}. Verify an existing
                      refund; do not start another one.
                    </p>
                    <label>
                      Razorpay refund ID
                      <input
                        name="refund_id"
                        required
                        defaultValue={o.refunds[0].provider_refund_id || ""}
                        placeholder="rfnd_…"
                      />
                    </label>
                    <button disabled={busy} className="button button-outline">
                      Check existing refund
                    </button>
                  </form>
                )}
            </div>
          )}
          {can("shipping") && (
            <form
              className="form-panel"
              onSubmit={(e) =>
                formAction(e, "tracking", (f) => ({
                  provider_id: f.get("provider_id"),
                  tracking_id: f.get("tracking_id"),
                }))
              }
            >
              <h2>Tracking.</h2>
              <label>
                Provider
                <select
                  name="provider_id"
                  required
                  defaultValue={o.tracking_provider_id || ""}
                >
                  <option value="">Select provider</option>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Tracking ID
                <input
                  name="tracking_id"
                  defaultValue={o.tracking_id}
                  minLength={2}
                  maxLength={100}
                  required
                />
              </label>
              <button disabled={busy} className="button">
                Save tracking
              </button>
            </form>
          )}
          {can("orders") && (
            <form
              className="form-panel"
              onSubmit={(e) =>
                formAction(e, "status", (f) => ({
                  status: f.get("status"),
                  note: f.get("note"),
                }))
              }
            >
              <h2>Order status.</h2>
              <label>
                Next status
                <select name="status">
                  {(o.status === "awaiting_payment"
                    ? ["cancelled"]
                    : o.status === "confirmed"
                      ? ["packing", "cancelled"]
                      : o.status === "packing"
                        ? ["shipped", "cancelled"]
                        : o.status === "shipped"
                          ? ["delivered"]
                          : o.status === "delivered"
                            ? ["return_requested"]
                            : o.status === "return_requested"
                              ? ["returned"]
                              : []
                  ).map((v) => (
                    <option key={v} value={v}>
                      {v.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Update note / received return details
                <textarea
                  name="note"
                  maxLength={500}
                  required={o.status === "return_requested"}
                  minLength={o.status === "return_requested" ? 3 : 0}
                />
              </label>
              <p className="subtle">
                Mark returned only after receiving and checking the physical
                sarees. A tracking ID is required before shipping.
              </p>
              <button
                className="button"
                disabled={
                  busy ||
                  [
                    "cancelled",
                    "expired",
                    "review_required",
                    "returned",
                  ].includes(o.status)
                }
              >
                Update order status
              </button>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
