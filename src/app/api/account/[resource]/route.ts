import { z } from "zod";
import {
  identity,
  service,
  origin,
  json,
  rate,
  ok,
  failure,
  Fault,
} from "@/lib/server";
import { addressSchema, bulkSchema, uuid } from "@/lib/schemas";
export async function GET(
  req: Request,
  {
    params,
  }: {
    params: Promise<{
      resource: string;
    }>;
  },
) {
  try {
    const s = await identity();
    const { resource } = await params;
    if (resource === "session") return ok({ profile: s.profile });
    const allowed = ["orders", "notifications", "addresses", "wishlist"];
    if (!allowed.includes(resource)) throw new Fault(404, "NOT_FOUND");
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(new URL(req.url).searchParams.get("page") || 0);
    let q = service()
      .from(resource)
      .select(
        resource === "orders"
          ? "id,number,status,payment_status,total_paise,created_at"
          : "*",
      )
      .eq("customer_id", s.user.id);
    q =
      resource === "wishlist"
        ? q.order("product_id")
        : q.order("created_at", { ascending: false }).order("id");
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
      resource: string;
    }>;
  },
) {
  try {
    origin(req);
    const s = await identity();
    await rate(req, "account-write", s.user.id, 60);
    const { resource } = await params;
    const input = await json(req);
    const db = service();
    let result;
    if (resource === "profile") {
      const p = z
        .object({ display_name: z.string().trim().min(2).max(80) })
        .strict()
        .parse(input);
      result = await db.from("profiles").update(p).eq("id", s.user.id);
    } else if (resource === "addresses") {
      const p = z
        .object({
          id: uuid.optional(),
          remove: z.boolean().default(false),
          label: z.string().trim().max(40).default("Home"),
          address: addressSchema.optional(),
        })
        .strict()
        .parse(input);
      if (p.remove) {
        if (!p.id) throw new Fault(400, "ID_REQUIRED");
        result = await db
          .from("addresses")
          .delete()
          .eq("id", p.id)
          .eq("customer_id", s.user.id);
      } else {
        if (!p.address) throw new Fault(400, "ADDRESS_REQUIRED");
        const { count } = await db
          .from("addresses")
          .select("*", { count: "exact", head: true })
          .eq("customer_id", s.user.id);
        if ((count || 0) >= 10 && !p.id) throw new Fault(409, "ADDRESS_LIMIT");
        result = p.id
          ? await db
              .from("addresses")
              .update({ label: p.label, address: p.address })
              .eq("id", p.id)
              .eq("customer_id", s.user.id)
          : await db
              .from("addresses")
              .insert({
                customer_id: s.user.id,
                label: p.label,
                address: p.address,
              });
      }
    } else if (resource === "wishlist") {
      const p = z
        .object({ product_id: uuid, remove: z.boolean() })
        .strict()
        .parse(input);
      result = p.remove
        ? await db
            .from("wishlist")
            .delete()
            .eq("customer_id", s.user.id)
            .eq("product_id", p.product_id)
        : await db
            .from("wishlist")
            .upsert({ customer_id: s.user.id, product_id: p.product_id });
    } else if (resource === "notifications") {
      const p = z.object({ id: uuid }).strict().parse(input);
      result = await db
        .from("notifications")
        .update({ read_at: new Date().toISOString() })
        .eq("id", p.id)
        .eq("customer_id", s.user.id);
    } else if (resource === "bulk") {
      const p = bulkSchema.parse(input);
      await rate(req, "bulk", s.user.id, 5, 3600);
      result = await db
        .from("bulk_inquiries")
        .insert({ ...p, customer_id: s.user.id });
    } else throw new Fault(404, "NOT_FOUND");
    if (result.error) throw new Fault(409, "CHANGE_FAILED");
    return ok({ message: "Saved." });
  } catch (e) {
    return failure(e);
  }
}
