import {
  origin,
  json,
  identity,
  rate,
  rpc,
  ok,
  failure,
  Fault,
} from "@/lib/server";
import { checkoutSchema } from "@/lib/schemas";
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
    return ok({ id, redirect: `/account/orders/${id}` });
  } catch (e) {
    return failure(e);
  }
}
