import {
  origin,
  json,
  identity,
  rate,
  rpc,
  ok,
  failure,
  Fault,
  service,
} from "@/lib/server";
import { checkoutSchema } from "@/lib/schemas";
import { sendOrderConfirmationWhatsApp } from "@/lib/whatsapp";
export async function POST(req: Request) {
  try {
    origin(req);
    const session = await identity();
    await rate(req, "checkout", session.user.id, 15);
    const p = checkoutSchema.parse(await json(req));
    if (p.channel === "whatsapp" && !p.whatsapp_consent)
      throw new Fault(400, "WHATSAPP_CONSENT_REQUIRED");
    const id = await rpc("create_checkout", {
      p_customer: session.user.id,
      p_key: p.key,
      p_cart: p.cart,
      p_address: p.address,
      p_channel: p.channel,
      p_coupon: p.coupon || null,
    });
    const customerPhone = p.address.phone || session.profile?.phone || null;
    if (customerPhone) {
      await service().from("orders").update({ customer_phone: customerPhone }).eq("id", id);
    }
    for (const item of p.cart) {
      if (item.piece_id || item.piece_code) {
        try {
          await service()
            .from("order_items")
            .update({
              piece_id: item.piece_id || null,
              piece_code: item.piece_code || null,
            })
            .eq("order_id", id)
            .eq("product_id", item.product_id);
        } catch {}
      }
    }
    try {
      const db = service();
      const { data: createdOrder } = await db
        .from("orders")
        .select("id,number,total_paise,customer_phone,address")
        .eq("id", id)
        .maybeSingle();
      if (createdOrder) {
        const itemCount = p.cart.reduce((sum, line) => sum + (line.quantity || 1), 0);
        await db.from("admin_notifications").upsert(
          {
            order_id: createdOrder.id,
            order_number: createdOrder.number,
            customer_name: p.address.name || session.profile?.display_name || "Customer",
            customer_phone: createdOrder.customer_phone || p.address.phone || "",
            item_count: itemCount,
            total_paise: createdOrder.total_paise,
            is_read: false,
          },
          { onConflict: "order_id", ignoreDuplicates: true },
        );
      }
    } catch {}
    if (p.channel === "whatsapp") {
      sendOrderConfirmationWhatsApp(id).catch((err) =>
        console.warn("[Checkout] WhatsApp trigger error:", err),
      );
    }
    return ok({ id, redirect: `/account/orders/${id}?placed=1` });
  } catch (e) {
    return failure(e);
  }
}
