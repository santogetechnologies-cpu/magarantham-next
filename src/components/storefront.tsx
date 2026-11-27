"use client";
import { FormEvent, useEffect, useState } from "react";
import Link from "next/link";
import { CategoryItem, Product, Profile, Settings, money, unitPrice, unitSuffix } from "@/lib/core";
import { Catalogue, ProductCard } from "./catalogue";
import { useShop, checkoutLines } from "./shop-context";
import { api } from "./api";
import { BannerSlot } from "./banner-slot";
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
  categories = [],
  offers = [],
}: {
  settings: Settings;
  products: Product[];
  banners: Banner[];
  categories?: CategoryItem[];
  offers?: any[];
}) {
  const discountedProducts = products.filter(
    (p) => Boolean(p.offer_badge || p.discount_percent > 0 || (p.effective_price_paise && p.effective_price_paise < p.price_paise)),
  );

  return (
    <>
      {/* Top Promotional Offer Banner */}
      {offers && offers.length > 0 && (
        <div
          style={{
            background: "linear-gradient(135deg, #800020 0%, #4A0012 100%)",
            color: "#FFFDF9",
            padding: "10px 18px",
            textAlign: "center",
            borderBottom: "2px solid #C49A52",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 16 }}>✨</span>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            <strong style={{ color: "#FFE8C5" }}>{offers[0].title}:</strong>{" "}
            {offers[0].kind === "percent"
              ? `${offers[0].value}% OFF`
              : `₹${Math.round(offers[0].value / 100)} OFF`}{" "}
            on eligible collections!
            {offers[0].code && (
              <span
                style={{
                  marginLeft: 8,
                  background: "#C49A52",
                  color: "#800020",
                  padding: "2px 8px",
                  borderRadius: 4,
                  fontWeight: 700,
                  fontSize: 11,
                }}
              >
                Code: {offers[0].code}
              </span>
            )}
          </span>
          <Link
            href="/shop?offers=true"
            style={{
              color: "#FFE8C5",
              fontWeight: 700,
              textDecoration: "underline",
              fontSize: 12,
            }}
          >
            Shop Offers ↗
          </Link>
        </div>
      )}

      <BannerSlot banners={banners} position="home_hero" />
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
          {(categories && categories.length > 0
            ? categories.filter((c) => !c.parent_id && c.active !== false)
            : []
          ).length > 0
            ? categories
                .filter((c) => !c.parent_id && c.active !== false)
                .map((cat, i) => {
                  const fallbackThumb =
                    cat.image_path ||
                    products.find(
                      (p) =>
                        p.category.toLowerCase() === cat.name.toLowerCase() &&
                        p.image_path,
                    )?.image_path ||
                    "/assets/brand-logo.png";
                  return (
                    <Link
                      data-reveal
                      className={`collection-card collection-${i % 4}`}
                      key={cat.id}
                      href={`/category/${cat.slug}`}
                    >
                      <img src={fallbackThumb} alt={cat.name} loading="lazy" />
                      <div>
                        <span className="eyebrow">
                          {cat.description
                            ? cat.description.slice(0, 42)
                            : "Handcrafted Pure Silk"}
                        </span>
                        <h3>{cat.name}</h3>
                        <span>Explore Collection ↗</span>
                      </div>
                    </Link>
                  );
                })
            : [products[0], products[3], products[16], products[5]]
                .filter(Boolean)
                .map((p, i) => (
                  <Link
                    data-reveal
                    className={`collection-card collection-${i % 4}`}
                    key={p.id}
                    href={`/shop?category=${encodeURIComponent(p.category)}`}
                  >
                    <img src={p.image_path} alt={p.category} loading="lazy" />
                    <div>
                      <span className="eyebrow">
                        {[
                          "The silk collection",
                          "For your big day",
                          "Easy, everyday wear",
                          "Light & lovely",
                        ][i % 4]}
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

      {/* SHOP BY OFFERS CURATED SECTION */}
      {discountedProducts.length > 0 && (
        <section className="section" style={{ background: "#FBF7F0", padding: "40px 24px", borderRadius: 12, margin: "24px 0" }}>
          <div className="section-heading" data-reveal>
            <div>
              <p className="eyebrow" style={{ color: "#C49A52" }}>Festive Specials &amp; Limited-Time Discounts</p>
              <h2 style={{ color: "#800020" }}>Shop by Offers</h2>
            </div>
            <Link href="/shop?offers=true" className="text-link" style={{ color: "#800020", fontWeight: 700 }}>
              View all offers ({discountedProducts.length} styles) ↗
            </Link>
          </div>
          <div className="product-grid">
            {discountedProducts.slice(0, 8).map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                ordering={s.ordering_enabled}
              />
            ))}
          </div>
        </section>
      )}
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
      <BannerSlot banners={banners} position="home" />
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
      <BannerSlot banners={banners} position="home_bottom" />
    </>
  );
}
function colourHex(name?: string): string {
  const map: Record<string, string> = {
    purple: "#7C3AED",
    green: "#2E7D32",
    red: "#C62828",
    "crimson red": "#B91C1C",
    maroon: "#800020",
    beige: "#D4A373",
    blue: "#1D4ED8",
    gold: "#C49A52",
    pink: "#DB2777",
    magenta: "#A21CAF",
    ivory: "#E7DFD3",
    yellow: "#CA8A04",
    teal: "#0F766E",
    orange: "#EA580C",
    terracotta: "#B45309",
    wine: "#650019",
  };
  const key = (name || "").trim().toLowerCase();
  return map[key] || "#800020";
}

export function ProductDetail({
  p,
  settings: s,
}: {
  p: Product;
  settings: Settings;
}) {
  const { add } = useShop();
  // One saree, one price; customers choose among the colours that have a photo.
  const colours = p.colours || [];
  const firstFree = colours.find((c) => c.quantity - c.reserved > 0) || colours[0] || null;
  const [selected, setSelected] = useState(firstFree);
  const free = selected ? Math.max(0, selected.quantity - selected.reserved) : p.available;

  const rawPrice = p.price_paise;
  const effectivePrice = unitPrice(p);
  const savings = Math.max(0, rawPrice - effectivePrice);
  const isSoldOut = free < 1;

  return (
    <section className="section detail-layout">
      <div className="detail-photo">
        <img src={selected?.image_path || p.image_path} alt={selected ? `${p.name} in ${selected.colour}` : p.name} />
      </div>
      <div className="detail-copy">
        <nav className="shop-breadcrumbs" aria-label="Breadcrumb">
          <Link href="/">Home</Link>
          <span aria-hidden="true">/</span>
          <Link href="/shop">All sarees</Link>
          <span aria-hidden="true">/</span>
          <Link href={`/shop/${encodeURIComponent((p.category || "sarees").toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`}>
            {p.category}
          </Link>
          {p.subcategory_name &&
            p.subcategory_name.toLowerCase() !== "all styles" && (
              <>
                <span aria-hidden="true">/</span>
                <Link
                  href={`/shop/${encodeURIComponent((p.category || "sarees").toLowerCase().replace(/[^a-z0-9]+/g, "-"))}/${encodeURIComponent(p.subcategory_name.toLowerCase().replace(/[^a-z0-9]+/g, "-"))}`}
                >
                  {p.subcategory_name}
                </Link>
              </>
            )}
        </nav>
        <p className="eyebrow">
          {p.category}
          {p.subcategory_name && p.subcategory_name.toLowerCase() !== "all styles"
            ? ` · ${p.subcategory_name}`
            : ""}{" "}
          {p.fabric ? ` · ${p.fabric}` : ""}
        </p>

        {/* Dynamic Promotional Offer Pill */}
        {(p.offer_badge || p.applied_offer_title) && (
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "#FFFDF9",
              border: "1px solid #C49A52",
              borderRadius: 20,
              padding: "4px 14px",
              marginBottom: 10,
            }}
          >
            <span style={{ color: "#C49A52", fontSize: 16 }}>✨</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#800020" }}>
              {p.applied_offer_title ? `${p.applied_offer_title}: ` : "Festive Offer: "}
              <span style={{ color: "#166534" }}>{p.offer_badge}</span>
            </span>
          </div>
        )}

        <h1>{p.name}</h1>
        <p className="price">
          <span style={{ color: "#800020", fontWeight: 800 }}>{money(effectivePrice)}</span>{unitSuffix(p.sale_unit) && <small className="price-unit"> {unitSuffix(p.sale_unit)}</small>}{" "}
          {savings > 0 && (
            <>
              <del style={{ color: "#888", marginLeft: 8 }}>{money(rawPrice)}</del>
              <span
                style={{
                  marginLeft: 10,
                  background: "#DCFCE7",
                  color: "#166534",
                  padding: "3px 8px",
                  borderRadius: 4,
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                You Save {money(savings)}
              </span>
            </>
          )}
        </p>
        <p>{p.description}</p>

        {colours.length > 0 && (
          <div className="colour-picker" role="radiogroup" aria-label="Choose colour">
            <p className="colour-picker-label">
              Colour: <strong>{selected?.colour || "Choose"}</strong>
              {selected && <span className="subtle"> · {free > 0 ? `${free} available` : "sold out"}</span>}
            </p>
            <div className="colour-swatches">
              {colours.map((c) => {
                const left = Math.max(0, c.quantity - c.reserved);
                const isSel = selected?.id === c.id;
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="radio"
                    aria-checked={isSel}
                    className={`colour-swatch ${isSel ? "selected" : ""} ${left < 1 ? "sold" : ""}`}
                    onClick={() => setSelected(c)}
                    title={left < 1 ? `${c.colour} - sold out` : `${c.colour} - ${left} available`}
                  >
                    <img src={c.image_path} alt="" />
                    <span className="colour-swatch-name">
                      <i style={{ background: c.colour_hex || colourHex(c.colour) }} aria-hidden="true" />
                      {c.colour}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p className="subtle">
          {rawPrice === 0
            ? "Please contact us for the price."
            : isSoldOut
              ? `${selected?.colour || "This saree"} is currently sold out.`
              : "Available to order"}
        </p>
        <button
          className="button"
          disabled={!s.ordering_enabled || rawPrice === 0 || isSoldOut || !selected}
          onClick={() => selected && add(p.id, { id: selected.id, colour: selected.colour, image_path: selected.image_path }, free)}
        >
          {isSoldOut ? "Sold out" : `Add ${selected?.colour || ""} to bag ＋`}
        </button>
        <Link href="/bulk" className="button button-outline">
          Ask about bulk orders ↗
        </Link>
        <details>
          <summary>Delivery &amp; payment</summary>
          <p>
            Shipping, tax and any offer are shown in your saved order before you
            pay. Your order is confirmed after payment is checked.
          </p>
        </details>
        <details>
          <summary>Returns &amp; help</summary>
          <p>
            Contact the store before returning a saree. You can request a return
            from your delivered order. Staff will confirm the return and refund.
          </p>
        </details>
      </div>
    </section>
  );
}
const colourOf = (p: Product, colourId: string) => (p.colours || []).find((c) => c.id === colourId);
const colourLeft = (p: Product, colourId: string) => {
  const c = colourOf(p, colourId);
  return c ? Math.max(0, c.quantity - c.reserved) : 0;
};
export function Cart({
  products,
  settings: s,
}: {
  products: Product[];
  settings: Settings;
}) {
  const { cart, quantity, clear, remove, notice } = useShop();
  // Drop sarees that are no longer sold online so checkout does not fail on them.
  useEffect(() => {
    if (!products.length) return;
    const gone = [...new Set(cart.filter((l) => !products.some((p) => p.id === l.product_id)).map((l) => l.product_id))];
    // A colour that was sold out at the counter or had its photo removed is no longer sellable online.
    const goneColours = cart.filter((l) => {
      const prod = products.find((p) => p.id === l.product_id);
      return prod && !colourOf(prod, l.colour_id);
    });
    for (const l of goneColours) quantity(l.product_id, 0, l.colour_id);
    if (gone.length) remove(gone);
    const n = gone.length + goneColours.length;
    if (n) notice(`${n} item${n === 1 ? " is" : "s are"} no longer available and ${n === 1 ? "was" : "were"} removed from your bag.`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, cart.length]);
  const items = cart.map((l) => {
    const prod = products.find((p) => p.id === l.product_id);
    // Checkout charges the saree's current price, so show exactly that.
    const linePrice = prod ? unitPrice(prod) : 0;
    return {
      l,
      p: prod,
      linePrice,
    };
  });
  const subtotal = items.reduce(
    (t, { l, linePrice }) => t + linePrice * l.quantity,
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
          {items.map(({ l, p, linePrice }) => (
            <article className="cart-line" key={`${l.product_id}-${l.colour_id}`}>
              {p ? (
                <>
                  <img src={colourOf(p, l.colour_id)?.image_path || l.colour_image || p.image_path} alt={`${p.name} ${l.colour}`} />
                  <div>
                    <Link href={`/products/${p.slug}`}>
                      <h3>{p.name}</h3>
                    </Link>
                    <span className="cart-piece-tag">
                      Colour: <strong>{l.colour}</strong>
                    </span>
                    <p>{money(linePrice)}</p>
                    <p className="subtle">
                      {!colourOf(p, l.colour_id)
                        ? "This colour is no longer available."
                        : colourLeft(p, l.colour_id) < l.quantity
                          ? `Only ${colourLeft(p, l.colour_id)} ${l.colour} available.`
                          : ""}
                    </p>
                    {(
                      <div className="cart-qty-control">
                        <span className="cart-qty-label">Quantity:</span>
                        <div className="cart-qty-stepper">
                          <button
                            type="button"
                            className="cart-qty-btn"
                            disabled={l.quantity <= 1}
                            onClick={() => quantity(p.id, Math.max(1, l.quantity - 1), l.colour_id)}
                            aria-label="Decrease quantity"
                            title="Decrease quantity"
                          >
                            −
                          </button>
                          <input
                            type="number"
                            min="1"
                            max={Math.min(20, colourLeft(p, l.colour_id) || 1)}
                            value={l.quantity}
                            onChange={(e) => {
                              const n = Number(e.target.value);
                              if (e.target.value !== "" && Number.isInteger(n) && n >= 1) {
                                quantity(p.id, Math.min(Math.min(20, colourLeft(p, l.colour_id) || 1), n), l.colour_id);
                              }
                            }}
                            className="cart-qty-input"
                            aria-label="Quantity"
                          />
                          <button
                            type="button"
                            className="cart-qty-btn"
                            disabled={l.quantity >= Math.min(20, colourLeft(p, l.colour_id))}
                            onClick={() =>
                              quantity(p.id, Math.min(20, Math.min(colourLeft(p, l.colour_id), l.quantity + 1)), l.colour_id)
                            }
                            aria-label="Increase quantity"
                            title="Increase quantity"
                          >
                            +
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <p>This saree is no longer available.</p>
              )}
              <button
                type="button"
                onClick={() => quantity(l.product_id, 0, l.colour_id)}
                className="cart-remove-btn"
                title="Remove saree from bag"
              >
                <span>Remove</span>
                <span aria-hidden="true" style={{ fontSize: "14px", lineHeight: 1 }}>×</span>
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
            <button
              type="button"
              className="button button-outline"
              onClick={clear}
            >
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
  profile,
}: {
  products: Product[];
  settings: Settings;
  profile?: Profile | null;
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
    const store = {
      get: (k: string) => {
        try {
          return sessionStorage.getItem(k);
        } catch {
          return null;
        }
      },
      set: (k: string, v: string) => {
        try {
          sessionStorage.setItem(k, v);
        } catch {}
      },
      del: (k: string) => {
        try {
          sessionStorage.removeItem(k);
        } catch {}
      },
    };
    const lines = checkoutLines(cart, new Set(products.map((p) => p.id)));
    if (!lines.length) {
      notice("The sarees in your bag are no longer available.");
      setBusy(false);
      return;
    }
    let key = store.get("ms-checkout-key");
    if (!key) {
      key = crypto.randomUUID();
      store.set("ms-checkout-key", key);
    }
    const request = {
      key,
      cart: lines,
      address,
      channel,
      coupon: String(form.get("coupon") || ""),
      whatsapp_consent: form.get("consent") === "on",
    };
    const fingerprint = JSON.stringify({ ...request, key: undefined });
    if (store.get("ms-checkout-input") !== fingerprint) {
      request.key = crypto.randomUUID();
      store.set("ms-checkout-key", request.key);
      store.set("ms-checkout-input", fingerprint);
    }
    try {
      const result = await api<{
        redirect: string;
      }>("/api/checkout", request);
      clear();
      store.del("ms-checkout-key");
      store.del("ms-checkout-input");
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
          {profile ? (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "12px 16px",
                background: "rgba(128, 0, 32, 0.04)",
                border: "1px solid rgba(128, 0, 32, 0.15)",
                borderRadius: "8px",
                marginBottom: "20px",
              }}
            >
              <div>
                <span style={{ fontSize: "12px", color: "var(--erp-text-muted, #7E6551)", display: "block" }}>
                  Ordering as
                </span>
                <strong style={{ color: "var(--erp-maroon, #800020)", fontSize: "15px" }}>
                  {profile.display_name || profile.phone || profile.email}
                </strong>
                {profile.phone && profile.display_name && (
                  <span style={{ fontSize: "13px", color: "#666", marginLeft: "8px" }}>
                    · {profile.phone}
                  </span>
                )}
              </div>
              <Link href="/account" className="text-link" style={{ fontSize: "13px" }}>
                My Account ↗
              </Link>
            </div>
          ) : (
            <p>
              Sign in before placing an order.{" "}
              <Link href="/login?returnTo=/checkout" className="text-link">
                Sign in ↗
              </Link>
            </p>
          )}
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
            {addressFields.map(([key, label]) => {
              const defaultVal =
                selected[key] ||
                (key === "name"
                  ? profile?.display_name || ""
                  : key === "phone"
                    ? profile?.phone || ""
                    : "");
              return (
                <label key={key}>
                  {label}
                  <input
                    key={`${key}-${defaultVal}`}
                    name={key}
                    defaultValue={defaultVal}
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
              );
            })}
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
