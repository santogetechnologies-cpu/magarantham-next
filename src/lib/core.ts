export const capabilities = [
  "catalogue",
  "inventory",
  "orders",
  "payments",
  "content",
  "offers",
  "shipping",
  "bulk",
  "pos",
  "purchases",
  "expenses",
  "attendance",
  "reports",
] as const;
export type Capability = (typeof capabilities)[number];
export type Profile = {
  id: string;
  email: string;
  display_name: string;
  role: "customer" | "manager" | "billing" | "superadmin";
  suspended: boolean;
  permissions: string[];
  phone?: string;
  phone_confirmed_at?: string;
};
export type PieceStatus =
  | "available"
  | "reserved"
  | "sold"
  | "damaged"
  | "returned";

export type IndividualPiece = {
  id: string;
  product_id: string;
  piece_code: string;
  barcode: string;
  colour: string;
  price_paise: number;
  purchase_cost_paise?: number; // admin-only
  quantity?: number; // physical stock count for this piece
  min_quantity?: number; // low stock alert threshold for this piece
  status: PieceStatus;
  image_path?: string;
  location?: string; // admin-only
  created_at: string;
  unit_id?: number | string;
  /** POS sale ids that consumed this piece (keeps sale marking idempotent). */
  sold_refs?: string[];
};

/**
 * Colour split of one individual saree. The saree has one barcode and one price;
 * its pieces are divided into colours. Pieces without a colour are "undefined"
 * (stock_on_hand - sum of colour quantities) and are never sold online.
 */
export type ColourStock = {
  id: string;
  colour: string;
  colour_hex: string;
  quantity: number;
  reserved: number;
  image_path: string;
  sort_order: number;
};
/** Free pieces of a colour (not held by an unpaid online order). */
export const colourFree = (c: Pick<ColourStock, "quantity" | "reserved">) =>
  Math.max(0, Number(c.quantity || 0) - Number(c.reserved || 0));
/** Colour sells online only when it is defined and has its own photo. */
export const colourOnline = (c: Pick<ColourStock, "image_path">) => Boolean(c.image_path);
export function parseColours(raw: unknown): ColourStock[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c) => c && typeof c === "object" && (c as { id?: unknown }).id)
    .map((c) => {
      const x = c as Record<string, unknown>;
      return {
        id: String(x.id),
        colour: String(x.colour || ""),
        colour_hex: String(x.colour_hex || ""),
        quantity: Math.max(0, Number(x.quantity || 0)),
        reserved: Math.max(0, Number(x.reserved || 0)),
        image_path: String(x.image_path || ""),
        sort_order: Number(x.sort_order || 0),
      };
    });
}

export type CategoryItem = {
  id: string;
  parent_id: string | null;
  name: string;
  slug: string;
  active: boolean;
  image_path?: string;
  description?: string;
  subcategory_count?: number;
  product_count?: number;
  piece_count?: number;
};
export type Product = {
  id: string;
  sku: string;
  slug: string;
  name: string;
  category: string;
  colour: string;
  description: string;
  image_path: string;
  price_paise: number;
  discount_percent: number;
  available: number;
  featured: boolean;
  effective_price_paise?: number;
  offer_badge?: string | null;
  offer_savings_paise?: number;
  applied_offer_title?: string | null;
  offer_level?: string | null;
  subcategory_id?: string;
  subcategory_name?: string;
  category_id?: string;
  fabric?: string;
  design?: string;
  saree_type?: string;
  barcode?: string;
  compare_at_price_paise?: number;
  sale_unit?: string;
  stock_on_hand?: number;
  /** Colour split (admin/POS: all colours; website: only colours with a photo). */
  colours?: ColourStock[];
  /** Pieces whose colour is not recorded yet. */
  undefined_quantity?: number;
  /** True when at least one colour is defined with a photo (required to show online). */
  online_ready?: boolean;
};
export type Settings = {
  brand_name: string;
  tagline: string;
  support_email: string;
  support_phone: string;
  bulk_phone: string;
  bulk_min_quantity: number;
  whatsapp_phone: string;
  checkout_mode: "whatsapp_only" | "online_only" | "both";
  online_method: "manual_upi" | "razorpay_upi";
  upi_id: string;
  upi_name: string;
  ordering_enabled: boolean;
  shipping_paise: number;
  free_shipping_above_paise: number;
  tax_bps: number;
  reservation_minutes: number;
  announcement: string;
  hero_title: string;
  hero_text: string;
  hero_image: string;
  logo_image: string;
};
export const money = (paise: number) =>
  paise === 0
    ? "00 Rs"
    : `${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(paise / 100)} Rs`;
export const unitPrice = (
  p: Pick<Product, "price_paise" | "discount_percent" | "effective_price_paise">,
) => p.effective_price_paise ?? Math.floor((p.price_paise * (100 - p.discount_percent)) / 100);
export function trackingUrl(template: string, id: string) {
  if (!template) return null;
  const url = template.replaceAll("{tracking_id}", encodeURIComponent(id));
  try {
    const u = new URL(url);
    return u.protocol === "https:" && !u.username && !u.password
      ? u.href
      : null;
  } catch {
    return null;
  }
}
export function safeReturn(value: string | null) {
  return value &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\\\r\n]/.test(value)
    ? value
    : "/account";
}
export const publicProduct = (p: Record<string, unknown>): Product => {
  const colours = parseColours(p.colours).sort(
    (a, b) => a.sort_order - b.sort_order || a.colour.localeCompare(b.colour),
  );
  const stock = Number(p.stock_on_hand || 0);
  const coloured = colours.reduce((sum, c) => sum + c.quantity, 0);
  const cover = String(p.image_path || "") || colours.find(colourOnline)?.image_path || "";
  return {
    id: String(p.id),
    sku: String(p.sku),
    slug: String(p.slug),
    name: String(p.name),
    category: String(p.category_name ?? p.category),
    colour: String(p.colour ?? ""),
    description: String(p.description ?? ""),
    image_path: cover,
    price_paise: Number(p.price_paise),
    discount_percent: p.effective_price_paise != null && Number(p.price_paise) > 0
      ? Math.round((1 - Number(p.effective_price_paise) / Number(p.price_paise)) * 10000) / 100
      : Number(p.discount_percent),
    available: Math.max(0, stock - Number(p.reserved || 0)),
    stock_on_hand: stock,
    featured: Boolean(p.featured),
    effective_price_paise: p.effective_price_paise == null ? undefined : Number(p.effective_price_paise),
    subcategory_id: p.subcategory_id == null ? undefined : String(p.subcategory_id),
    subcategory_name: p.subcategory_name == null ? undefined : String(p.subcategory_name),
    category_id: p.category_id == null ? undefined : String(p.category_id),
    fabric: p.fabric ? String(p.fabric) : undefined,
    design: p.design ? String(p.design) : undefined,
    saree_type: p.saree_type ? String(p.saree_type) : undefined,
    barcode: p.barcode ? String(p.barcode) : undefined,
    compare_at_price_paise: p.compare_at_price_paise != null ? Number(p.compare_at_price_paise) : undefined,
    sale_unit: p.sale_unit ? String(p.sale_unit) : "piece",
    colours,
    undefined_quantity:
      p.undefined_quantity != null ? Number(p.undefined_quantity) : Math.max(0, stock - coloured),
    online_ready: p.online_ready != null ? Boolean(p.online_ready) : colours.some(colourOnline),
  };
};

/** Short label for prices, e.g. "per set". Empty for single pieces. */
export const unitSuffix = (unit?: string) =>
  !unit || unit === "piece" ? "" : `per ${unit}`;

/** Customer-friendly order status: packing -> Packed, shipped -> Dispatched. */
export const statusLabel = (status: string) =>
  ({ packing: "packed", shipped: "dispatched", awaiting_payment: "awaiting payment" } as Record<string, string>)[status] ||
  status.replaceAll("_", " ");
