"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import Script from "next/script";
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
  const can = (cap: string) =>
    admin &&
    (profile?.role === "superadmin" || profile?.permissions.includes(cap));
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
      <div className="section-heading">
        <div>
          <p className="eyebrow">Order MS-{o.number}</p>
          <h1>{o.status.replaceAll("_", " ")}.</h1>
        </div>
        <div style={{ display: "flex", gap: "12px", alignItems: "center", flexWrap: "wrap" }}>
          <a
            href={`/api/orders/${o.id}/invoice`}
            download={`Invoice-MS-${o.number}.pdf`}
            className="button button-outline"
            style={{
              minHeight: "42px",
              padding: "10px 18px",
              gap: "8px",
              fontSize: "12px",
              textDecoration: "none",
            }}
          >
            Download Invoice 📄
          </a>
          {admin && (
            <button
              type="button"
              disabled={busy}
              onClick={() => action("retry-whatsapp", {})}
              className="button button-outline"
              style={{
                minHeight: "42px",
                padding: "10px 18px",
                gap: "8px",
                fontSize: "12px",
              }}
              title="Resend WhatsApp confirmation & PDF invoice"
            >
              Retry WhatsApp 📲
            </button>
          )}
          <div>
            <span className={`status status-${o.payment_status}`}>
              {o.payment_status.replaceAll("_", " ")}
            </span>
            <p>{new Date(o.created_at).toLocaleString("en-IN")}</p>
          </div>
        </div>
      </div>
      <div className="two-column">
        <div>
          <div className="form-panel">
            {o.order_items.map((i: Row) => (
              <div className="cart-line" key={i.id}>
                <img src={i.image_path} alt={i.name} />
                <div>
                  <h3>{i.name}</h3>
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
            <h2>Order updates.</h2>
            {[...o.order_events]
              .sort((a: Row, b: Row) =>
                b.created_at.localeCompare(a.created_at),
              )
              .map((e: Row) => (
                <div key={e.id}>
                  <span />
                  <p>
                    {e.message}
                    <small>
                      {new Date(e.created_at).toLocaleString("en-IN")}
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
                <h2>Payment.</h2>
                <p>
                  Final total: <b>{money(o.total_paise)}</b>
                </p>
                <p className="subtle">
                  Stock hold ends{" "}
                  {new Date(o.expires_at).toLocaleString("en-IN")}. Do not pay
                  after this time.
                </p>
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
