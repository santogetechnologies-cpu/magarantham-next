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
  subcategory_id?: string;
  subcategory_name?: string;
  category_id?: string;
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
export const publicProduct = (p: Record<string, unknown>): Product => ({
  id: String(p.id),
  sku: String(p.sku),
  slug: String(p.slug),
  name: String(p.name),
  category: String(p.category_name ?? p.category),
  colour: String(p.colour),
  description: String(p.description),
  image_path: String(p.image_path),
  price_paise: Number(p.price_paise),
  discount_percent: p.effective_price_paise!=null&&Number(p.price_paise)>0 ? Math.round((1-Number(p.effective_price_paise)/Number(p.price_paise))*10000)/100 : Number(p.discount_percent),
  available: Math.max(0, Number(p.stock_on_hand) - Number(p.reserved)),
  featured: Boolean(p.featured),
  effective_price_paise: p.effective_price_paise==null?undefined:Number(p.effective_price_paise),
  subcategory_id: p.subcategory_id==null?undefined:String(p.subcategory_id),
  subcategory_name: p.subcategory_name==null?undefined:String(p.subcategory_name),
  category_id: p.category_id==null?undefined:String(p.category_id),
});
