"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Product, money, unitPrice } from "@/lib/core";
import { useShop } from "./shop-context";
import { api } from "./api";
export function ProductCard({
  product: p,
  ordering,
}: {
  product: Product;
  ordering: boolean;
}) {
  const { add, notice } = useShop();
  return (
    <article className="product-card" data-reveal>
      <Link href={`/products/${p.slug}`} className="product-photo">
        <img src={p.image_path} alt={`${p.name}, ${p.colour}`} loading="lazy" />
        <span className="product-tag">
          {p.discount_percent ? `${p.discount_percent}% off` : p.category}
        </span>
      </Link>
      <button
        className="save"
        aria-label={`Save ${p.name}`}
        onClick={async () => {
          try {
            await api("/api/account/wishlist", {
              product_id: p.id,
              remove: false,
            });
            notice("Saved to your favourites.");
          } catch (e) {
            notice((e as Error).message);
          }
        }}
      >
        ♡
      </button>
      <div className="product-copy">
        <span className="eyebrow">{p.category}</span>
        <Link href={`/products/${p.slug}`}>
          <h3>{p.name}</h3>
        </Link>
        <div className="product-bottom">
          <span>
            {money(unitPrice(p))}
            {p.discount_percent > 0 && <del>{money(p.price_paise)}</del>}
          </span>
          <button
            onClick={() => add(p.id)}
            disabled={!ordering || p.price_paise === 0 || p.available < 1}
            aria-label={`Add ${p.name} to bag`}
          >
            Add to bag ＋
          </button>
        </div>
      </div>
    </article>
  );
}
export function Catalogue({
  products,
  ordering,
  initialCategory = "All",
}: {
  products: Product[];
  ordering: boolean;
  initialCategory?: string;
}) {
  const [category, setCategory] = useState(initialCategory),
    [search, setSearch] = useState(""),
    [sort, setSort] = useState("featured");
  useEffect(() => {
    setCategory(initialCategory);
  }, [initialCategory]);
  const categories = ["All", ...new Set(products.flatMap((p) => [p.category,p.subcategory_name].filter(Boolean) as string[]))];
  const filtered = products
    .filter(
      (p) =>
        (category === "All" || p.category === category || p.subcategory_name===category) &&
        `${p.name} ${p.colour} ${p.category} ${p.subcategory_name||''}`
          .toLowerCase()
          .includes(search.toLowerCase()),
    )
    .sort((a, b) =>
      sort === "low"
        ? unitPrice(a) - unitPrice(b)
        : sort === "high"
          ? unitPrice(b) - unitPrice(a)
          : Number(b.featured) - Number(a.featured),
    );
  return (
    <>
      <div className="shop-tools">
        <label className="search-box">
          Search sarees
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Try silk, cotton, pink…"
          />
        </label>
        <label>
          Saree type
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {categories.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label>
          Sort by
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="featured">Featured</option>
            <option value="low">Price: low to high</option>
            <option value="high">Price: high to low</option>
          </select>
        </label>
      </div>
      <div className="filter-chips">
        {[
          "All",
          "Kanchipuram",
          "Bridal",
          "Soft Silk",
          "Cotton",
          "Organza",
          "Linen",
        ]
          .filter((c) => categories.includes(c))
          .map((c) => (
            <button
              className={category === c ? "active" : ""}
              key={c}
              onClick={() => setCategory(c)}
            >
              {c}
            </button>
          ))}
      </div>
      <p className="subtle">
        {filtered.length} sarees ·{" "}
        {category === "All" ? "All styles" : category}
      </p>
      <div className="product-grid">
        {filtered.map((p) => (
          <ProductCard key={p.id} product={p} ordering={ordering} />
        ))}
      </div>
      {!filtered.length && (
        <p className="empty">No sarees found. Try another type or colour.</p>
      )}
    </>
  );
}
