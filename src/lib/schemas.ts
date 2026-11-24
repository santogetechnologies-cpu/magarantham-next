import { z } from "zod";
export const uuid = z.uuid();
export const phone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9 ()-]{6,19}$/, "Enter a valid phone number");
const text = (max = 200) => z.string().trim().min(1).max(max);
const image = z
  .string()
  .max(1000)
  .refine(
    (s) =>
      /^\/assets\/[a-zA-Z0-9._/-]+$/.test(s) ||
      (/^https:\/\//.test(s) && !/[<>"']/.test(s)),
    "Use a local asset or HTTPS image URL",
  );
const optionalDate = z.union([z.iso.datetime({ offset: true }), z.null()]);
const integer = (max = 100000000) => z.number().int().min(0).max(max);
export const addressSchema = z
  .object({
    name: text(80),
    phone,
    line1: text(180),
    line2: z.string().trim().max(180).default(""),
    city: text(80),
    state: text(80),
    pin: z.string().regex(/^[1-9][0-9]{5}$/),
  })
  .strict();
export const checkoutSchema = z
  .object({
    key: uuid,
    cart: z
      .array(
        z
          .object({
            product_id: uuid,
            quantity: z.number().int().min(1).max(20),
          })
          .strict(),
      )
      .min(1)
      .max(20),
    address: addressSchema,
    channel: z.enum(["whatsapp", "upi", "razorpay"]),
    coupon: z.string().trim().max(40).default(""),
    whatsapp_consent: z.boolean().default(false),
  })
  .strict();
export const productSchema = z
  .object({
    subcategory_id: uuid.nullable().optional().default(null),
    barcode: z.string().trim().min(1).max(48).regex(/^[ -~]+$/).nullable(),
    sku: text(50),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(120),
    name: text(120),
    category: text(80),
    colour: text(50),
    description: z.string().trim().max(2000).default(""),
    image_path: image,
    price_paise: integer(),
    discount_percent: integer(90),
    published: z.boolean(),
    archived: z.boolean(),
    featured: z.boolean(),
    saree_type: z.string().trim().max(80).optional().default("Kanchipuram Silk"),
    fabric: z.string().trim().max(80).optional().default("Pure Mulberry Silk"),
    design: z.string().trim().max(120).optional().default("Traditional Zari Border"),
    purchase_price_paise: integer().optional().default(0),
    min_stock_level: integer(10000).optional().default(0),
    compare_at_price_paise: integer().optional().default(0),
    sale_unit: z.enum(["piece", "set", "pair", "metre", "pack", "dozen", "box"]).optional(),
  })
  .strict();
export const bannerSchema = z
  .object({
    title: text(120),
    subtitle: z.string().max(300),
    image_path: image,
    mobile_image_path: z.union([image, z.literal("")]).optional().default(""),
    button_label: text(40),
    link_path: z
      .string()
      .max(150)
      .regex(/^\/(?!\/)[a-zA-Z0-9/?=&%_-]*$/),
    position: z.enum(["home_hero", "home", "home_bottom", "shop", "category"]),
    category_id: z.uuid().nullable().optional().default(null),
    text_align: z.enum(["left", "center", "right"]).optional().default("left"),
    show_text: z.boolean().optional().default(true),
    theme: z.enum(["dark", "light"]).optional().default("dark"),
    sort_order: z.number().int().min(-100).max(100),
    published: z.boolean(),
    starts_at: optionalDate,
    ends_at: optionalDate,
  })
  .strict()
  .refine(
    (v) => !v.starts_at || !v.ends_at || v.ends_at > v.starts_at,
    "End must be after start",
  );
export const offerSchema = z
  .object({
    title: text(100),
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_-]{2,40}$/)
      .nullable(),
    kind: z.enum(["percent", "fixed"]),
    value: z.number().int().positive().max(100000000),
    min_subtotal_paise: integer(),
    max_discount_paise: integer().nullable(),
    max_uses: z.number().int().positive().max(1000000).nullable(),
    per_customer_limit: z.number().int().positive().max(1000),
    active: z.boolean(),
    starts_at: optionalDate,
    ends_at: optionalDate,
  })
  .strict()
  .refine(
    (v) => v.kind !== "percent" || v.value <= 90,
    "Percent must be 90 or less",
  )
  .refine(
    (v) => !v.starts_at || !v.ends_at || v.ends_at > v.starts_at,
    "End must be after start",
  );
export const providerSchema = z
  .object({
    name: text(80),
    url_template: z
      .string()
      .max(500)
      .refine(
        (v) =>
          v === "" ||
          (v.includes("{tracking_id}") &&
            /^https:\/\//.test(v) &&
            !/[<>"']/.test(v)),
        "HTTPS template must include {tracking_id}",
      ),
    enabled: z.boolean(),
  })
  .strict();
export const settingsSchema = z
  .object({
    brand_name: text(100),
    tagline: text(180),
    support_email: z.union([z.email(), z.literal("")]),
    support_phone: z.union([phone, z.literal("")]),
    bulk_phone: z.union([phone, z.literal("")]),
    bulk_min_quantity: z.number().int().min(1).max(100000),
    whatsapp_phone: z.union([
      z.string().regex(/^[1-9][0-9]{7,14}$/),
      z.literal(""),
    ]),
    checkout_mode: z.enum(["whatsapp_only", "online_only", "both"]),
    online_method: z.enum(["manual_upi", "razorpay_upi"]),
    upi_id: z
      .string()
      .max(100)
      .regex(/^(?:[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+)?$/),
    upi_name: z.string().max(100),
    ordering_enabled: z.boolean(),
    shipping_paise: integer(),
    free_shipping_above_paise: integer(),
    tax_bps: integer(10000),
    reservation_minutes: z.number().int().min(10).max(1440),
    announcement: text(300),
    hero_title: text(120),
    hero_text: text(300),
    hero_image: image,
    logo_image: image,
  })
  .strict()
  .superRefine((v, c) => {
    if (v.ordering_enabled) {
      if (v.checkout_mode !== "online_only" && !v.whatsapp_phone)
        c.addIssue({
          code: "custom",
          path: ["whatsapp_phone"],
          message: "WhatsApp number is required",
        });
      if (
        v.checkout_mode !== "whatsapp_only" &&
        v.online_method === "manual_upi" &&
        (!v.upi_id || !v.upi_name)
      )
        c.addIssue({
          code: "custom",
          path: ["upi_id"],
          message: "UPI ID and name are required",
        });
    }
  });
export const couponSchema = z
  .object({
    code: z
      .string()
      .trim()
      .regex(/^[A-Z0-9_-]{2,40}$/)
      .transform((s) => s.toUpperCase()),
    description: z.string().trim().max(300).default(""),
    discount_type: z.enum(["percent", "fixed"]),
    discount_value: z.number().int().min(1).max(100000000),
    min_purchase_paise: z.number().int().min(0).max(100000000).default(0),
    max_discount_paise: z.number().int().min(0).max(100000000).nullable().default(null),
    max_uses: z.number().int().min(1).max(1000000).nullable().default(null),
    per_customer_limit: z.number().int().min(1).max(100).default(1),
    starts_at: optionalDate,
    expires_at: optionalDate,
    active: z.boolean().default(true),
  })
  .strict()
  .refine(
    (v) => !v.starts_at || !v.expires_at || v.expires_at > v.starts_at,
    "Expiry must be after start",
  );

export const leaveSchema = z
  .object({
    employee_id: uuid,
    leave_type: z.enum(["casual", "sick", "earned", "paid", "unpaid", "emergency"]),
    start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    days: z.number().min(0.5).max(365),
    reason: z.string().trim().max(500).default(""),
    status: z.enum(["pending", "approved", "rejected", "cancelled"]).default("pending"),
  })
  .strict();

export const schemaFor = {
  products: productSchema,
  banners: bannerSchema,
  offers: offerSchema,
  coupons: couponSchema,
  employee_leaves: leaveSchema,
  tracking_providers: providerSchema,
  store_settings: settingsSchema,
  bulk_inquiries: z
    .object({ status: z.enum(["new", "contacted", "closed"]) })
    .strict(),
};
export const bulkSchema = z
  .object({
    name: text(80),
    phone,
    quantity: z.number().int().min(1).max(100000),
    message: text(2000),
  })
  .strict();
