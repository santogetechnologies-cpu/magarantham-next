// tests/offers.test.ts
// Unit tests for Magarantham Silks: Category, Subcategory & Product-Wise Dynamic Offer System

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  resolveProductOffer,
  applyOffersToProducts,
  buildCategoryMap,
  isOfferValid,
  calculateOfferDiscountPaise,
  EnhancedOffer,
} from "../src/lib/offers";

const mockCategories = [
  { id: "cat-kanchi", parent_id: null, name: "Kanchipuram" },
  { id: "sub-pure-zari", parent_id: "cat-kanchi", name: "Pure Zari" },
  { id: "sub-korvai", parent_id: "cat-kanchi", name: "Korvai" },
  { id: "cat-soft-silk", parent_id: null, name: "Soft Silk" },
  { id: "sub-bridal-soft", parent_id: "cat-soft-silk", name: "Bridal Soft Silk" },
];

const categoryMap = buildCategoryMap(mockCategories);

const testProduct = {
  id: "prod-saree-101",
  name: "Kanchipuram Pure Zari Wedding Saree",
  price_paise: 1000000, // ₹10,000
  discount_percent: 5,  // 5% default catalog discount
  category: "Kanchipuram",
  category_id: "cat-kanchi",
  subcategory_id: "sub-pure-zari",
};

test("Tier 1: Product-specific offer takes absolute priority over subcategory and category offers", () => {
  const productOffer: EnhancedOffer = {
    id: "off-prod",
    title: "Saree 101 Special",
    code: null,
    kind: "percent",
    value: 25, // 25% off
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: null,
    ends_at: null,
    target_type: "product",
    priority: 1,
    targets: [{ offer_id: "off-prod", target_type: "product", product_id: "prod-saree-101" }],
  };

  const subcategoryOffer: EnhancedOffer = {
    id: "off-sub",
    title: "Pure Zari 30% Mega Sale",
    code: null,
    kind: "percent",
    value: 30, // 30% off (higher percent, but lower tier)
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: null,
    ends_at: null,
    target_type: "subcategory",
    priority: 99,
    targets: [{ offer_id: "off-sub", target_type: "subcategory", subcategory_id: "sub-pure-zari" }],
  };

  const categoryOffer: EnhancedOffer = {
    id: "off-cat",
    title: "Kanchipuram 15% Festival",
    code: null,
    kind: "percent",
    value: 15,
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: null,
    ends_at: null,
    target_type: "category",
    priority: 50,
    targets: [{ offer_id: "off-cat", target_type: "category", category_id: "cat-kanchi" }],
  };

  const result = resolveProductOffer(
    testProduct,
    [categoryOffer, subcategoryOffer, productOffer],
    categoryMap,
  );

  // Product-specific offer wins
  assert.equal(result.offerLevel, "product");
  assert.equal(result.appliedOffer?.id, "off-prod");
  assert.equal(result.discountPaise, 250000); // 25% of 10,000 = ₹2,500
  assert.equal(result.effectivePricePaise, 750000); // ₹7,500
  assert.equal(result.badgeText, "25% OFF");
});

test("Tier 2: Subcategory offer takes priority over Category offer and Catalog default", () => {
  const subcategoryOffer: EnhancedOffer = {
    id: "off-sub",
    title: "Pure Zari Subcategory Offer",
    code: null,
    kind: "fixed",
    value: 200000, // ₹2,000 off in paise
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: null,
    ends_at: null,
    target_type: "subcategory",
    priority: 5,
    targets: [{ offer_id: "off-sub", target_type: "subcategory", subcategory_id: "sub-pure-zari" }],
  };

  const categoryOffer: EnhancedOffer = {
    id: "off-cat",
    title: "Kanchipuram Category Offer",
    code: null,
    kind: "percent",
    value: 10,
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: null,
    ends_at: null,
    target_type: "category",
    priority: 10,
    targets: [{ offer_id: "off-cat", target_type: "category", category_id: "cat-kanchi" }],
  };

  const result = resolveProductOffer(
    testProduct,
    [categoryOffer, subcategoryOffer],
    categoryMap,
  );

  assert.equal(result.offerLevel, "subcategory");
  assert.equal(result.appliedOffer?.id, "off-sub");
  assert.equal(result.discountPaise, 200000); // ₹2,000
  assert.equal(result.effectivePricePaise, 800000); // ₹8,000
});

test("Tier 3: Category offer applies when no product or subcategory offer exists", () => {
  const categoryOffer: EnhancedOffer = {
    id: "off-cat",
    title: "Kanchipuram 15% Festival",
    code: null,
    kind: "percent",
    value: 15,
    min_subtotal_paise: 0,
    max_discount_paise: 100000, // Max cap ₹1,000
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: null,
    ends_at: null,
    target_type: "category",
    priority: 0,
    targets: [{ offer_id: "off-cat", target_type: "category", category_id: "cat-kanchi" }],
  };

  const result = resolveProductOffer(testProduct, [categoryOffer], categoryMap);

  assert.equal(result.offerLevel, "category");
  assert.equal(result.appliedOffer?.id, "off-cat");
  // 15% of 10,000 = 1,500, but capped at max_discount_paise = 1,000
  assert.equal(result.discountPaise, 100000);
  assert.equal(result.effectivePricePaise, 900000);
});

test("Tier 4: Catalog default discount applies when no promotional offer matches", () => {
  const unrelatedCategoryOffer: EnhancedOffer = {
    id: "off-soft-silk",
    title: "Soft Silk Festive 20%",
    code: null,
    kind: "percent",
    value: 20,
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: null,
    ends_at: null,
    target_type: "category",
    priority: 0,
    targets: [{ offer_id: "off-soft-silk", target_type: "category", category_id: "cat-soft-silk" }],
  };

  const result = resolveProductOffer(testProduct, [unrelatedCategoryOffer], categoryMap);

  // Fallback to product.discount_percent = 5%
  assert.equal(result.offerLevel, "catalog_default");
  assert.equal(result.appliedOffer, null);
  assert.equal(result.discountPaise, 50000); // 5% of 10,000 = ₹500
  assert.equal(result.effectivePricePaise, 950000); // ₹9,500
  assert.equal(result.badgeText, "5% OFF");
});

test("Tie-breaking: Higher priority integer wins within same targeting level", () => {
  const catOfferLowPriority: EnhancedOffer = {
    id: "off-cat-low",
    title: "Standard Kanchipuram 10%",
    code: null,
    kind: "percent",
    value: 10,
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: null,
    ends_at: null,
    target_type: "category",
    priority: 5,
    targets: [{ offer_id: "off-cat-low", target_type: "category", category_id: "cat-kanchi" }],
  };

  const catOfferHighPriority: EnhancedOffer = {
    id: "off-cat-high",
    title: "VIP Kanchipuram 12%",
    code: null,
    kind: "percent",
    value: 12,
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: null,
    ends_at: null,
    target_type: "category",
    priority: 20, // Higher priority wins!
    targets: [{ offer_id: "off-cat-high", target_type: "category", category_id: "cat-kanchi" }],
  };

  const result = resolveProductOffer(
    testProduct,
    [catOfferLowPriority, catOfferHighPriority],
    categoryMap,
  );

  assert.equal(result.appliedOffer?.id, "off-cat-high");
  assert.equal(result.discountPaise, 120000); // 12% = ₹1,200
});

test("Date validation: Future or expired offers are excluded", () => {
  const now = 1700000000000;

  const expiredOffer: EnhancedOffer = {
    id: "off-exp",
    title: "Expired Offer",
    code: null,
    kind: "percent",
    value: 50,
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: new Date(now - 100000).toISOString(),
    ends_at: new Date(now - 1000).toISOString(), // Expired
    target_type: "product",
    priority: 10,
    targets: [{ offer_id: "off-exp", target_type: "product", product_id: "prod-saree-101" }],
  };

  const futureOffer: EnhancedOffer = {
    id: "off-fut",
    title: "Future Offer",
    code: null,
    kind: "percent",
    value: 50,
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: new Date(now + 100000).toISOString(), // Starts later
    ends_at: new Date(now + 200000).toISOString(),
    target_type: "product",
    priority: 10,
    targets: [{ offer_id: "off-fut", target_type: "product", product_id: "prod-saree-101" }],
  };

  assert.equal(isOfferValid(expiredOffer, now), false);
  assert.equal(isOfferValid(futureOffer, now), false);

  const result = resolveProductOffer(testProduct, [expiredOffer, futureOffer], categoryMap, now);
  // Both invalid, falls back to catalog default 5%
  assert.equal(result.offerLevel, "catalog_default");
  assert.equal(result.discountPaise, 50000);
});

test("applyOffersToProducts enriches a list of products accurately", () => {
  const categoryOffer: EnhancedOffer = {
    id: "off-kanchi-20",
    title: "Kanchipuram 20% Mega",
    code: null,
    kind: "percent",
    value: 20,
    min_subtotal_paise: 0,
    max_discount_paise: null,
    max_uses: null,
    used_count: 0,
    per_customer_limit: 1,
    active: true,
    starts_at: null,
    ends_at: null,
    target_type: "category",
    priority: 10,
    targets: [{ offer_id: "off-kanchi-20", target_type: "category", category_id: "cat-kanchi" }],
  };

  const enriched = applyOffersToProducts(
    [testProduct],
    [categoryOffer],
    categoryMap,
  );

  assert.equal(enriched[0].effective_price_paise, 800000); // ₹8,000
  assert.equal(enriched[0].offer_badge, "20% OFF");
  assert.equal(enriched[0].offer_savings_paise, 200000); // Save ₹2,000
  assert.equal(enriched[0].applied_offer_title, "Kanchipuram 20% Mega");
});
