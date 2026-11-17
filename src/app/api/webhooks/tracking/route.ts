import { z } from "zod";
import { readBody, ok, failure, Fault, rpc } from "@/lib/server";
import { verifyHmac } from "@/lib/security";
export async function POST(req: Request) {
  try {
    const secret = process.env.TRACKING_WEBHOOK_SECRET;
    if (!secret) throw new Fault(503, "WEBHOOK_NOT_CONFIGURED");
    const raw = await readBody(req, 10000);
    if (!verifyHmac(raw, req.headers.get("x-store-signature") || "", secret))
      throw new Fault(401, "INVALID_SIGNATURE");
    const p = z
      .object({
        event_id: z.string().min(1).max(100),
        order_id: z.uuid(),
        tracking_id: z.string().min(2).max(100),
        status: z.enum(["shipped", "delivered"]),
      })
      .strict()
      .parse(JSON.parse(raw));
    await rpc("tracking_event", {
      p_event: p.event_id,
      p_order: p.order_id,
      p_tracking: p.tracking_id,
      p_status: p.status,
    });
    return ok({ received: true });
  } catch (e) {
    return failure(e);
  }
}
