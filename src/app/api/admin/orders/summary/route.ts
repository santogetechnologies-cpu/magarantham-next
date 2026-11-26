import { NextResponse } from "next/server";
import { staff, service, failure } from "@/lib/server";

export async function GET(req: Request) {
  try {
    await staff("orders");
    const db = service();
    const url = new URL(req.url);
    const q = (url.searchParams.get("q") || "").trim().toLowerCase();
    const status = (url.searchParams.get("status") || "").trim();
    const paymentStatus = (url.searchParams.get("payment_status") || "").trim();
    const fromDate = (url.searchParams.get("from") || "").trim();
    const toDate = (url.searchParams.get("to") || "").trim();
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const limit = Math.min(50, Math.max(5, Number(url.searchParams.get("limit") || 15)));

    // 1. Summary KPIs across all orders
    const { data: allStatsRows } = await db
      .from("orders")
      .select("id,status,payment_status,total_paise");

    const statsRows = allStatsRows || [];
    const summary = {
      totalOrders: statsRows.length,
      newOrders: statsRows.filter((r) => ["awaiting_payment", "confirmed"].includes(r.status)).length,
      processingOrders: statsRows.filter((r) => r.status === "packing").length,
      shippedOrders: statsRows.filter((r) => r.status === "shipped").length,
      deliveredOrders: statsRows.filter((r) => r.status === "delivered").length,
      cancelledOrders: statsRows.filter((r) => ["cancelled", "expired"].includes(r.status)).length,
      totalRevenuePaise: statsRows
        .filter((r) => !["cancelled", "expired"].includes(r.status))
        .reduce((sum, r) => sum + Number(r.total_paise || 0), 0),
    };

    // 2. Filtered orders query
    let query = db
      .from("orders")
      .select(
        "id,number,customer_id,customer_phone,status,payment_status,channel,total_paise,address,created_at,order_items(id,quantity),profiles(email,display_name)",
      )
      .order("created_at", { ascending: false });

    if (status) query = query.eq("status", status);
    if (paymentStatus) query = query.eq("payment_status", paymentStatus);
    if (fromDate) query = query.gte("created_at", `${fromDate}T00:00:00Z`);
    if (toDate) query = query.lte("created_at", `${toDate}T23:59:59Z`);

    const { data: rawOrders, error } = await query.limit(500);
    if (error) throw error;

    let filtered = rawOrders || [];
    if (q) {
      filtered = filtered.filter((o) => {
        const orderNum = `ms-${o.number}`.toLowerCase();
        const numOnly = String(o.number);
        const name = String((o.address as Record<string, unknown>)?.name || "").toLowerCase();
        const phone = String(o.customer_phone || (o.address as Record<string, unknown>)?.phone || "").toLowerCase();
        return (
          orderNum.includes(q) ||
          numOnly.includes(q) ||
          name.includes(q) ||
          phone.includes(q)
        );
      });
    }

    const totalCount = filtered.length;
    const totalPages = Math.max(1, Math.ceil(totalCount / limit));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * limit;
    const pagedOrders = filtered.slice(offset, offset + limit).map((o) => {
      const items = Array.isArray(o.order_items) ? o.order_items : [];
      const itemCount = items.reduce((sum, i) => sum + Number(i.quantity || 1), 0);
      return {
        ...o,
        item_count: itemCount,
      };
    });

    return NextResponse.json({
      summary,
      orders: pagedOrders,
      page: safePage,
      totalPages,
      totalCount,
    });
  } catch (e) {
    return failure(e);
  }
}
