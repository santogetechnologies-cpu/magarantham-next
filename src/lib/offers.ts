// src/lib/offers.ts
// Magarantham Silks: Core Dynamic Discount & Offer Calculation Engine

export type OfferTargetType = "all" | "category" | "subcategory" | "product";

export type OfferTargetRecord = {
  id?: string;
  offer_id: string;
  target_type: "category" | "subcategory" | "product";
  category_id?: string | null;
  subcategory_id?: string | null;
  product_id?: string | null;
};

export type EnhancedOffer = {
  id: string;
  title: string;
  code: string | null;
  kind: "percent" | "fixed";
  value: number; // percent (e.g. 20) or fixed amount in paise (e.g. 50000 for ₹500)
  min_subtotal_paise: number;
  max_discount_paise: number | null;
  max_uses: number | null;
  used_count: number;
  per_customer_limit: number;
  active: boolean;
  starts_at: string | null;
  ends_at: string | null;
  target_type: OfferTargetType;
  priority: number;
  description?: string | null;
  targets?: OfferTargetRecord[];
};

export type ProductOfferResult = {
  originalPricePaise: number;
  effectivePricePaise: number;
  discountPaise: number;
  savingsPaise: number;
  appliedOffer: EnhancedOffer | null;
  offerLevel: "product" | "subcategory" | "category" | "storewide" | "catalog_default" | null;
  badgeText: string | null;
  percentOff: number;
};

/**
 * Check if an offer is currently active, started, not expired, and within usage limits.
 */
export function isOfferValid(offer: EnhancedOffer, now = Date.now()): boolean {
  if (!offer || !offer.active) return false;
  if (offer.starts_at) {
    const start = new Date(offer.starts_at).getTime();
    if (!isNaN(start) && start > now) return false;
  }
  if (offer.ends_at) {
    const end = new Date(offer.ends_at).getTime();
    if (!isNaN(end) && end <= now) return false;
  }
  if (offer.max_uses !== null && offer.max_uses !== undefined) {
    if (offer.used_count >= offer.max_uses) return false;
  }
  return true;
}

/**
 * Check if a specific target record matches the given product.
 */
export function matchesTarget(
  target: OfferTargetRecord,
  product: {
    id: string;
    category?: string;
    category_id?: string;
    subcategory_id?: string | null;
  },
  categoryMap?: Map<string, { id: string; parent_id?: string | null; name: string }>,
): boolean {
  const pid = String(product.id || "").toLowerCase();
  const subId = String(product.subcategory_id || "").toLowerCase();
  const catId = String(product.category_id || "").toLowerCase();

  if (target.target_type === "product") {
    return target.product_id ? String(target.product_id).toLowerCase() === pid : false;
  }

  if (target.target_type === "subcategory") {
    if (!target.subcategory_id) return false;
    const targetSubId = String(target.subcategory_id).toLowerCase();
    if (subId && subId === targetSubId) return true;
    // Check if categoryMap has matching subcategory
    if (categoryMap && subId) {
      const sub = categoryMap.get(subId);
      if (sub && String(sub.id).toLowerCase() === targetSubId) return true;
    }
    return false;
  }

  if (target.target_type === "category") {
    if (!target.category_id) return false;
    const targetCatId = String(target.category_id).toLowerCase();
    // Direct category ID match
    if (catId && catId === targetCatId) return true;
    // Product belongs to a subcategory whose parent is targetCatId
    if (subId && categoryMap) {
      const sub = categoryMap.get(subId);
      if (sub && sub.parent_id && String(sub.parent_id).toLowerCase() === targetCatId) {
        return true;
      }
    }
    // Name matching fallback
    if (categoryMap && product.category) {
      const targetCat = categoryMap.get(targetCatId);
      if (
        targetCat &&
        targetCat.name.trim().toLowerCase() === product.category.trim().toLowerCase()
      ) {
        return true;
      }
    }
    return false;
  }

  return false;
}

/**
 * Resolves whether an offer applies to a product, and at what targeting tier.
 * Returns the matched tier or null if not applicable.
 */
export function getOfferMatchTier(
  offer: EnhancedOffer,
  product: {
    id: string;
    category?: string;
    category_id?: string;
    subcategory_id?: string | null;
  },
  categoryMap?: Map<string, { id: string; parent_id?: string | null; name: string }>,
): "product" | "subcategory" | "category" | "storewide" | null {
  const targetType = offer.target_type || "all";
  const targets = offer.targets || [];

  if (targetType === "product") {
    const matches = targets.some((t) => t.target_type === "product" && matchesTarget(t, product, categoryMap));
    return matches ? "product" : null;
  }

  if (targetType === "subcategory") {
    const matches = targets.some((t) => t.target_type === "subcategory" && matchesTarget(t, product, categoryMap));
    return matches ? "subcategory" : null;
  }

  if (targetType === "category") {
    const matches = targets.some((t) => t.target_type === "category" && matchesTarget(t, product, categoryMap));
    return matches ? "category" : null;
  }

  if (targetType === "all") {
    return "storewide";
  }

  return null;
}

/**
 * Calculate raw discount in paise for a single item.
 */
export function calculateOfferDiscountPaise(
  offer: EnhancedOffer,
  pricePaise: number,
): number {
  if (pricePaise <= 0) return 0;
  let discount = 0;
  if (offer.kind === "percent") {
    discount = Math.round((pricePaise * Math.min(90, Math.max(0, offer.value))) / 100);
  } else {
    // Fixed discount: offer.value is in paise
    discount = offer.value;
  }
  if (offer.max_discount_paise && offer.max_discount_paise > 0) {
    discount = Math.min(discount, offer.max_discount_paise);
  }
  return Math.min(pricePaise, Math.max(0, discount));
}

/**
 * Core discount resolver for a product.
 * Implements 4-tier strict priority:
 * 1. Product-specific offer
 * 2. Subcategory-specific offer
 * 3. Main category-specific offer
 * 4. Existing product discount (catalog default)
 *
 * Within the same level: highest priority integer wins; then highest discount amount.
 * No stacking by default.
 */
export function resolveProductOffer(
  product: {
    id: string;
    price_paise: number;
    discount_percent?: number;
    category?: string;
    category_id?: string;
    subcategory_id?: string | null;
  },
  offers: EnhancedOffer[],
  categoryMap?: Map<string, { id: string; parent_id?: string | null; name: string }>,
  now = Date.now(),
): ProductOfferResult {
  const originalPricePaise = product.price_paise || 0;
  if (originalPricePaise <= 0) {
    return {
      originalPricePaise: 0,
      effectivePricePaise: 0,
      discountPaise: 0,
      savingsPaise: 0,
      appliedOffer: null,
      offerLevel: null,
      badgeText: null,
      percentOff: 0,
    };
  }

  // Filter valid, un-coded (automatic) offers or store offers
  // Note: Offers with a coupon code require manual entry at checkout,
  // whereas automatic promotional offers (code === null or code === "") show on product cards
  const eligibleOffers = (offers || []).filter(
    (o) => isOfferValid(o, now) && (!o.code || o.code.trim() === ""),
  );

  const matchedCandidates: {
    offer: EnhancedOffer;
    tier: "product" | "subcategory" | "category" | "storewide";
    tierRank: number; // 4: product, 3: subcategory, 2: category, 1: storewide
    discountPaise: number;
    priority: number;
  }[] = [];

  for (const offer of eligibleOffers) {
    const tier = getOfferMatchTier(offer, product, categoryMap);
    if (tier) {
      const tierRank =
        tier === "product" ? 4 : tier === "subcategory" ? 3 : tier === "category" ? 2 : 1;
      const discountPaise = calculateOfferDiscountPaise(offer, originalPricePaise);
      matchedCandidates.push({
        offer,
        tier,
        tierRank,
        discountPaise,
        priority: offer.priority || 0,
      });
    }
  }

  // Sort candidates by:
  // 1. Tier Rank (product > subcategory > category > storewide)
  // 2. Priority integer (descending)
  // 3. Discount magnitude (descending)
  matchedCandidates.sort((a, b) => {
    if (a.tierRank !== b.tierRank) return b.tierRank - a.tierRank;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return b.discountPaise - a.discountPaise;
  });

  const bestOffer = matchedCandidates[0];

  if (bestOffer && bestOffer.discountPaise > 0) {
    const effectivePricePaise = Math.max(0, originalPricePaise - bestOffer.discountPaise);
    const savingsPaise = bestOffer.discountPaise;
    const percentOff = Math.round((savingsPaise / originalPricePaise) * 100);
    const badgeText =
      bestOffer.offer.kind === "percent"
        ? `${bestOffer.offer.value}% OFF`
        : `₹${Math.round(bestOffer.discountPaise / 100)} OFF`;

    return {
      originalPricePaise,
      effectivePricePaise,
      discountPaise: bestOffer.discountPaise,
      savingsPaise,
      appliedOffer: bestOffer.offer,
      offerLevel: bestOffer.tier,
      badgeText,
      percentOff,
    };
  }

  // Tier 4: Existing Product Discount fallback (catalog default)
  const defaultDiscountPercent = product.discount_percent || 0;
  if (defaultDiscountPercent > 0) {
    const discountPaise = Math.round((originalPricePaise * defaultDiscountPercent) / 100);
    const effectivePricePaise = Math.max(0, originalPricePaise - discountPaise);
    return {
      originalPricePaise,
      effectivePricePaise,
      discountPaise,
      savingsPaise: discountPaise,
      appliedOffer: null,
      offerLevel: "catalog_default",
      badgeText: `${defaultDiscountPercent}% OFF`,
      percentOff: defaultDiscountPercent,
    };
  }

  return {
    originalPricePaise,
    effectivePricePaise: originalPricePaise,
    discountPaise: 0,
    savingsPaise: 0,
    appliedOffer: null,
    offerLevel: null,
    badgeText: null,
    percentOff: 0,
  };
}

/**
 * Apply offers across a list of products, enriching each with effective price and offer details.
 */
export function applyOffersToProducts<
  T extends {
    id: string;
    price_paise: number;
    discount_percent: number;
    effective_price_paise?: number;
    category?: string;
    category_id?: string;
    subcategory_id?: string | null;
  },
>(
  products: T[],
  offers: EnhancedOffer[],
  categoryMap?: Map<string, { id: string; parent_id?: string | null; name: string }>,
  now = Date.now(),
): (T & {
  effective_price_paise: number;
  offer_badge?: string | null;
  offer_savings_paise?: number;
  applied_offer_title?: string | null;
  offer_level?: string | null;
})[] {
  return products.map((prod) => {
    const res = resolveProductOffer(prod, offers, categoryMap, now);
    return {
      ...prod,
      effective_price_paise: res.effectivePricePaise,
      offer_badge: res.badgeText,
      offer_savings_paise: res.savingsPaise,
      applied_offer_title: res.appliedOffer ? res.appliedOffer.title : null,
      offer_level: res.offerLevel,
    };
  });
}

/**
 * Helper to build category lookup map.
 */
export function buildCategoryMap(
  categories: { id: string; parent_id?: string | null; name: string }[],
): Map<string, { id: string; parent_id?: string | null; name: string }> {
  const map = new Map<string, { id: string; parent_id?: string | null; name: string }>();
  for (const c of categories || []) {
    map.set(String(c.id).toLowerCase(), c);
  }
  return map;
}
