import { readBody, ok, failure, Fault } from "@/lib/server";
import { verifyHmac } from "@/lib/security";
import { reconcile, reconcileRefund } from "@/lib/payments";
export async function POST(req: Request) {
  try {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) throw new Fault(503, "WEBHOOK_NOT_CONFIGURED");
    const raw = await readBody(req, 1000000);
    if (!verifyHmac(raw, req.headers.get("x-razorpay-signature") || "", secret))
      throw new Fault(401, "INVALID_SIGNATURE");
    const e = JSON.parse(raw);
    if (e.event === "payment.captured") {
      const id = e.payload?.payment?.entity?.id;
      await reconcile(id, undefined, `capture:${id}`);
    } else if (e.event === "refund.processed") {
      const id = e.payload?.refund?.entity?.id;
      await reconcileRefund(id, `refund:${id}`);
    }
    return ok({ received: true });
  } catch (e) {
    return failure(e);
  }
}
