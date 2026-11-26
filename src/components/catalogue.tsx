"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CategoryItem, Product, money, unitPrice, unitSuffix } from "@/lib/core";
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
  const hasCustomSub =
    p.subcategory_name && p.subcategory_name.toLowerCase() !== "all styles";

  return (
    <article className="product-card" data-reveal>
      <Link href={`/products/${p.slug}`} className="product-photo">
        <img src={p.image_path} alt={`${p.name}, ${p.colour}`} loading="lazy" />
        <span
          className="product-tag"
          style={
            p.offer_badge
              ? { background: "#800020", color: "#FFFFFF", fontWeight: 700 }
              : undefined
          }
        >
          {p.offer_badge
            ? `✨ ${p.offer_badge}`
            : p.discount_percent
              ? `${p.discount_percent}% off`
              : hasCustomSub
                ? p.subcategory_name
                : p.category}
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
        <span className="eyebrow">
          {p.category}
          {hasCustomSub ? ` · ${p.subcategory_name}` : ""}
        </span>
        <Link href={`/products/${p.slug}`}>
          <h3>{p.name}</h3>
        </Link>
        <div className="product-bottom">
          <div>
            <span>
              <strong style={{ color: "#800020", fontSize: 16 }}>{money(unitPrice(p))}</strong>{unitSuffix(p.sale_unit) && <small className="price-unit"> {unitSuffix(p.sale_unit)}</small>}
              {(p.offer_badge || p.discount_percent > 0 || p.price_paise > unitPrice(p)) && (
                <del style={{ marginLeft: 6, color: "#888", fontSize: "0.85em" }}>
                  {money(p.price_paise)}
                </del>
              )}
            </span>
            {p.price_paise > unitPrice(p) && (
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "#166534",
                  fontWeight: 600,
                  marginTop: 2,
                }}
              >
                Save {money(p.price_paise - unitPrice(p))}
              </span>
            )}
          </div>
          <button
            className="card-add-btn"
            onClick={() => add(p.id)}
            disabled={!ordering || p.price_paise === 0 || p.available < 1}
            aria-label={`Add ${p.name} to bag`}
          >
            {p.available < 1 ? "Sold out" : "Add to bag ＋"}
          </button>
        </div>
      </div>
    </article>
  );
}

export function Catalogue({
  products,
  categories = [],
  ordering,
  initialCategory = "All",
  initialSubcategory = "All",
}: {
  products: Product[];
  categories?: CategoryItem[];
  ordering: boolean;
  initialCategory?: string;
  initialSubcategory?: string;
}) {
  // All main categories from product_categories (active, no parent_id)
  const mainCategoryObjects = useMemo(
    () => categories.filter((c) => !c.parent_id && c.active),
    [categories],
  );

  const mainCategoryNames = useMemo(() => {
    const names = new Set<string>(["All"]);
    for (const c of mainCategoryObjects) names.add(c.name);
    for (const p of products) {
      if (p.category) names.add(p.category);
    }
    return Array.from(names);
  }, [mainCategoryObjects, products]);

  // Resolve initialCategory case-insensitively
  const resolvedInitialCategory = useMemo(() => {
    if (!initialCategory || initialCategory === "All") return "All";
    const found = mainCategoryNames.find(
      (n) => n.toLowerCase() === initialCategory.trim().toLowerCase(),
    );
    return found || initialCategory;
  }, [initialCategory, mainCategoryNames]);

  const [category, setCategory] = useState(resolvedInitialCategory);
  const [subcategory, setSubcategory] = useState(initialSubcategory);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("featured");
  const [offersOnly, setOffersOnly] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      const p = new URLSearchParams(window.location.search);
      if (p.get("offers") === "true") setOffersOnly(true);
    }
  }, []);

  useEffect(() => {
    setCategory(resolvedInitialCategory);
    setSubcategory(initialSubcategory);
  }, [resolvedInitialCategory, initialSubcategory]);

  // Relational saree-to-category matcher
  const isSareeInCat = (p: Product, catName: string): boolean => {
    if (catName === "All") return true;
    const catLower = catName.trim().toLowerCase();
    const targetCat = mainCategoryObjects.find(
      (c) =>
        c.name.toLowerCase() === catLower ||
        c.slug.toLowerCase() === catLower,
    );
    // 1. Match p.category column (case-insensitive)
    if (p.category && p.category.trim().toLowerCase() === catLower) return true;
    if (
      targetCat &&
      p.category &&
      p.category.trim().toLowerCase() === targetCat.name.toLowerCase()
    )
      return true;
    // 2. Direct relational match on p.category_id
    if (targetCat && p.category_id && p.category_id === targetCat.id) return true;
    // 3. Child subcategory match: if product's subcategory is a child of targetCat
    if (targetCat && p.subcategory_id) {
      const sub = categories.find((c) => c.id === p.subcategory_id);
      if (sub && sub.parent_id === targetCat.id) return true;
    }
    // 4. Subcategory name matching category name
    if (p.subcategory_name && p.subcategory_name.trim().toLowerCase() === catLower)
      return true;
    return false;
  };

  // Precompute saree count per category dynamically
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {
      All: products.length,
    };
    for (const catName of mainCategoryNames) {
      if (catName === "All") continue;
      counts[catName] = products.filter((p) => isSareeInCat(p, catName)).length;
    }
    return counts;
  }, [products, mainCategoryNames, mainCategoryObjects, categories]);

  // Subcategories belonging to the currently selected Main Category
  const activeMainObj = useMemo(
    () =>
      category !== "All"
        ? mainCategoryObjects.find(
          (m) => m.name.toLowerCase() === category.toLowerCase(),
        ) || null
        : null,
    [mainCategoryObjects, category],
  );

  const availableSubcategories = useMemo(() => {
    if (category === "All") return [];
    const list: {
      id: string;
      name: string;
      image_path: string;
      count: number;
    }[] = [];

    if (activeMainObj) {
      const dbSubs = categories.filter(
        (c) =>
          c.parent_id === activeMainObj.id &&
          c.active &&
          c.name.toLowerCase() !== "all styles",
      );
      for (const s of dbSubs) {
        const matchingProds = products.filter(
          (p) =>
            p.subcategory_id === s.id ||
            (isSareeInCat(p, category) && p.subcategory_name === s.name),
        );
        list.push({
          id: s.id,
          name: s.name,
          image_path: s.image_path || matchingProds[0]?.image_path || "",
          count: matchingProds.length,
        });
      }
    }
    return list;
  }, [category, activeMainObj, categories, products]);

  function selectMainCategory(nextCat: string) {
    setCategory(nextCat);
    setSubcategory("All");
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextCat === "All") {
        url.searchParams.delete("category");
      } else {
        url.searchParams.set("category", nextCat);
      }
      url.searchParams.delete("subcategory");
      const qs = url.searchParams.toString();
      window.history.replaceState({}, "", url.pathname + (qs ? `?${qs}` : ""));
    }
  }

  function selectSubcategory(nextSub: string) {
    setSubcategory(nextSub);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (nextSub === "All") {
        url.searchParams.delete("subcategory");
      } else {
        url.searchParams.set("subcategory", nextSub);
      }
      const qs = url.searchParams.toString();
      window.history.replaceState({}, "", url.pathname + (qs ? `?${qs}` : ""));
    }
  }

  const offerProductsCount = useMemo(
    () => products.filter((p) => Boolean(p.offer_badge || p.discount_percent > 0 || p.price_paise > unitPrice(p))).length,
    [products],
  );

  const filtered = products
    .filter((p) => {
      // 0. Offers only filter
      if (offersOnly && !(p.offer_badge || p.discount_percent > 0 || p.price_paise > unitPrice(p))) {
        return false;
      }

      // 1. Main category filter (All shows every published saree)
      if (!isSareeInCat(p, category)) return false;

      // 2. Subcategory filter
      if (subcategory !== "All") {
        const subObj = availableSubcategories.find(
          (s) => s.name === subcategory || s.id === subcategory,
        );
        const matchesSub = subObj
          ? p.subcategory_id === subObj.id || p.subcategory_name === subObj.name
          : p.subcategory_name === subcategory;
        if (!matchesSub) return false;
      }

      // 3. Search query filter
      if (!search.trim()) return true;
      return `${p.name} ${p.colour} ${p.category} ${p.subcategory_name || ""}`
        .toLowerCase()
        .includes(search.toLowerCase());
    })
    .sort((a, b) =>
      sort === "low"
        ? unitPrice(a) - unitPrice(b)
        : sort === "high"
          ? unitPrice(b) - unitPrice(a)
          : Number(b.featured) - Number(a.featured),
    );

  return (
    <>
      {/* Category & Subcategory Breadcrumbs */}
      <nav className="shop-breadcrumbs" aria-label="Category breadcrumb">
        <Link href="/">Home</Link>
        <span aria-hidden="true">/</span>
        {category === "All" ? (
          <span className="crumb-current">All Sarees</span>
        ) : (
          <>
            <button
              type="button"
              className="crumb-btn"
              onClick={() => selectMainCategory("All")}
            >
              All Sarees
            </button>
            <span aria-hidden="true">/</span>
            {subcategory === "All" ? (
              <span className="crumb-current">{category}</span>
            ) : (
              <>
                <button
                  type="button"
                  className="crumb-btn"
                  onClick={() => selectSubcategory("All")}
                >
                  {category}
                </button>
                <span aria-hidden="true">/</span>
                <span className="crumb-current">{subcategory}</span>
              </>
            )}
          </>
        )}
      </nav>

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
          Saree category
          <select
            value={category}
            onChange={(e) => selectMainCategory(e.target.value)}
          >
            {mainCategoryNames.map((c) => (
              <option key={c} value={c}>
                {c} ({categoryCounts[c] ?? 0})
              </option>
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

      {/* Main Category Filter Chips */}
      <div className="filter-chips">
        {offerProductsCount > 0 && (
          <button
            type="button"
            className={offersOnly ? "active" : ""}
            style={{
              border: offersOnly ? "2px solid #800020" : "1px solid #D4B99F",
              background: offersOnly ? "#800020" : "#FFFDF9",
              color: offersOnly ? "#FFFFFF" : "#800020",
              fontWeight: 700,
            }}
            onClick={() => setOffersOnly(!offersOnly)}
          >
            <span>🎁 Festive Offers</span>{" "}
            <span style={{ opacity: 0.9, fontSize: "0.9em" }}>
              ({offerProductsCount})
            </span>
          </button>
        )}
        {mainCategoryNames.map((c) => {
          const count = categoryCounts[c] ?? 0;
          const isActive = category.toLowerCase() === c.toLowerCase();
          return (
            <button
              type="button"
              className={isActive ? "active" : ""}
              key={c}
              onClick={() => selectMainCategory(c)}
            >
              <span>{c}</span>{" "}
              <span style={{ opacity: 0.85, fontSize: "0.9em", fontWeight: 500 }}>
                ({count})
              </span>
            </button>
          );
        })}
      </div>

      {/* Visual Main Category Showcase when viewing All Sarees */}
      {category === "All" && mainCategoryObjects.length > 0 && (
        <section className="shop-maincat-showcase" style={{ marginBottom: 32 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 12 }}>
            <span className="eyebrow" style={{ margin: 0 }}>EXPLORE BY WEAVE &amp; SILK CATEGORY</span>
            <span style={{ fontSize: "13px", color: "var(--muted, #666)" }}>{mainCategoryObjects.length} Collections</span>
          </div>
          <div className="shop-maincat-grid">
            {mainCategoryObjects.map((m) => {
              const count = categoryCounts[m.name] ?? 0;
              const catSlug = m.slug || m.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
              const cover = m.image_path || "/assets/brand-logo.png";
              return (
                <Link
                  key={m.id}
                  href={`/shop/${encodeURIComponent(catSlug)}`}
                  className="shop-maincat-card"
                >
                  <div className="shop-maincat-thumb-wrap">
                    <img src={cover} alt={m.name} className="shop-maincat-thumb" loading="lazy" />
                  </div>
                  <div className="shop-maincat-info">
                    <h4>{m.name}</h4>
                    <span>{count} {count === 1 ? "style" : "styles"}</span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* Subcategories Showcase (shown when selected Main Category has custom subcategories and has active sarees) */}
      {category !== "All" &&
        filtered.length > 0 &&
        availableSubcategories.length > 0 &&
        availableSubcategories.some((s) => s.count > 0) && (
        <div className="shop-subcategory-section" aria-label={`${category} subcategories`}>
          <div className="shop-subcategory-header">
            <span className="eyebrow">Explore {category} Subcategories</span>
            {subcategory !== "All" && (
              <button
                type="button"
                className="text-link"
                onClick={() => selectSubcategory("All")}
              >
                Show all {category}
              </button>
            )}
          </div>
          <div className="shop-subcategory-grid">
            <button
              type="button"
              className={`shop-sub-card ${subcategory === "All" ? "active" : ""}`}
              onClick={() => selectSubcategory("All")}
            >
              <div className="shop-sub-thumb-wrap">
                {activeMainObj?.image_path ||
                  products.find((p) => isSareeInCat(p, category))?.image_path ? (
                  <img
                    src={
                      activeMainObj?.image_path ||
                      products.find((p) => isSareeInCat(p, category))?.image_path
                    }
                    alt={`All ${category}`}
                    loading="lazy"
                  />
                ) : (
                  <span className="shop-sub-placeholder">✦</span>
                )}
              </div>
              <div className="shop-sub-copy">
                <strong>All {category}</strong>
                <span>
                  {categoryCounts[category] ?? 0} styles
                </span>
              </div>
            </button>

            {availableSubcategories.map((sub) => (
              <button
                key={sub.id}
                type="button"
                className={`shop-sub-card ${subcategory === sub.name ? "active" : ""
                  }`}
                onClick={() => selectSubcategory(sub.name)}
              >
                <div className="shop-sub-thumb-wrap">
                  {sub.image_path ? (
                    <img src={sub.image_path} alt={sub.name} loading="lazy" />
                  ) : (
                    <span className="shop-sub-placeholder">✦</span>
                  )}
                </div>
                <div className="shop-sub-copy">
                  <strong>{sub.name}</strong>
                  <span>
                    {sub.count} {sub.count === 1 ? "style" : "styles"}
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <p className="subtle">
        {filtered.length} {filtered.length === 1 ? "saree" : "sarees"} ·{" "}
        {category === "All"
          ? "All styles"
          : subcategory === "All"
            ? category
            : `${category} › ${subcategory}`}
      </p>

      <div className="product-grid">
        {filtered.map((p) => (
          <ProductCard key={p.id} product={p} ordering={ordering} />
        ))}
      </div>
      {!filtered.length && (
        <div style={{ textAlign: "center", padding: "48px 16px" }}>
          <p className="empty" style={{ fontSize: "16px", marginBottom: "16px" }}>
            No sarees found in {category === "All" ? "catalogue" : category}.
          </p>
          {category !== "All" && (
            <button
              type="button"
              className="button"
              style={{
                background: "var(--wine, #800020)",
                color: "var(--cream, #FDFBF7)",
                borderRadius: "24px",
                padding: "10px 24px",
                cursor: "pointer",
                border: "none",
                fontWeight: 600,
              }}
              onClick={() => selectMainCategory("All")}
            >
              Browse All Sarees
            </button>
          )}
        </div>
      )}
    </>
  );
}
