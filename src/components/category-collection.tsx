"use client";
import React, { useMemo, useState } from "react";
import Link from "next/link";
import { CategoryItem, Product, Settings, money } from "@/lib/core";
import { Wave } from "./storefront";

export function isSareeInCategory(
  product: { category?: string; subcategory_id?: string; category_id?: string },
  category: { id: string; name: string },
  allCategories: { id: string; parent_id?: string | null }[],
): boolean {
  if (product.category_id && String(product.category_id) === String(category.id)) return true;
  if (product.subcategory_id) {
    if (String(product.subcategory_id) === String(category.id)) return true;
    const sub = allCategories.find((c) => String(c.id) === String(product.subcategory_id));
    if (sub && String(sub.parent_id) === String(category.id)) return true;
  }
  if (
    product.category &&
    String(product.category).trim().toLowerCase() === String(category.name).trim().toLowerCase()
  ) {
    return true;
  }
  return false;
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

type PriceFilter = "all" | "under5k" | "5k-10k" | "10k-20k" | "above20k";
type SortOption = "featured" | "price-asc" | "price-desc" | "name-asc";

export function CategoryCollectionPage({
  category,
  subCategory,
  categories,
  products,
  settings,
}: {
  category: CategoryItem;
  subCategory?: CategoryItem | null;
  categories: CategoryItem[];
  products: Product[];
  settings: Settings;
}) {
  const [selectedColour, setSelectedColour] = useState<string>("all");
  const [priceFilter, setPriceFilter] = useState<PriceFilter>("all");
  const [inStockOnly, setInStockOnly] = useState(false);
  const [sortBy, setSortBy] = useState<SortOption>("featured");
  const [searchQuery, setSearchQuery] = useState("");

  const catSlug = category.slug || category.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  // Subcategories under this main category
  const subCategories = useMemo(() => {
    return categories.filter(
      (c) =>
        c.parent_id === category.id &&
        c.active !== false &&
        c.name.toLowerCase() !== "all styles",
    );
  }, [categories, category]);

  // Base list: sarees in this specific main category (or specific subcategory if filtered)
  const baseCategoryProducts = useMemo(() => {
    if (subCategory) {
      return products.filter((p) => {
        if (p.subcategory_id && String(p.subcategory_id) === String(subCategory.id)) return true;
        if (
          isSareeInCategory(p, category, categories) &&
          p.subcategory_name &&
          p.subcategory_name.trim().toLowerCase() === subCategory.name.trim().toLowerCase()
        ) {
          return true;
        }
        return false;
      });
    }
    return products.filter((p) => isSareeInCategory(p, category, categories));
  }, [products, category, subCategory, categories]);

  // Distinct available colours in this collection
  const availableColours = useMemo(() => {
    const set = new Set<string>();
    for (const p of baseCategoryProducts) {
      if (p.colour) set.add(p.colour.trim());
    }
    return Array.from(set).sort();
  }, [baseCategoryProducts]);

  // Other active collections for bottom cross-navigation
  const otherCategories = useMemo(() => {
    return categories
      .filter((c) => !c.parent_id && c.active !== false && c.id !== category.id)
      .slice(0, 4);
  }, [categories, category]);

  // Filtered & sorted products
  const filteredProducts = useMemo(() => {
    let list = [...baseCategoryProducts];

    // Search query filter
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.sku.toLowerCase().includes(q) ||
          (p.description && p.description.toLowerCase().includes(q)),
      );
    }

    // Colour filter
    if (selectedColour !== "all") {
      list = list.filter(
        (p) => (p.colour || "").trim().toLowerCase() === selectedColour.toLowerCase(),
      );
    }

    // In stock filter
    if (inStockOnly) {
      list = list.filter((p) => Number(p.available || 0) > 0);
    }

    // Price range filter
    if (priceFilter === "under5k") {
      list = list.filter((p) => (p.price_paise || 0) < 500000);
    } else if (priceFilter === "5k-10k") {
      list = list.filter(
        (p) => (p.price_paise || 0) >= 500000 && (p.price_paise || 0) <= 1000000,
      );
    } else if (priceFilter === "10k-20k") {
      list = list.filter(
        (p) => (p.price_paise || 0) >= 1000000 && (p.price_paise || 0) <= 2000000,
      );
    } else if (priceFilter === "above20k") {
      list = list.filter((p) => (p.price_paise || 0) > 2000000);
    }

    // Sorting
    list.sort((a, b) => {
      if (sortBy === "price-asc") {
        return (a.price_paise || 0) - (b.price_paise || 0);
      }
      if (sortBy === "price-desc") {
        return (b.price_paise || 0) - (a.price_paise || 0);
      }
      if (sortBy === "name-asc") {
        return a.name.localeCompare(b.name);
      }
      // featured default
      if (a.featured && !b.featured) return -1;
      if (!a.featured && b.featured) return 1;
      return 0;
    });

    return list;
  }, [baseCategoryProducts, searchQuery, selectedColour, inStockOnly, priceFilter, sortBy]);

  const hasActiveFilters =
    selectedColour !== "all" || priceFilter !== "all" || inStockOnly || Boolean(searchQuery.trim());

  function resetFilters() {
    setSelectedColour("all");
    setPriceFilter("all");
    setInStockOnly(false);
    setSearchQuery("");
  }

  const coverImage =
    category.image_path ||
    baseCategoryProducts.find((p) => p.image_path)?.image_path ||
    "/assets/brand-logo.png";

  return (
    <div className="cat-collection-root">
      {/* Breadcrumb Navigation */}
      <nav className="cat-collection-crumbs" aria-label="Breadcrumb">
        <div className="cat-collection-crumbs-inner">
          <Link href="/" className="cat-crumb-link">
            Home
          </Link>
          <span className="cat-crumb-sep">/</span>
          <Link href="/shop" className="cat-crumb-link">
            Shop
          </Link>
          <span className="cat-crumb-sep">/</span>
          {subCategory ? (
            <>
              <Link href={`/shop/${encodeURIComponent(catSlug)}`} className="cat-crumb-link">
                {category.name}
              </Link>
              <span className="cat-crumb-sep">/</span>
              <span className="cat-crumb-current">{subCategory.name}</span>
            </>
          ) : (
            <span className="cat-crumb-current">{category.name}</span>
          )}
        </div>
      </nav>

      {/* Luxury Hero Banner */}
      <header className="cat-collection-hero">
        <div className="cat-hero-bg-wrap">
          <img
            src={subCategory?.image_path || coverImage}
            alt={subCategory ? `${subCategory.name} ${category.name}` : category.name}
            className="cat-hero-bg-img"
            fetchPriority="high"
          />
          <div className="cat-hero-overlay" />
        </div>

        <div className="cat-hero-content">
          <span className="cat-hero-eyebrow">
            மகரந்தம் சில்க்ஸ் · {category.name.toUpperCase()} {subCategory ? `› ${subCategory.name.toUpperCase()}` : "COLLECTION"}
          </span>
          <h1 className="cat-hero-title">
            {subCategory ? `${subCategory.name} ${category.name} Sarees` : `${category.name} Silk Sarees`}
          </h1>
          <p className="cat-hero-desc">
            {subCategory?.description ||
              category.description ||
              `Discover our exclusive collection of authentic ${category.name} silk sarees, handwoven with exquisite zari borders and timeless traditional motifs.`}
          </p>
          <div className="cat-hero-meta-row">
            <span className="cat-count-badge">
              ✦ {baseCategoryProducts.length}{" "}
              {baseCategoryProducts.length === 1 ? "Saree" : "Sarees"} in {subCategory ? subCategory.name : category.name}
            </span>
            <span className="cat-weft-badge">100% Pure Mulberry Silk &amp; Handloom</span>
          </div>
        </div>
        <Wave />
      </header>

      {/* LEVEL 2: SUBCATEGORY SELECTION CARDS (Customer flow) */}
      {subCategories.length > 0 && (
        <section className="cat-subcat-nav-section">
          <div className="cat-subcat-nav-inner">
            <div className="cat-subcat-nav-header">
              <span className="eyebrow" style={{ margin: 0 }}>
                {category.name} Subcategories &amp; Styles
              </span>
              {subCategory && (
                <Link href={`/shop/${encodeURIComponent(catSlug)}`} className="cat-view-all-sub-btn">
                  View All {category.name} Sarees ({products.filter((p) => isSareeInCategory(p, category, categories)).length}) →
                </Link>
              )}
            </div>
            <div className="cat-subcat-chips-row">
              <Link
                href={`/shop/${encodeURIComponent(catSlug)}`}
                className={`cat-subcat-pill ${!subCategory ? "active" : ""}`}
              >
                All {category.name}
              </Link>
              {subCategories.map((sub) => {
                const subSlug = sub.slug || sub.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
                const isSelected = subCategory?.id === sub.id || subCategory?.slug === sub.slug;
                const subCount = products.filter(
                  (p) =>
                    p.subcategory_id === sub.id ||
                    (isSareeInCategory(p, category, categories) &&
                      p.subcategory_name?.toLowerCase() === sub.name.toLowerCase()),
                ).length;
                return (
                  <Link
                    key={sub.id}
                    href={`/shop/${encodeURIComponent(catSlug)}/${encodeURIComponent(subSlug)}`}
                    className={`cat-subcat-pill ${isSelected ? "active" : ""}`}
                  >
                    <span>{sub.name}</span>
                    <span className="cat-subcat-pill-count">{subCount}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {/* Filter and Control Bar */}
      <section className="cat-controls-section">
        <div className="cat-controls-bar">
          {/* Search within category */}
          <div className="cat-search-wrap">
            <svg
              className="cat-search-icon"
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="search"
              placeholder={`Search in ${category.name}...`}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="cat-search-input"
              aria-label="Search within collection"
            />
          </div>

          <div className="cat-filter-groups">
            {/* Colour filter */}
            {availableColours.length > 0 && (
              <label className="cat-filter-label">
                <span>Colour</span>
                <select
                  value={selectedColour}
                  onChange={(e) => setSelectedColour(e.target.value)}
                  className="cat-filter-select"
                >
                  <option value="all">All Colours ({availableColours.length})</option>
                  {availableColours.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {/* Price filter */}
            <label className="cat-filter-label">
              <span>Price</span>
              <select
                value={priceFilter}
                onChange={(e) => setPriceFilter(e.target.value as PriceFilter)}
                className="cat-filter-select"
              >
                <option value="all">All Prices</option>
                <option value="under5k">Under ₹5,000</option>
                <option value="5k-10k">₹5,000 – ₹10,000</option>
                <option value="10k-20k">₹10,000 – ₹20,000</option>
                <option value="above20k">Above ₹20,000</option>
              </select>
            </label>

            {/* In-stock toggle */}
            <label className="cat-stock-toggle">
              <input
                type="checkbox"
                checked={inStockOnly}
                onChange={(e) => setInStockOnly(e.target.checked)}
              />
              <span>In Stock Only</span>
            </label>

            {/* Sort order */}
            <label className="cat-filter-label">
              <span>Sort</span>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                className="cat-filter-select"
              >
                <option value="featured">Featured First</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="name-asc">Name: A to Z</option>
              </select>
            </label>
          </div>
        </div>

        {/* Active Filters Bar */}
        {hasActiveFilters && (
          <div className="cat-active-filters-row">
            <span className="cat-active-label">Active Filters:</span>
            {selectedColour !== "all" && (
              <span className="cat-active-pill">
                Colour: {selectedColour}
                <button
                  type="button"
                  onClick={() => setSelectedColour("all")}
                  aria-label="Remove colour filter"
                >
                  ✕
                </button>
              </span>
            )}
            {priceFilter !== "all" && (
              <span className="cat-active-pill">
                Price:{" "}
                {priceFilter === "under5k"
                  ? "Under ₹5,000"
                  : priceFilter === "5k-10k"
                    ? "₹5,000 – ₹10,000"
                    : priceFilter === "10k-20k"
                      ? "₹10,000 – ₹20,000"
                      : "Above ₹20,000"}
                <button
                  type="button"
                  onClick={() => setPriceFilter("all")}
                  aria-label="Remove price filter"
                >
                  ✕
                </button>
              </span>
            )}
            {inStockOnly && (
              <span className="cat-active-pill">
                In Stock Only
                <button
                  type="button"
                  onClick={() => setInStockOnly(false)}
                  aria-label="Remove stock filter"
                >
                  ✕
                </button>
              </span>
            )}
            {searchQuery.trim() && (
              <span className="cat-active-pill">
                "{searchQuery}"
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  aria-label="Remove search filter"
                >
                  ✕
                </button>
              </span>
            )}
            <button
              type="button"
              className="cat-clear-all-btn"
              onClick={resetFilters}
            >
              Clear All Filters
            </button>
          </div>
        )}
      </section>

      {/* Main Saree Grid or Empty State */}
      <main className="cat-collection-grid-container">
        {filteredProducts.length > 0 ? (
          <div className="cat-collection-grid">
            {filteredProducts.map((p) => {
              const inStock = Number(p.available || 0) > 0;
              const isLowStock = inStock && Number(p.available || 0) <= 2;
              return (
                <article key={p.id} className="cat-product-card">
                  <Link href={`/products/${p.slug}`} className="cat-product-thumb-link">
                    <div className="cat-product-thumb-wrap">
                      <img
                        src={p.image_path || "/assets/brand-logo.png"}
                        alt={p.name}
                        className="cat-product-img"
                        loading="lazy"
                      />
                      {p.featured && (
                        <span className="cat-card-badge cat-featured-badge">
                          Featured
                        </span>
                      )}
                      {!inStock ? (
                        <span className="cat-card-badge cat-sold-badge">
                          Sold Out
                        </span>
                      ) : isLowStock ? (
                        <span className="cat-card-badge cat-low-badge">
                          Only {p.available} Left
                        </span>
                      ) : null}
                    </div>
                  </Link>

                  <div className="cat-product-info">
                    <div className="cat-product-header">
                      {p.colour && (
                        <div className="cat-product-colour-tag">
                          <span
                            className="cat-card-colour-dot"
                            style={{ backgroundColor: colourHex(p.colour) }}
                            aria-hidden="true"
                          />
                          <span>{p.colour}</span>
                        </div>
                      )}
                      <span className="cat-sku-tag">{p.sku}</span>
                    </div>

                    <h2 className="cat-product-title">
                      <Link href={`/products/${p.slug}`}>{p.name}</Link>
                    </h2>

                    <div className="cat-product-price-row">
                      <span className="cat-price-val">
                        {money(p.effective_price_paise ?? p.price_paise)}
                      </span>
                      {p.discount_percent > 0 && (
                        <span className="cat-discount-tag">
                          {p.discount_percent}% OFF
                        </span>
                      )}
                    </div>

                    <div className="cat-product-actions">
                      <Link
                        href={`/products/${p.slug}`}
                        className="button cat-view-btn"
                      >
                        <span>View Saree</span>
                        <span aria-hidden="true">↗</span>
                      </Link>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="cat-empty-state">
            <div className="cat-empty-icon">🪡</div>
            <h2 className="cat-empty-title">
              {hasActiveFilters
                ? "No sarees match your current filter selections"
                : `No sarees available in ${category.name} collection yet.`}
            </h2>
            <p className="cat-empty-text">
              {hasActiveFilters
                ? "Try clearing or resetting some of your filters above to see more sarees."
                : "Our master weavers are crafting new pieces for this collection. Please check back soon or explore our other collections."}
            </p>
            <div className="cat-empty-actions">
              {hasActiveFilters ? (
                <button
                  type="button"
                  className="button gold-btn"
                  onClick={resetFilters}
                >
                  Clear All Filters
                </button>
              ) : (
                <Link href="/shop" className="button gold-btn">
                  Browse All Sarees ↗
                </Link>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Cross-Collection Recommendations */}
      {otherCategories.length > 0 && (
        <section className="cat-other-collections-section">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Explore More Weaves &amp; Silks</p>
              <h2>Other Collections You May Like</h2>
            </div>
            <Link href="/shop" className="text-link">
              View all sarees ↗
            </Link>
          </div>
          <div className="cat-other-grid">
            {otherCategories.map((c) => (
              <Link
                key={c.id}
                href={`/category/${c.slug}`}
                className="cat-other-card"
              >
                <div className="cat-other-thumb">
                  <img
                    src={c.image_path || "/assets/brand-logo.png"}
                    alt={c.name}
                    loading="lazy"
                  />
                  <div className="cat-other-overlay" />
                </div>
                <div className="cat-other-meta">
                  <h3>{c.name} Silk</h3>
                  <span>Explore Collection ↗</span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
