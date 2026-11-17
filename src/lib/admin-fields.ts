export type Field = {
  key: string;
  label: string;
  type?:
    | "text"
    | "number"
    | "checkbox"
    | "textarea"
    | "select"
    | "datetime-local";
  options?: string[];
  choices?: {value:string;label:string}[];
  rupees?: boolean;
  nullable?: boolean;
};
const f = (
  key: string,
  label: string,
  type: Field["type"] = "text",
  extra: Partial<Field> = {},
): Field => ({ key, label, type, ...extra });
export const adminForms: Record<
  string,
  {
    title: string;
    entity: string;
    fields: Field[];
    defaults: Record<string, unknown>;
  }
> = {
  products: {
    title: "Products",
    entity: "products",
    defaults: {
      discount_percent: 0,
      published: false,
      archived: false,
      featured: false,
      price_paise: 0,
      barcode:null,
      category:"Sarees",
    },
    fields: [
      f("sku", "SKU"),
      f("barcode", "Product barcode (optional; SKU also scans)", "text", {nullable:true}),
      f("subcategory_id", "Subcategory", "select"),
      f("slug", "Page name (lowercase-with-hyphens)"),
      f("name", "Saree name"),

      f("colour", "Colour"),
      f("description", "Description", "textarea"),
      f("image_path", "Image URL"),
      f("price_paise", "Price (Rs)", "number", { rupees: true }),
      f("discount_percent", "Product discount (%)", "number"),
      f("published", "Publish product", "checkbox"),
      f("featured", "Show in home collection", "checkbox"),
      f("archived", "Archive product", "checkbox"),
    ],
  },
  banners: {
    title: "Banners",
    entity: "banners",
    defaults: {
      subtitle: "",
      button_label: "Shop sarees",
      link_path: "/shop",
      position: "home",
      sort_order: 0,
      published: false,
      starts_at: null,
      ends_at: null,
    },
    fields: [
      f("title", "Title"),
      f("subtitle", "Short text"),
      f("image_path", "Image URL"),
      f("button_label", "Button text"),
      f("link_path", "Button page (starts with /)"),
      f("position", "Show on", "select", { options: ["home", "shop"] }),
      f("sort_order", "Display order", "number"),
      f("published", "Publish banner", "checkbox"),
      f("starts_at", "Start time (optional)", "datetime-local", {
        nullable: true,
      }),
      f("ends_at", "End time (optional)", "datetime-local", { nullable: true }),
    ],
  },
  offers: {
    title: "Offers",
    entity: "offers",
    defaults: {
      code: null,
      kind: "percent",
      value: 10,
      min_subtotal_paise: 0,
      max_discount_paise: null,
      max_uses: null,
      per_customer_limit: 1,
      active: false,
      starts_at: null,
      ends_at: null,
    },
    fields: [
      f("title", "Offer name"),
      f("code", "Coupon code (blank = automatic)", "text", { nullable: true }),
      f("kind", "Discount type", "select", { options: ["percent", "fixed"] }),
      f("value", "Discount value (% or paise for fixed)", "number"),
      f("min_subtotal_paise", "Minimum purchase (Rs)", "number", {
        rupees: true,
      }),
      f("max_discount_paise", "Maximum discount (Rs, optional)", "number", {
        rupees: true,
        nullable: true,
      }),
      f("max_uses", "Total use limit (optional)", "number", { nullable: true }),
      f("per_customer_limit", "Uses per customer", "number"),
      f("active", "Enable offer", "checkbox"),
      f("starts_at", "Start time (optional)", "datetime-local", {
        nullable: true,
      }),
      f("ends_at", "End time (optional)", "datetime-local", { nullable: true }),
    ],
  },
  shipping: {
    title: "Tracking providers",
    entity: "tracking_providers",
    defaults: { url_template: "", enabled: true },
    fields: [
      f("name", "Provider name"),
      f("url_template", "HTTPS tracking URL with {tracking_id}"),
      f("enabled", "Enable provider", "checkbox"),
    ],
  },
  settings: {
    title: "Store settings",
    entity: "store_settings",
    defaults: {},
    fields: [
      f("brand_name", "Brand name"),
      f("tagline", "Short store description"),
      f("support_email", "Support email"),
      f("support_phone", "Support phone"),
      f("bulk_phone", "Bulk purchase contact number"),
      f("bulk_min_quantity", "Bulk minimum quantity", "number"),
      f("whatsapp_phone", "WhatsApp number (country code, digits only)"),
      f("checkout_mode", "Order channels", "select", {
        options: ["whatsapp_only", "online_only", "both"],
      }),
      f("online_method", "Online payment method", "select", {
        options: ["manual_upi", "razorpay_upi"],
      }),
      f("upi_id", "UPI ID"),
      f("upi_name", "UPI payee name"),
      f("ordering_enabled", "Enable orders", "checkbox"),
      f("shipping_paise", "Shipping fee (Rs)", "number", { rupees: true }),
      f(
        "free_shipping_above_paise",
        "Free shipping minimum (Rs, 0 = off)",
        "number",
        { rupees: true },
      ),
      f("tax_bps", "Tax rate (basis points: 100 = 1%)", "number"),
      f("reservation_minutes", "Stock hold time (minutes)", "number"),
      f("announcement", "Announcement"),
      f("hero_title", "Home heading"),
      f("hero_text", "Home short text", "textarea"),
      f("hero_image", "Hero image URL"),
      f("logo_image", "Logo image URL"),
    ],
  },
  bulk: {
    title: "Bulk inquiries",
    entity: "bulk_inquiries",
    defaults: { status: "new" },
    fields: [
      f("status", "Inquiry status", "select", {
        options: ["new", "contacted", "closed"],
      }),
    ],
  },
};
export const adminNav = [
 ["", "Overview", ""], ["pos","POS billing","pos"], ["products","Products","catalogue"], ["categories","Categories","superadmin"], ["discounts","Shared discounts","superadmin"],
 ["inventory","Stock","inventory"],["labels","Barcode labels","inventory"],["purchases","Purchases","purchases"],["suppliers","Suppliers","purchases"],["orders","Online orders","orders"],
 ["expenses","Expenses","expenses"],["expense-categories","Expense categories","superadmin"],["employees","Staff management","superadmin"],["attendance","Attendance","attendance"],["payroll","Payroll","superadmin"],["salary-policies","Salary rules","superadmin"],
 ["reports","Reports","reports"],["pos-settings","POS settings","superadmin"],["banners","Banners","content"],["offers","Online coupons & offers","offers"],["shipping","Tracking","shipping"],["bulk","Bulk inquiries","bulk"],["settings","Store settings","superadmin"],["staff","Login permissions","superadmin"],["audit","Activity log","superadmin"]
] as const;
