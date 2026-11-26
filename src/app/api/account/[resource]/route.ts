import { z } from "zod";
import {
  authClient,
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
    const { resource } = await params;
    if (resource === "session") {
      try {
        const s = await identity();
        return ok({
          profile: {
            ...s.profile,
            avatar_url:
              (s.user.user_metadata?.avatar_url as string | undefined) || "",
          },
        });
      } catch {
        return ok({ profile: null });
      }
    }
    const s = await identity();
    const db = service();

    if (resource === "summary") {
      const [ordersRes, wishlistRes, addressesRes] = await Promise.all([
        db
          .from("orders")
          .select(
            "id,number,status,payment_status,total_paise,created_at,tracking_id,address,order_items(*)",
            { count: "exact" },
          )
          .eq("customer_id", s.user.id)
          .order("created_at", { ascending: false })
          .limit(3),
        db
          .from("wishlist")
          .select("product_id", { count: "exact" })
          .eq("customer_id", s.user.id),
        db
          .from("addresses")
          .select("id", { count: "exact" })
          .eq("customer_id", s.user.id),
      ]);

      return ok({
        profile: {
          ...s.profile,
          avatar_url:
            (s.user.user_metadata?.avatar_url as string | undefined) || "",
        },
        ordersCount: ordersRes.count ?? (ordersRes.data?.length || 0),
        wishlistCount: wishlistRes.count ?? (wishlistRes.data?.length || 0),
        addressesCount: addressesRes.count ?? (addressesRes.data?.length || 0),
        recentOrders: ordersRes.data || [],
      });
    }

    const allowed = ["orders", "notifications", "addresses", "wishlist"];
    if (!allowed.includes(resource)) throw new Fault(404, "NOT_FOUND");
    const page = z.coerce
      .number()
      .int()
      .min(0)
      .max(100000)
      .parse(new URL(req.url).searchParams.get("page") || 0);
    let q = db
      .from(resource)
      .select(
        resource === "orders"
          ? "id,number,status,payment_status,total_paise,created_at,tracking_id,address,order_items(*)"
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
    const input = await json(req, 350000);
    const db = service();
    let result: { error: unknown } = { error: null };

    if (resource === "profile") {
      const p = z
        .object({
          display_name: z.string().trim().min(2).max(80),
          email: z.email().max(254).optional(),
          avatar_url: z.string().max(300000).optional(),
        })
        .strict()
        .parse(input);

      if (
        p.avatar_url &&
        !p.avatar_url.startsWith("data:image/jpeg;base64,") &&
        !p.avatar_url.startsWith("data:image/png;base64,") &&
        !p.avatar_url.startsWith("data:image/webp;base64,") &&
        !p.avatar_url.startsWith("/assets/")
      ) {
        throw new Fault(400, "INVALID_AVATAR", "Please upload a valid JPEG, PNG, or WebP image.");
      }

      result = await db
        .from("profiles")
        .update({ display_name: p.display_name })
        .eq("id", s.user.id);

      const metaUpdate: Record<string, unknown> = {
        ...(s.user.user_metadata || {}),
        name: p.display_name,
      };
      if (p.avatar_url !== undefined) {
        metaUpdate.avatar_url = p.avatar_url;
      }

      await db.auth.admin.updateUserById(s.user.id, {
        user_metadata: metaUpdate,
      });

      try {
        if (p.avatar_url !== undefined) {
          await db
            .from("profiles")
            .update({ avatar_url: p.avatar_url })
            .eq("id", s.user.id);
        }
      } catch {}

      let emailNotice = "";
      const nextEmail = p.email?.trim().toLowerCase();
      if (nextEmail && nextEmail !== (s.profile.email || "").toLowerCase()) {
        const auth = await authClient();
        const { error: emailErr } = await auth.auth.updateUser(
          { email: nextEmail },
          {
            emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL || ""}/auth/callback?next=/account`,
          },
        );
        if (emailErr) {
          throw new Fault(400, "EMAIL_UPDATE_FAILED", emailErr.message || "Could not update email address.");
        }
        emailNotice = " A verification link has been sent to your new email address.";
      }

      if (result.error) throw new Fault(409, "CHANGE_FAILED");
      return ok({ message: `Profile saved.${emailNotice}` });
    } else if (resource === "addresses") {
      const p = z
        .object({
          id: uuid.optional(),
          remove: z.boolean().default(false),
          set_default: z.boolean().default(false),
          is_default: z.boolean().default(false),
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
      } else if (p.set_default && p.id) {
        // Clear Default prefix on existing addresses & mark target as Default
        const { data: existing } = await db
          .from("addresses")
          .select("id,label")
          .eq("customer_id", s.user.id);
        for (const row of existing || []) {
          const cleanLabel = String(row.label || "Home").replace(/^Default · /i, "");
          const nextLabel = row.id === p.id ? `Default · ${cleanLabel}` : cleanLabel;
          await db
            .from("addresses")
            .update({ label: nextLabel })
            .eq("id", row.id)
            .eq("customer_id", s.user.id);
          try {
            await db
              .from("addresses")
              .update({ is_default: row.id === p.id })
              .eq("id", row.id)
              .eq("customer_id", s.user.id);
          } catch {}
        }
        return ok({ message: "Default address updated." });
      } else {
        if (!p.address) throw new Fault(400, "ADDRESS_REQUIRED");
        const { data: existing } = await db
          .from("addresses")
          .select("id,label")
          .eq("customer_id", s.user.id);
        if ((existing?.length || 0) >= 10 && !p.id) throw new Fault(409, "ADDRESS_LIMIT");

        const makeDefault = p.is_default || (existing?.length || 0) === 0;
        if (makeDefault) {
          for (const row of existing || []) {
            if (row.id === p.id) continue;
            const cleanLabel = String(row.label || "Home").replace(/^Default · /i, "");
            if (cleanLabel !== row.label) {
              await db
                .from("addresses")
                .update({ label: cleanLabel })
                .eq("id", row.id)
                .eq("customer_id", s.user.id);
            }
            try {
              await db
                .from("addresses")
                .update({ is_default: false })
                .eq("id", row.id)
                .eq("customer_id", s.user.id);
            } catch {}
          }
        }

        const cleanInputLabel = p.label.replace(/^Default · /i, "") || "Home";
        const finalLabel = makeDefault ? `Default · ${cleanInputLabel}` : cleanInputLabel;

        result = p.id
          ? await db
              .from("addresses")
              .update({ label: finalLabel, address: p.address })
              .eq("id", p.id)
              .eq("customer_id", s.user.id)
          : await db.from("addresses").insert({
              customer_id: s.user.id,
              label: finalLabel,
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
