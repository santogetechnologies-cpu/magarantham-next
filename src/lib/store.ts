import "server-only";
import { service, configured, Fault } from "./server";
import { CategoryItem, publicProduct, Settings } from "./core";
import { enrichCategories } from "./erp-server";
import { seedProducts } from "./seed";
import { getPiecesMap } from "./piece-server";
import { getOffersWithTargets } from "./offers-server";
import { applyOffersToProducts, buildCategoryMap, isOfferValid } from "./offers";
export const defaultSettings: Settings = {
  brand_name: "மகரந்தம் சில்க்ஸ்",
  tagline: "Sarees for every occasion.",
  support_email: "",
  support_phone: "",
  bulk_phone: "",
  bulk_min_quantity: 10,
  whatsapp_phone: "",
  checkout_mode: "whatsapp_only",
  online_method: "manual_upi",
  upi_id: "",
  upi_name: "",
  ordering_enabled: false,
  shipping_paise: 0,
  free_shipping_above_paise: 0,
  tax_bps: 0,
  reservation_minutes: 60,
  announcement: "Silk, cotton, bridal and more. View all 20 styles.",
  hero_title: "Sarees for every occasion.",
  hero_text: "Silk, cotton, bridal and more. Find a saree you love.",
  hero_image: "/assets/hero.jpg",
  logo_image: "/assets/brand-logo.png",
};
export async function getStore() {
  if (!configured())
    return {
      settings: defaultSettings,
      products: seedProducts.map(publicProduct),
      categories: [] as CategoryItem[],
      banners: [],
      offers: [],
      connected: false,
    };
  const db = service();
  const [s, pRes, b, allOffers, c] = await Promise.all([
    db.from("store_settings").select("*").eq("id", true).single(),
    db
      .from("store_catalogue")
      .select("*")
      .eq("published", true)
      .eq("archived", false)
      .order("created_at"),
    db.from("banners").select("*").eq("published", true).order("sort_order"),
    getOffersWithTargets().catch(() => []),
    db
      .from("product_categories")
      .select("*")
      .eq("active", true)
      .order("created_at"),
  ]);

  let rawCatalogue = pRes.data || [];
  // If store_catalogue view had an error, fallback to direct products table query
  if (pRes.error || !pRes.data) {
    const directProds = await db
      .from("products")
      .select("*")
      .eq("published", true)
      .eq("archived", false)
      .order("created_at");
    if (directProds.data) {
      rawCatalogue = directProds.data;
    }
  }

  // Filter out any archived or unpublished products strictly
  const piecesMap = await getPiecesMap();
  const rawPublishedProducts = rawCatalogue
    // Hidden categories/subcategories are not sellable online (checkout rejects them), so hide them here too.
    .filter((prod: Record<string, unknown>) => prod.published === true && prod.archived !== true && prod.category_visible !== false)
    .map((prod) => {
      const pid = String(prod.id);
      return publicProduct({
        ...prod,
        pieces: piecesMap[pid] || [],
      });
    });

  const now = Date.now();
  const activeOffers = (allOffers || []).filter((o) => isOfferValid(o, now));

  const rawCats = (c.data || []) as CategoryItem[];
  const categories = await enrichCategories(rawCats);
  const categoryMap = buildCategoryMap(categories);

  // Apply offers across all published products with priority rules
  const publishedProducts = applyOffersToProducts(
    rawPublishedProducts,
    activeOffers,
    categoryMap,
    now,
  );

  const active = (x: { starts_at: string | null; ends_at: string | null }) =>
    (!x.starts_at || Date.parse(x.starts_at) <= now) &&
    (!x.ends_at || Date.parse(x.ends_at) > now);
  const settings = s.data
    ? (Object.fromEntries(
        Object.keys(defaultSettings).map((k) => [k, s.data[k]]),
      ) as Settings)
    : defaultSettings;
  return {
    settings,
    products: publishedProducts,
    categories,
    banners: (b.data || []).filter(active),
    offers: activeOffers,
    connected: true,
  };
}
export async function getOrder(id: string, customer?: string) {
  let query = service()
    .from("orders")
    .select("*,order_items(*),order_events(*),refunds(*)")
    .eq("id", id);
  if (customer) query = query.eq("customer_id", customer);
  const { data, error } = await query.single();
  if (error || !data) throw new Fault(404, "ORDER_NOT_FOUND");
  return data;
}
