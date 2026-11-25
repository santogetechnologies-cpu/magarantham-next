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
    if (p.channel === "whatsapp") {
      sendOrderConfirmationWhatsApp(id).catch((err) =>
        console.warn("[Checkout] WhatsApp trigger error:", err),
      );
    }
    return ok({ id, redirect: `/account/orders/${id}` });
  } catch (e) {
    return failure(e);
  }
}
