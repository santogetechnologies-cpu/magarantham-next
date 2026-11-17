import { z } from "zod";
import {
  staff,
  service,
  origin,
  json,
  rate,
  rpc,
  ok,
  failure,
  Fault,
} from "@/lib/server";
import { schemaFor, uuid } from "@/lib/schemas";
import type { Capability } from "@/lib/core";
const access: Record<string, Capability | "superadmin" | undefined> = {
  products: "catalogue",
  inventory: "inventory",
  orders: "orders",
  banners: "content",
  offers: "offers",
  tracking_providers: "shipping",
  bulk_inquiries: "bulk",
  store_settings: "superadmin",
  profiles: "superadmin",
  audit_log: "superadmin",
  overview: undefined,
};
export async function GET(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      entity: string;
    }>;
  },
) {
  try {
    const { entity } = await params;
    if (!(entity in access)) throw new Fault(404, "NOT_FOUND");
    const s = await staff(access[entity]);
    const db = service();
    if (entity === "overview") {
      const canOrders =
        s.profile.role === "superadmin" ||
        s.profile.permissions.includes("orders");
      const { count: orders } = canOrders
        ? await db.from("orders").select("*", { count: "exact", head: true })
        : { count: null };
      const canStock =
        s.profile.role === "superadmin" ||
        s.profile.permissions.includes("inventory");
      const { data: stock } = canStock
        ? await db.from("products").select("stock_on_hand,reserved")
        : { data: null };
      return ok({
        profile: s.profile,
        orders,
        available: stock?.reduce((n, p) => n + p.stock_on_hand - p.reserved, 0),
        readiness:
          s.profile.role === "superadmin"
            ? {
                gateway: Boolean(
                  process.env.RAZORPAY_KEY_ID &&
                    process.env.RAZORPAY_KEY_SECRET,
                ),
                gateway_webhook: Boolean(process.env.RAZORPAY_WEBHOOK_SECRET),
                email: Boolean(
                  process.env.RESEND_API_KEY && process.env.ORDER_FROM_EMAIL,
                ),
                captcha: Boolean(process.env.TURNSTILE_SECRET_KEY),
                tracking_webhook: Boolean(process.env.TRACKING_WEBHOOK_SECRET),
                cron: Boolean(
                  process.env.CRON_SECRET &&
                    process.env.CRON_SECRET.length >= 32,
                ),
              }
            : null,
      });
    }
    const table = entity === "inventory" ? "products" : entity;
    let q = db.from(table).select("*");
    if (entity === "orders") {
      const status = new URL(req.url).searchParams.get("status");
      if (status)
        q = q.eq(
          "status",
          z
            .enum([
              "awaiting_payment",
              "confirmed",
              "packing",
              "shipped",
              "delivered",
              "cancelled",
              "expired",
              "review_required",
              "return_requested",
              "returned",
            ])
            .parse(status),
        );
    }
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(new URL(req.url).searchParams.get("page") || 0);
    q = [
      "products",
      "inventory",
      "orders",
      "banners",
      "bulk_inquiries",
      "profiles",
      "audit_log",
    ].includes(entity)
      ? q.order("created_at", { ascending: false }).order("id")
      : q.order("id");
    const { data, error } = await q.range(page * 100, page * 100 + 100);
    if (error) throw new Fault(503, "LOAD_FAILED");
    return ok({
      rows: data.slice(0, 100),
      nextPage: data.length > 100 ? page + 1 : null,
    });
  } catch (e) {
    return failure(e);
  }
}
export async function POST(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      entity: string;
    }>;
  },
) {
  try {
    origin(req);
    const { entity } = await params;
    if (!(entity in access)) throw new Fault(404, "NOT_FOUND");
    const s = await staff(access[entity]);
    await rate(req, "admin-write", s.user.id, 100);
    const input = await json(req);
    if (entity === "inventory") {
      const p = z
        .object({
          product_id: uuid,
          delta: z
            .number()
            .int()
            .min(-100000)
            .max(100000)
            .refine((v) => v !== 0),
          reason: z.string().trim().min(3).max(300),
        })
        .strict()
        .parse(input);
      await rpc("adjust_stock", {
        p_actor: s.user.id,
        p_product: p.product_id,
        p_delta: p.delta,
        p_reason: p.reason,
      });
    } else if (entity === "profiles") {
      const p = z
        .object({
          user_id: uuid,
          permissions: z
            .array(
              z.enum([
                "catalogue",
                "inventory",
                "orders",
                "payments",
                "content",
                "offers",
                "shipping",
                "bulk",
                "pos",
                "purchases", "expenses", "attendance", "reports",
              ]),
            )
            .max(8),
          suspended: z.boolean(),
        })
        .strict()
        .parse(input);
      await rpc("staff_update", {
        p_actor: s.user.id,
        p_user: p.user_id,
        p_permissions: p.permissions,
        p_suspended: p.suspended,
      });
    } else if (entity in schemaFor) {
      const p = z
        .object({
          id: uuid.nullable().default(null),
          data: z.record(z.string(), z.unknown()),
        })
        .strict()
        .parse(input);
      const schema = schemaFor[entity as keyof typeof schemaFor];
      const data = schema.parse(p.data);
      if (
        entity === "store_settings" &&
        "ordering_enabled" in data &&
        data.ordering_enabled &&
        "online_method" in data &&
        data.online_method === "razorpay_upi" &&
        "checkout_mode" in data &&
        data.checkout_mode !== "whatsapp_only" &&
        (!process.env.RAZORPAY_KEY_ID ||
          !process.env.RAZORPAY_KEY_SECRET ||
          !process.env.RAZORPAY_WEBHOOK_SECRET)
      )
        throw new Fault(409, "GATEWAY_NOT_CONFIGURED");
      const id = await rpc("admin_save", {
        p_actor: s.user.id,
        p_entity: entity,
        p_id: p.id,
        p_data: data,
      });
      return ok({ id, message: "Saved." });
    } else throw new Fault(404, "NOT_FOUND");
    return ok({ message: "Saved." });
  } catch (e) {
    return failure(e);
  }
}
