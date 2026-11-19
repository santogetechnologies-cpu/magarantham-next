import { z } from "zod";
import { revalidatePath } from "next/cache";
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
import { getPiecesMap } from "@/lib/piece-server";
import { enrichCategories } from "@/lib/erp-server";

const access: Record<string, Capability | "superadmin" | undefined> = {
  products: "catalogue",
  inventory: "inventory",
  orders: "orders",
  banners: "content",
  offers: "offers",
  coupons: "offers",
  employee_leaves: "attendance",
  inventory_adjustments: "inventory",
  product_price_history: "catalogue",
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

      // Fetch all active (non-archived) products for inventory stats
      const { data: allProducts } = await db
        .from("products")
        .select(
          "id,name,sku,category,stock_on_hand,reserved,price_paise,image_path,min_stock_level,published,created_at",
        )
        .eq("archived", false)
        .order("stock_on_hand", { ascending: true });

      const productsList = allProducts || [];
      const totalProducts = productsList.length;
      const totalStockQuantity = productsList.reduce(
        (sum, p) => sum + (p.stock_on_hand || 0),
        0,
      );
      const available = productsList.reduce(
        (sum, p) => sum + Math.max(0, (p.stock_on_hand || 0) - (p.reserved || 0)),
        0,
      );
      const lowStockProducts = productsList.filter(
        (p) =>
          (p.stock_on_hand || 0) > 0 &&
          (p.stock_on_hand || 0) <= (p.min_stock_level || 3),
      ).length;
      const outOfStockProducts = productsList.filter(
        (p) => (p.stock_on_hand || 0) === 0,
      ).length;

      // Low stock alerts list
      const lowStockAlerts = productsList
        .filter((p) => (p.stock_on_hand || 0) <= (p.min_stock_level || 3))
        .slice(0, 8);

      // Category Stock Distribution
      const categoryMap = new Map<
        string,
        { category: string; count: number; stock: number }
      >();
      for (const p of productsList) {
        const cat = p.category || "Silk";
        const entry = categoryMap.get(cat) || { category: cat, count: 0, stock: 0 };
        entry.count += 1;
        entry.stock += p.stock_on_hand || 0;
        categoryMap.set(cat, entry);
      }
      const stockDistribution = Array.from(categoryMap.values()).sort(
        (a, b) => b.stock - a.stock,
      );

      // Employees and attendance
      const { data: empData } = await db
        .from("employees")
        .select("id,code,name,department,designation,active")
        .eq("active", true);
      const totalEmployees = empData?.length || 0;

      const todayStr = new Date().toISOString().slice(0, 10);
      const monthStartStr = `${todayStr.slice(0, 7)}-01`;

      const { data: todayAttendance } = await db
        .from("attendance")
        .select("employee_id,status,work_on")
        .eq("work_on", todayStr);

      const presentList =
        todayAttendance?.filter((a) =>
          ["full_day", "half_day", "permission"].includes(a.status),
        ) || [];
      const presentToday = presentList.length;
      const onLeaveToday =
        todayAttendance?.filter((a) => a.status === "leave").length || 0;
      const absentToday = Math.max(
        0,
        totalEmployees - presentToday - onLeaveToday,
      );

      // Active offers
      const { count: activeOffersCount } = await db
        .from("offers")
        .select("*", { count: "exact", head: true })
        .eq("active", true);
      const activeOffers = activeOffersCount || 0;

      // Sales: today & monthly
      const { data: todayOrders } = await db
        .from("orders")
        .select("total_paise,created_at,status")
        .gte("created_at", `${todayStr}T00:00:00Z`)
        .not("status", "in", '("cancelled","expired")');

      const { data: todayPos } = await db
        .from("pos_sales")
        .select("total_paise,created_at")
        .gte("created_at", `${todayStr}T00:00:00Z`);

      const todaySales =
        (todayOrders?.reduce((s, o) => s + (o.total_paise || 0), 0) || 0) +
        (todayPos?.reduce((s, p) => s + (p.total_paise || 0), 0) || 0);

      const { data: monthOrders } = await db
        .from("orders")
        .select("total_paise,created_at,status")
        .gte("created_at", `${monthStartStr}T00:00:00Z`)
        .not("status", "in", '("cancelled","expired")');

      const { data: monthPos } = await db
        .from("pos_sales")
        .select("total_paise,created_at")
        .gte("created_at", `${monthStartStr}T00:00:00Z`);

      const monthlySales =
        (monthOrders?.reduce((s, o) => s + (o.total_paise || 0), 0) || 0) +
        (monthPos?.reduce((s, p) => s + (p.total_paise || 0), 0) || 0);

      // Recent Orders
      const { data: recentOrders } = await db
        .from("orders")
        .select("id,number,total_paise,status,payment_status,channel,created_at")
        .order("created_at", { ascending: false })
        .limit(6);

      // Recent Stock Movements
      const { data: recentMovements } = await db
        .from("inventory_movements")
        .select("id,product_id,delta,reason,created_at,products(name,sku)")
        .order("created_at", { ascending: false })
        .limit(6);

      // Daily Sales (last 7 days trend)
      const dailySalesMap = new Map<
        string,
        { date: string; label: string; online: number; pos: number; total: number }
      >();
      for (let i = 6; i >= 0; i--) {
        const d = new Date();
        d.setUTCDate(d.getUTCDate() - i);
        const dateKey = d.toISOString().slice(0, 10);
        const label = d.toLocaleDateString("en-IN", {
          weekday: "short",
          day: "numeric",
        });
        dailySalesMap.set(dateKey, {
          date: dateKey,
          label,
          online: 0,
          pos: 0,
          total: 0,
        });
      }

      for (const o of monthOrders || []) {
        const d = o.created_at?.slice(0, 10);
        if (d && dailySalesMap.has(d)) {
          const entry = dailySalesMap.get(d)!;
          entry.online += o.total_paise || 0;
          entry.total += o.total_paise || 0;
        }
      }
      for (const p of monthPos || []) {
        const d = p.created_at?.slice(0, 10);
        if (d && dailySalesMap.has(d)) {
          const entry = dailySalesMap.get(d)!;
          entry.pos += p.total_paise || 0;
          entry.total += p.total_paise || 0;
        }
      }
      const dailySales = Array.from(dailySalesMap.values());

      let cashierSummary: Record<string, unknown> | null = null;
      if (s.profile.role === "billing") {
        const { data: emp } = await db
          .from("employees")
          .select("id,code,name,employment,joined_on,phone,daily_minutes")
          .eq("profile_id", s.profile.id)
          .maybeSingle();

        const { data: cashierSales } = await db
          .from("pos_sales")
          .select("id,invoice_no,customer_name,customer_phone,status,items,tenders,subtotal_paise,discount_paise,total_paise,cash_received_paise,change_paise,created_at,business")
          .eq("cashier_id", s.user.id)
          .gte("created_at", `${todayStr}T00:00:00Z`)
          .order("created_at", { ascending: false });

        const todayCashierSales = (cashierSales || []) as Record<string, any>[];
        const todayBillsCount = todayCashierSales.length;
        const todayRevenuePaise = todayCashierSales.reduce(
          (sum, b) => sum + (Number(b.total_paise) || 0),
          0,
        );

        let cashTendersPaise = 0;
        let upiTendersPaise = 0;
        let cardTendersPaise = 0;
        let totalUnitsSold = 0;

        for (const bill of todayCashierSales) {
          const tenders = Array.isArray(bill.tenders) ? bill.tenders : [];
          for (const t of tenders) {
            const amt = Number(t.amount_paise || 0);
            const m = String(t.method || "").toLowerCase();
            if (m === "cash") cashTendersPaise += amt;
            else if (m === "upi") upiTendersPaise += amt;
            else if (m === "card") cardTendersPaise += amt;
          }
          const items = Array.isArray(bill.items) ? bill.items : [];
          for (const it of items) {
            totalUnitsSold += Number(it.quantity || 0);
          }
        }

        let todayAttendanceStatus = "Not marked";
        if (emp?.id) {
          const { data: att } = await db
            .from("attendance")
            .select("status,worked_minutes")
            .eq("employee_id", emp.id)
            .eq("work_on", todayStr)
            .maybeSingle();
          if (att?.status) {
            todayAttendanceStatus =
              att.status === "full_day"
                ? "Present (Full Day)"
                : att.status === "half_day"
                  ? "Present (Half Day)"
                  : att.status === "permission"
                    ? "Present (Permission)"
                    : att.status === "leave"
                      ? "On Leave"
                      : att.status;
          }
        }

        cashierSummary = {
          employee: emp || {
            name: s.profile.display_name || "Cashier",
            code: "BILL-POS",
            employment: "full_time",
          },
          todayBillsCount,
          todayRevenuePaise,
          cashTendersPaise,
          upiTendersPaise,
          cardTendersPaise,
          totalUnitsSold,
          todayBills: todayCashierSales,
          attendanceStatus: todayAttendanceStatus,
        };
      }

      return ok({
        profile: s.profile,
        cashier: cashierSummary,
        orders,
        available,
        stats: {
          totalProducts,
          totalStockQuantity,
          lowStockProducts,
          outOfStockProducts,
          totalEmployees,
          presentToday,
          absentToday,
          activeOffers,
          todaySales,
          monthlySales,
        },
        visualizations: {
          dailySales,
          stockDistribution: stockDistribution.slice(0, 6),
          attendanceOverview: {
            total: totalEmployees,
            present: presentToday,
            absent: absentToday,
            onLeave: onLeaveToday,
          },
          lowStockAlerts,
          recentOrders: recentOrders || [],
          recentMovements: recentMovements || [],
        },
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
    if (entity === "products" || entity === "inventory") {
      const includeArchived =
        new URL(req.url).searchParams.get("include_archived") === "true";
      if (!includeArchived) q = q.eq("archived", false);
    }
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
      "offers",
      "coupons",
      "employee_leaves",
      "inventory_adjustments",
      "product_price_history",
      "bulk_inquiries",
      "profiles",
      "audit_log",
    ].includes(entity)
      ? q.order("created_at", { ascending: false }).order("id")
      : q.order("id");

    const { data, error } = await q.range(page * 100, page * 100 + 100);
    if (error) {
      const detail =
        error.code === "42501" || !process.env.SUPABASE_SERVICE_ROLE_KEY
          ? "Missing SUPABASE_SERVICE_ROLE_KEY in .env.local. Add your Supabase Secret / service_role key and restart the server."
          : undefined;
      throw new Fault(503, "LOAD_FAILED", detail);
    }
    let outRows = data.slice(0, 100) as unknown as Record<string, unknown>[];
    if ((entity === "products" || entity === "inventory") && outRows.length > 0) {
      const piecesMap = await getPiecesMap();
      outRows = outRows.map((p) => {
        const pid = String(p.id || "");
        const prodPieces = piecesMap[pid] || [];
        return {
          ...p,
          pieces: prodPieces,
          total_pieces: prodPieces.length,
          available_pieces: prodPieces.filter((pc) => pc.status === "available").length,
          sold_pieces: prodPieces.filter((pc) => pc.status === "sold").length,
        };
      });
    } else if (entity === "product_categories" && outRows.length > 0) {
      outRows = (await enrichCategories(outRows as any)) as unknown as Record<string, unknown>[];
    } else if (entity === "profiles" && outRows.length > 0) {
      const [authList, empList, salesList] = await Promise.all([
        db.auth.admin.listUsers({ perPage: 200 }).catch(() => ({ data: { users: [] } })),
        db.from("employees").select("id,code,name,phone,active,profile_id"),
        db.from("pos_sales").select("cashier_id"),
      ]);
      const authMap = new Map(
        (authList?.data?.users || []).map((u) => [u.id, u]),
      );
      const empMap = new Map(
        (empList.data || [])
          .filter((e) => e.profile_id)
          .map((e) => [e.profile_id, e]),
      );
      const billCountMap = new Map<string, number>();
      for (const sRow of salesList.data || []) {
        if (sRow.cashier_id) {
          billCountMap.set(
            sRow.cashier_id,
            (billCountMap.get(sRow.cashier_id) || 0) + 1,
          );
        }
      }
      outRows = outRows.map((p) => {
        const pid = String(p.id || "");
        const au = authMap.get(pid);
        const emp = empMap.get(pid);
        return {
          ...p,
          last_sign_in_at: au?.last_sign_in_at || null,
          email_confirmed: Boolean(au?.email_confirmed_at),
          employee_code: emp?.code || null,
          employee_phone: emp?.phone || null,
          pos_bills_count: billCountMap.get(pid) || 0,
        };
      });
    }
    return ok({
      rows: outRows,
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
          notes: z.string().trim().max(500).default(""),
          adjustment_type: z
            .enum([
              "stock_in",
              "stock_out",
              "adjustment",
              "transfer",
              "damaged",
              "returned",
            ])
            .default("adjustment"),
        })
        .strict()
        .parse(input);

      const db = service();
      const current = await db
        .from("products")
        .select("stock_on_hand")
        .eq("id", p.product_id)
        .single();

      await rpc("adjust_stock", {
        p_actor: s.user.id,
        p_product: p.product_id,
        p_delta: p.delta,
        p_reason: p.reason,
      });

      // Also record in inventory_adjustments audit table
      const prevStock = current.data?.stock_on_hand || 0;
      try {
        await db.from("inventory_adjustments").insert({
          product_id: p.product_id,
          actor_id: s.user.id,
          adjustment_type: p.adjustment_type,
          delta: p.delta,
          previous_stock: prevStock,
          new_stock: prevStock + p.delta,
          reason: p.reason,
          notes: p.notes,
        });
      } catch {}

      try {
        revalidatePath("/", "layout");
        revalidatePath("/shop");
        revalidatePath("/category/[slug]", "page");
        revalidatePath("/products/[slug]", "page");
      } catch {}
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
                "purchases",
                "expenses",
                "attendance",
                "reports",
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

      // If updating a product price, audit the change in product_price_history
      if (entity === "products" && p.id && "price_paise" in data) {
        const db = service();
        const oldProd = await db
          .from("products")
          .select("price_paise,discount_percent")
          .eq("id", p.id)
          .single();

        if (
          oldProd.data &&
          (oldProd.data.price_paise !== data.price_paise ||
            oldProd.data.discount_percent !== data.discount_percent)
        ) {
          try {
            await db.from("product_price_history").insert({
              product_id: p.id,
              old_price_paise: oldProd.data.price_paise,
              new_price_paise: Number(data.price_paise),
              old_discount_percent: oldProd.data.discount_percent || 0,
              new_discount_percent: Number(data.discount_percent || 0),
              change_reason: "Admin dashboard update",
              changed_by: s.user.id,
            });
          } catch {}
        }
      }

      const id = await rpc("admin_save", {
        p_actor: s.user.id,
        p_entity: entity,
        p_id: p.id,
        p_data: data,
      });

      if (
        entity === "products" ||
        entity === "product_categories" ||
        entity === "store_settings"
      ) {
        try {
          revalidatePath("/", "layout");
          revalidatePath("/shop");
          revalidatePath("/category/[slug]", "page");
          revalidatePath("/products/[slug]", "page");
        } catch {}
      }

      return ok({ id, message: "Saved." });
    } else throw new Fault(404, "NOT_FOUND");

    return ok({ message: "Saved." });
  } catch (e) {
    return failure(e);
  }
}

export async function DELETE(
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
    const idParam = new URL(req.url).searchParams.get("id");
    if (!idParam) throw new Fault(400, "ID_REQUIRED");
    const id = uuid.parse(idParam);
    const db = service();

    const deletable = [
      "products",
      "profiles",
      "banners",
      "offers",
      "coupons",
      "employee_leaves",
      "tracking_providers",
    ];
    if (!deletable.includes(entity)) throw new Fault(403, "CANNOT_DELETE");

    let message = "Deleted successfully.";
    let archivedInstead = false;

    if (entity === "profiles") {
      if (id === s.user.id) {
        throw new Fault(403, "CANNOT_DELETE_SELF", "You cannot delete your own account.");
      }
      const { data: target, error: targetErr } = await db
        .from("profiles")
        .select("id,email,role,display_name")
        .eq("id", id)
        .single();
      if (targetErr || !target) throw new Fault(404, "NOT_FOUND");
      if (target.role === "superadmin") {
        throw new Fault(403, "CANNOT_DELETE_SUPERADMIN", "Super Administrator accounts cannot be deleted.");
      }

      // Unlink any employee linked to this login
      await db.from("employees").update({ profile_id: null }).eq("profile_id", id);

      // Check if this user has recorded POS bills
      const { count: posCount } = await db
        .from("pos_sales")
        .select("id", { count: "exact", head: true })
        .eq("cashier_id", id);

      if ((posCount || 0) === 0) {
        const delAuth = await db.auth.admin.deleteUser(id);
        await db.from("profiles").delete().eq("id", id);
        if (!delAuth.error) {
          message = `Staff account "${target.display_name || target.email}" deleted.`;
        } else {
          // Fallback: suspend account if another table references this user
          await db
            .from("profiles")
            .update({ suspended: true, permissions: [] })
            .eq("id", id);
          archivedInstead = true;
          message = `Staff account "${target.display_name || target.email}" suspended (referenced in audit history).`;
        }
      } else {
        await db
          .from("profiles")
          .update({ suspended: true, permissions: [] })
          .eq("id", id);
        archivedInstead = true;
        message = `Staff account "${target.display_name || target.email}" suspended (kept for ${posCount} POS bill record${posCount === 1 ? "" : "s"}).`;
      }
    } else if (entity === "products") {
      // Check if product is linked to completed customer orders or purchases
      const [ordRef, purRef] = await Promise.all([
        db.from("order_items").select("id", { count: "exact", head: true }).eq("product_id", id),
        db.from("purchase_items").select("id", { count: "exact", head: true }).eq("product_id", id),
      ]);
      const hasOrderHistory =
        (ordRef.count || 0) > 0 ||
        (purRef.count || 0) > 0;

      if (!hasOrderHistory) {
        // Safe to hard-delete. Clean up all child/dependent records first so no FK errors occur.
        await Promise.allSettled([
          db.from("product_units").delete().eq("product_id", id),
          db.from("inventory_movements").delete().eq("product_id", id),
          db.from("product_price_history").delete().eq("product_id", id),
          db.from("catalog_discounts").delete().eq("target_id", id).eq("scope", "product"),
          db.from("wishlist").delete().eq("product_id", id),
        ]);
        const del = await db.from("products").delete().eq("id", id);
        if (!del.error) {
          message = "Saree permanently deleted.";
        } else {
          // If hard delete still hits an unexpected constraint, soft delete reliably
          const arch = await db
            .from("products")
            .update({ archived: true, published: false })
            .eq("id", id);
          if (arch.error) throw new Fault(503, "DELETE_FAILED");
          archivedInstead = true;
          message = "Saree removed from catalogue (archived).";
        }
      } else {
        // Linked to historical orders: soft delete so receipts remain intact
        const arch = await db
          .from("products")
          .update({ archived: true, published: false })
          .eq("id", id);
        if (arch.error) throw new Fault(503, "DELETE_FAILED");
        archivedInstead = true;
        message = "Saree removed from catalogue (archived for order history).";
        // Also clean up wishlist and product-level discounts
        await Promise.allSettled([
          db.from("wishlist").delete().eq("product_id", id),
          db.from("catalog_discounts").delete().eq("target_id", id).eq("scope", "product"),
        ]);
      }

      // Revalidate all catalogue routes immediately so changes reflect everywhere
      try {
        revalidatePath("/", "layout");
        revalidatePath("/shop");
        revalidatePath("/category/[slug]", "page");
        revalidatePath("/products/[slug]", "page");
      } catch {}
    } else {
      const del = await db.from(entity).delete().eq("id", id);
      if (del.error) throw new Fault(503, "DELETE_FAILED");
      if (
        entity === "product_categories" ||
        entity === "banners" ||
        entity === "offers"
      ) {
        try {
          revalidatePath("/", "layout");
          revalidatePath("/shop");
        } catch {}
      }
    }

    try {
      await db.from("audit_log").insert({
        actor_id: s.user.id,
        action: archivedInstead ? `${entity}.archived` : `${entity}.deleted`,
        entity,
        entity_id: id,
        details: {},
      });
    } catch {}

    return ok({ message, archived: archivedInstead });
  } catch (e) {
    return failure(e);
  }
}
