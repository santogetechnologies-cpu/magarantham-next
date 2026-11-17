"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { Product, Settings, money, unitPrice } from "@/lib/core";
import { Catalogue, ProductCard } from "./catalogue";
import { useShop } from "./shop-context";
import { api } from "./api";
export type Banner = {
  id: string;
  title: string;
  subtitle: string;
  image_path: string;
  button_label: string;
  link_path: string;
  position: string;
};
export function Wave() {
  return (
    <svg
      className="silk-wave"
      viewBox="0 0 1440 180"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="silk">
          <stop stopColor="#a16822" />
          <stop offset=".3" stopColor="#ffe8c5" />
          <stop offset=".65" stopColor="#9b2945" />
          <stop offset="1" stopColor="#efb6aa" />
        </linearGradient>
      </defs>
      <path
        className="wave-back"
        fill="#b78b51"
        opacity=".28"
        d="M0 20C260 220 350 -60 720 70S1200 170 1440 10V180H0Z"
      />
      <path
        className="wave-front"
        fill="url(#silk)"
        d="M0 75C230 -40 410 210 740 110S1190 -20 1440 80V180H0Z"
      />
      <path
        fill="#fae0c9"
        d="M0 120C230 40 470 230 770 135S1200 80 1440 120V180H0Z"
      />
    </svg>
  );
}
export function BannerStrip({ banners }: { banners: Banner[] }) {
  return (
    <>
      {banners.map((b) => (
        <section key={b.id} className="promo-banner" data-reveal>
          <img src={b.image_path} alt={b.title} />
          <div>
            <p className="eyebrow">From our store</p>
            <h2>{b.title}</h2>
            <p>{b.subtitle}</p>
            <Link className="button" href={b.link_path}>
              {b.button_label} ↗
            </Link>
          </div>
        </section>
      ))}
    </>
  );
}
export function Home({
  settings: s,
  products,
  banners,
}: {
  settings: Settings;
  products: Product[];
  banners: Banner[];
}) {
  return (
    <>
      <section className="hero">
        <img
          className="hero-image"
          src={s.hero_image}
          alt="Our collection model wearing a silk saree"
          fetchPriority="high"
        />
        <div className="hero-shade" />
        <div className="hero-copy">
          <span className="eyebrow">
            மகரந்தம் சில்க்ஸ் · A saree for every you
          </span>
          <h1>{s.hero_title}</h1>
          <p>{s.hero_text}</p>
          <Link href="/shop" className="button">
            Shop sarees <span>↗</span>
          </Link>
          <div className="hero-note">Silk · Bridal · Cotton · Daily wear</div>
        </div>
        <Wave />
      </section>
      <div className="ticker" aria-label="Available saree styles">
        <div>
          {[0, 1].map((k) => (
            <span key={k}>
              KANCHIPURAM ✦ BRIDAL ✦ SOFT SILK ✦ COTTON ✦ BANARASI ✦ ORGANZA ✦
              LINEN ✦{" "}
            </span>
          ))}
        </div>
      </div>
      <section className="section">
        <div className="section-heading" data-reveal>
          <div>
            <p className="eyebrow">So many styles. One lovely place.</p>
            <h2>Find your favourite.</h2>
          </div>
          <Link className="text-link" href="/shop">
            View all sarees ↗
          </Link>
        </div>
        <div className="collection-grid">
          {[products[0], products[3], products[16], products[5]]
            .filter(Boolean)
            .map((p, i) => (
              <Link
                data-reveal
                className={`collection-card collection-${i}`}
                key={p.id}
                href={`/shop?category=${encodeURIComponent(p.category)}`}
              >
                <img src={p.image_path} alt={p.category} loading="lazy" />
                <div>
                  <span className="eyebrow">
                    {
                      [
                        "The silk collection",
                        "For your big day",
                        "Easy, everyday wear",
                        "Light & lovely",
                      ][i]
                    }
                  </span>
                  <h3>{p.category}</h3>
                  <span>Shop collection ↗</span>
                </div>
              </Link>
            ))}
        </div>
      </section>
      <section className="section featured-section">
        <div className="section-heading" data-reveal>
          <div>
            <p className="eyebrow">Made for your favourite moments</p>
            <h2>Sarees you will love.</h2>
          </div>
          <Link href="/shop" className="text-link">
            See all styles ↗
          </Link>
        </div>
        <div className="product-grid">
          {products
            .filter((p) => p.featured)
            .slice(0, 8)
            .map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                ordering={s.ordering_enabled}
              />
            ))}
        </div>
      </section>
      <section className="bridal-story" data-reveal>
        <div className="story-photo">
          <img
            src="/assets/product-04.jpg"
            alt="Rose gold bridal silk saree"
            loading="lazy"
          />
        </div>
        <div className="story-copy">
          <span className="eyebrow">For a day you will always remember</span>
          <h2>
            A special saree.
            <br />
            For your special day.
          </h2>
          <p>
            Beautiful silk, rich colours and gold details. Find your wedding
            saree with us.
          </p>
          <Link className="button" href="/shop?category=Bridal">
            Shop bridal sarees ↗
          </Link>
          <div className="orbit" aria-hidden="true">
            ✦
          </div>
        </div>
      </section>
      <BannerStrip banners={banners.filter((b) => b.position === "home")} />
      <section className="section types-section">
        <p className="eyebrow">Every kind of saree, all in one place</p>
        <h2>Your style is here.</h2>
        <div className="type-cloud">
          {[...new Set(products.map((p) => p.category))].map((c, i) => (
            <Link
              key={c}
              href={`/shop?category=${encodeURIComponent(c)}`}
              style={{ animationDelay: `${i * 0.1}s` }}
            >
              {c} <span>↗</span>
            </Link>
          ))}
        </div>
      </section>
      <section className="bulk-banner" data-reveal>
        <span className="eyebrow">For families, celebrations & businesses</span>
        <h2>Buying more? Let’s talk.</h2>
        <p>Contact us for bulk saree orders and prices.</p>
        <Link href="/bulk" className="button">
          Bulk purchase ↗
        </Link>
      </section>
    </>
  );
}
export function ProductDetail({
  p,
  settings: s,
}: {
  p: Product;
  settings: Settings;
}) {
  const { add } = useShop();
  return (
    <section className="section detail-layout">
      <div className="detail-photo">
        <img src={p.image_path} alt={p.name} />
      </div>
      <div className="detail-copy">
        <Link className="text-link" href="/shop">
          ← All sarees
        </Link>
        <p className="eyebrow">
          {p.category} · {p.colour}
        </p>
        <h1>{p.name}</h1>
        <p className="price">
          {money(unitPrice(p))}{" "}
          {p.discount_percent > 0 && <del>{money(p.price_paise)}</del>}
        </p>
        <p>{p.description}</p>
        <p className="subtle">
          {p.price_paise === 0
            ? "Please contact us for the price."
            : p.available > 0
              ? "Available to order"
              : "Out of stock"}
        </p>
        <button
          className="button"
          disabled={
            !s.ordering_enabled || p.price_paise === 0 || p.available < 1
          }
          onClick={() => add(p.id)}
        >
          Add to bag ＋
        </button>
        <Link href="/bulk" className="button button-outline">
          Ask about bulk orders ↗
        </Link>
        <details>
          <summary>Delivery & payment</summary>
          <p>
            Shipping, tax and any offer are shown in your saved order before you
            pay. Your order is confirmed after payment is checked.
          </p>
        </details>
        <details>
          <summary>Returns & help</summary>
          <p>
            Contact the store before returning a saree. You can request a return
            from your delivered order. Staff will confirm the return and refund.
          </p>
        </details>
      </div>
    </section>
  );
}
export function Cart({
  products,
  settings: s,
}: {
  products: Product[];
  settings: Settings;
}) {
  const { cart, quantity, clear } = useShop();
  const items = cart.map((l) => ({
    l,
    p: products.find((p) => p.id === l.product_id),
  }));
  const subtotal = items.reduce(
    (t, { l, p }) => t + (p ? unitPrice(p) * l.quantity : 0),
    0,
  );
  return (
    <section className="section narrow">
      <p className="eyebrow">Your picks</p>
      <h1>Shopping bag.</h1>
      {!cart.length ? (
        <div className="empty">
          <p>Your bag is empty.</p>
          <Link className="button" href="/shop">
            Shop sarees ↗
          </Link>
        </div>
      ) : (
        <>
          {items.map(({ l, p }) => (
            <article className="cart-line" key={l.product_id}>
              {p ? (
                <>
                  <img src={p.image_path} alt={p.name} />
                  <div>
                    <Link href={`/products/${p.slug}`}>
                      <h3>{p.name}</h3>
                    </Link>
                    <p>{money(unitPrice(p))}</p>
                    <p className="subtle">
                      {p.available < l.quantity
                        ? "This quantity is unavailable."
                        : ""}
                    </p>
                    <label>
                      Quantity{" "}
                      <input
                        type="number"
                        min="1"
                        max="20"
                        value={l.quantity}
                        onChange={(e) => quantity(p.id, Number(e.target.value))}
                      />
                    </label>
                  </div>
                </>
              ) : (
                <p>This saree is no longer available.</p>
              )}
              <button
                onClick={() => quantity(l.product_id, 0)}
                className="text-link"
              >
                Remove
              </button>
            </article>
          ))}
          <div className="total-row">
            <span>Items total</span>
            <b>{money(subtotal)}</b>
          </div>
          <p className="subtle">
            Offers, delivery and tax are calculated securely when your order is
            saved.
          </p>
          <div className="button-row">
            <Link
              href="/checkout"
              className={`button ${!s.ordering_enabled ? "muted" : ""}`}
            >
              Continue to order ↗
            </Link>
            <button className="text-link" onClick={clear}>
              Clear bag
            </button>
          </div>
          {!s.ordering_enabled && (
            <p>Online ordering will open soon. Contact us for help.</p>
          )}
        </>
      )}
    </section>
  );
}
export const addressFields = [
  ["name", "Full name"],
  ["phone", "Phone number"],
  ["line1", "Address line 1"],
  ["line2", "Address line 2 (optional)"],
  ["city", "City"],
  ["state", "State"],
  ["pin", "PIN code"],
] as const;
export function Checkout({
  products,
  settings: s,
}: {
  products: Product[];
  settings: Settings;
}) {
  const { cart, clear, notice } = useShop();
  const [busy, setBusy] = useState(false),
    [channel, setChannel] = useState(
      s.checkout_mode === "online_only"
        ? s.online_method === "manual_upi"
          ? "upi"
          : "razorpay"
        : "whatsapp",
    ),
    [addresses, setAddresses] = useState<
      {
        id: string;
        label: string;
        address: Record<string, string>;
      }[]
    >([]),
    [selected, setSelected] = useState<Record<string, string>>({});
  useEffect(() => {
    api<{
      rows: typeof addresses;
    }>("/api/account/addresses")
      .then((r) => setAddresses(r.rows))
      .catch(() => {});
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    const form = new FormData(e.currentTarget);
    const address = Object.fromEntries(
      addressFields.map(([k]) => [k, String(form.get(k) || "")]),
    );
    let key = sessionStorage.getItem("ms-checkout-key");
    if (!key) {
      key = crypto.randomUUID();
      sessionStorage.setItem("ms-checkout-key", key);
    }
    const request = {
      key,
      cart,
      address,
      channel,
      coupon: String(form.get("coupon") || ""),
      whatsapp_consent: form.get("consent") === "on",
    };
    const fingerprint = JSON.stringify({ ...request, key: undefined });
    if (sessionStorage.getItem("ms-checkout-input") !== fingerprint) {
      request.key = crypto.randomUUID();
      sessionStorage.setItem("ms-checkout-key", request.key);
      sessionStorage.setItem("ms-checkout-input", fingerprint);
    }
    try {
      const result = await api<{
        redirect: string;
      }>("/api/checkout", request);
      clear();
      sessionStorage.removeItem("ms-checkout-key");
      sessionStorage.removeItem("ms-checkout-input");
      window.location.assign(result.redirect);
    } catch (error) {
      notice((error as Error).message);
      setBusy(false);
    }
  }
  return (
    <section className="section narrow">
      <p className="eyebrow">One step closer</p>
      <h1>Place your order.</h1>
      {!s.ordering_enabled ? (
        <p>Ordering is currently paused. Please contact the store.</p>
      ) : !cart.length ? (
        <Link href="/shop" className="button">
          Add sarees first ↗
        </Link>
      ) : (
        <form onSubmit={submit} className="form-panel">
          <p>
            Sign in before placing an order.{" "}
            <Link href="/login" className="text-link">
              Sign in ↗
            </Link>
          </p>
          {addresses.length > 0 && (
            <label>
              Use a saved address
              <select
                onChange={(e) =>
                  setSelected(
                    addresses.find((a) => a.id === e.target.value)?.address ||
                      {},
                  )
                }
              >
                <option value="">Enter a new address</option>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="form-grid">
            {addressFields.map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  key={`${key}-${selected[key]}`}
                  name={key}
                  defaultValue={selected[key] || ""}
                  required={key !== "line2"}
                  maxLength={key === "pin" ? 6 : key === "phone" ? 20 : 180}
                  autoComplete={
                    key === "name"
                      ? "name"
                      : key === "phone"
                        ? "tel"
                        : key === "pin"
                          ? "postal-code"
                          : "off"
                  }
                />
              </label>
            ))}
          </div>
          <label>
            Coupon code (optional)
            <input name="coupon" maxLength={40} />
          </label>
          <fieldset>
            <legend>How would you like to order?</legend>
            {s.checkout_mode !== "online_only" && (
              <label className="check">
                <input
                  type="radio"
                  name="channel"
                  checked={channel === "whatsapp"}
                  onChange={() => setChannel("whatsapp")}
                />
                WhatsApp order · staff check your payment
              </label>
            )}
            {s.checkout_mode !== "whatsapp_only" && (
              <label className="check">
                <input
                  type="radio"
                  name="channel"
                  checked={channel !== "whatsapp"}
                  onChange={() =>
                    setChannel(
                      s.online_method === "manual_upi" ? "upi" : "razorpay",
                    )
                  }
                />
                {s.online_method === "manual_upi"
                  ? "UPI · staff check your payment"
                  : "UPI · secure online payment"}
              </label>
            )}
          </fieldset>
          {channel === "whatsapp" && (
            <label className="check">
              <input required type="checkbox" name="consent" />I agree to share
              my order and delivery details with the store on WhatsApp. I will
              press Send in WhatsApp.
            </label>
          )}
          <div className="checkout-summary">
            {cart.map((l) => {
              const p = products.find((p) => p.id === l.product_id);
              return (
                <p key={l.product_id}>
                  {p?.name || "Unavailable saree"} × {l.quantity}{" "}
                  <b>{p ? money(unitPrice(p) * l.quantity) : "Unavailable"}</b>
                </p>
              );
            })}
          </div>
          <p className="subtle">
            The next screen shows the final total, including offers, delivery
            and tax. Saving an order does not take payment.
          </p>
          <button className="button" disabled={busy}>
            {busy ? "Saving order…" : "Save order & view final total ↗"}
          </button>
        </form>
      )}
    </section>
  );
}
export function Bulk({ settings: s }: { settings: Settings }) {
  const { notice } = useShop();
  const [busy, setBusy] = useState(false);
  return (
    <section className="section narrow">
      <span className="eyebrow">More sarees. More happy moments.</span>
      <h1>Bulk purchase.</h1>
      <p>
        For weddings, gifts, shops and large orders. Ask us about{" "}
        {s.bulk_min_quantity} or more sarees.
      </p>
      {s.bulk_phone && (
        <a className="button" href={`tel:${s.bulk_phone}`}>
          Call {s.bulk_phone} ↗
        </a>
      )}
      <form
        className="form-panel"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          const f = new FormData(e.currentTarget);
          try {
            const r = await api<{
              message: string;
            }>("/api/account/bulk", {
              name: f.get("name"),
              phone: f.get("phone"),
              quantity: Number(f.get("quantity")),
              message: f.get("message"),
            });
            notice(r.message);
          } catch (error) {
            notice((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <p>Sign in to send an inquiry, or call us.</p>
        <label>
          Your name
          <input name="name" required maxLength={80} />
        </label>
        <label>
          Phone number
          <input name="phone" required maxLength={20} />
        </label>
        <label>
          Number of sarees
          <input
            name="quantity"
            type="number"
            min={1}
            max={100000}
            defaultValue={s.bulk_min_quantity}
          />
        </label>
        <label>
          What do you need?
          <textarea name="message" required maxLength={2000} />
        </label>
        <button disabled={busy} className="button">
          Send inquiry ↗
        </button>
      </form>
    </section>
  );
}
