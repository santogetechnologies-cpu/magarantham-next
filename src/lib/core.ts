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
  stock_on_hand?: number;
  pieces?: IndividualPiece[];
  total_pieces?: number;
  available_pieces?: number;
  sold_pieces?: number;
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
  const rawPieces = Array.isArray(p.pieces) ? (p.pieces as IndividualPiece[]) : [];
  // Strip admin-only fields (purchase_cost_paise, location) for public customer consumption
  const publicPieces: IndividualPiece[] | undefined = rawPieces.length > 0
    ? rawPieces.map((piece) => ({
        id: String(piece.id),
        product_id: String(piece.product_id),
        piece_code: String(piece.piece_code || ""),
        barcode: String(piece.barcode || ""),
        colour: String(piece.colour || p.colour || ""),
        price_paise: Number(piece.price_paise || p.price_paise || 0),
        status: (piece.status || "available") as PieceStatus,
        quantity: piece.quantity != null && Number(piece.quantity) >= 0 ? Number(piece.quantity) : 1,
        min_quantity: piece.min_quantity != null && Number(piece.min_quantity) >= 0 ? Number(piece.min_quantity) : 0,
        image_path: piece.image_path ? String(piece.image_path) : undefined,
        created_at: String(piece.created_at || new Date().toISOString()),
        unit_id: piece.unit_id != null ? piece.unit_id : undefined,
      }))
    : undefined;

  const totalPieces = publicPieces ? publicPieces.reduce((sum, p) => sum + (p.quantity || 1), 0) : undefined;
  const availPieces = publicPieces ? publicPieces.filter((pc) => pc.status === "available").reduce((sum, p) => sum + (p.quantity || 1), 0) : undefined;
  const soldPieces = publicPieces ? publicPieces.filter((pc) => pc.status === "sold").reduce((sum, p) => sum + (p.quantity || 1), 0) : undefined;

  return {
    id: String(p.id),
    sku: String(p.sku),
    slug: String(p.slug),
    name: String(p.name),
    category: String(p.category_name ?? p.category),
    colour: String(p.colour),
    description: String(p.description),
    image_path: String(p.image_path),
    price_paise: Number(p.price_paise),
    discount_percent: p.effective_price_paise != null && Number(p.price_paise) > 0
      ? Math.round((1 - Number(p.effective_price_paise) / Number(p.price_paise)) * 10000) / 100
      : Number(p.discount_percent),
    available: Math.max(0, Number(p.stock_on_hand) - Number(p.reserved)),
    stock_on_hand: Number(p.stock_on_hand || 0),
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
    pieces: publicPieces,
    total_pieces: totalPieces,
    available_pieces: availPieces,
    sold_pieces: soldPieces,
  };
};
