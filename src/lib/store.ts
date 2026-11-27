import "server-only";
import { service, configured, Fault } from "./server";
import { CategoryItem, colourOnline, publicProduct, Product, Settings } from "./core";
import { enrichCategories } from "./erp-server";
import { seedProducts } from "./seed";
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
      products: seedProducts.map((p) => {
        // Read-only preview: show each sample as one colour so the colour picker renders.
        const prod = publicProduct(p as Record<string, unknown>);
        return {
          ...prod,
          colours: prod.colours?.length
            ? prod.colours
            : [{ id: `preview-${prod.id}`, colour: prod.colour || "As shown", colour_hex: "", quantity: prod.available, reserved: 0, image_path: prod.image_path, sort_order: 0 }],
          online_ready: true,
        };
      }),
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

  // Website rule: a saree shows only when it is published, its category is visible and at least one
  // colour is defined WITH a photo. Undefined pieces (colour not recorded yet) are never sold online.
  const rawPublishedProducts = rawCatalogue
    .filter((prod: Record<string, unknown>) => prod.published === true && prod.archived !== true && prod.category_visible !== false)
    .map((prod) => toWebsiteProduct(prod as Record<string, unknown>))
    .filter((prod): prod is Product => prod !== null);

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
/** Storefront view of one saree: only colours with a photo, availability = free pieces of those colours. */
export function toWebsiteProduct(row: Record<string, unknown>): Product | null {
  const prod = publicProduct(row);
  const colours = (prod.colours || []).filter(colourOnline);
  if (!colours.length) return null;
  const free = colours.reduce((sum, c) => sum + Math.max(0, c.quantity - c.reserved), 0);
  const available = row.online_available != null ? Number(row.online_available) : Math.min(prod.available, free);
  return {
    ...prod,
    image_path: prod.image_path || colours[0].image_path,
    colours,
    available: Math.max(0, available),
    undefined_quantity: undefined,
    stock_on_hand: undefined,
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
