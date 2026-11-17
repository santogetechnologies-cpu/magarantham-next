import { verifyHmac } from "@/lib/security";
import { z } from "zod";
import {
  origin,
  json,
  identity,
  rate,
  service,
  rpc,
  ok,
  failure,
  Fault,
  razor,
} from "@/lib/server";
import { uuid } from "@/lib/schemas";
import { getOrder } from "@/lib/store";
import { money, trackingUrl } from "@/lib/core";
import { reconcile } from "@/lib/payments";
export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{
      id: string;
      action: string;
    }>;
  },
) {
  try {
    const s = await identity();
    const { id, action } = await params;
    uuid.parse(id);
    if (action !== "view") throw new Fault(404, "NOT_FOUND");
    const o = await getOrder(id, s.user.id);
    const { data: provider } = o.tracking_provider_id
      ? await service()
          .from("tracking_providers")
          .select("name,url_template")
          .eq("id", o.tracking_provider_id)
          .single()
      : { data: null };
    const { data: settings } = await service()
      .from("store_settings")
      .select("upi_id,upi_name,whatsapp_phone")
      .eq("id", true)
      .single();
    const text = `Order MS-${o.number}\n${o.order_items
      .map(
        (i: { name: string; quantity: number }) => `${i.name} × ${i.quantity}`,
      )
      .join(
        "\n",
      )}\nTotal: ${money(o.total_paise)}\n${o.address.name}, ${o.address.phone}\n${o.address.line1}, ${o.address.line2}, ${o.address.city}, ${o.address.state} ${o.address.pin}\nReference: ${o.id}`;
    const whatsapp_url =
      o.channel === "whatsapp" && settings?.whatsapp_phone
        ? `https://wa.me/${settings.whatsapp_phone}?text=${encodeURIComponent(text)}`
        : null;
    const upi_url =
      o.channel === "upi" && settings?.upi_id
        ? `upi://pay?${new URLSearchParams({ pa: settings.upi_id, pn: settings.upi_name, am: (o.total_paise / 100).toFixed(2), cu: "INR", tn: `MS-${o.number}`, tr: o.id })}`
        : null;
    return ok({
      order: {
        ...o,
        order_events: o.order_events.filter(
          (x: { customer_visible: boolean }) => x.customer_visible,
        ),
      },
      tracking_url: provider
        ? trackingUrl(provider.url_template, o.tracking_id)
        : null,
      tracking_provider: provider?.name,
      whatsapp_url,
      upi_url,
      upi_id: o.channel === "upi" ? settings?.upi_id : null,
      upi_name: o.channel === "upi" ? settings?.upi_name : null,
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
      id: string;
      action: string;
    }>;
  },
) {
  try {
    origin(req);
    const s = await identity();
    const { id, action } = await params;
    uuid.parse(id);
    await rate(req, "order-action", s.user.id, 30);
    const p = await json(req);
    const o = await getOrder(id, s.user.id);
    if (action === "status") {
      const data = z
        .object({
          status: z.enum(["cancelled", "return_requested"]),
          note: z.string().max(500).default(""),
        })
        .strict()
        .parse(p);
      await rpc("change_order_status", {
        p_actor: s.user.id,
        p_order: id,
        p_status: data.status,
        p_note: data.note,
      });
      return ok({ message: "Order updated." });
    }
    if (action === "gateway") {
      if (
        o.status !== "awaiting_payment" ||
        o.stock_state !== "reserved" ||
        !["pending", "submitted"].includes(o.payment_status) ||
        Date.parse(o.expires_at) <= Date.now()
      )
        throw new Fault(409, "PAYMENT_WINDOW_CLOSED");
      if (o.channel !== "razorpay") throw new Fault(409, "CHANNEL_DISABLED");
      if (o.provider_order_id)
        return ok({
          order_id: o.provider_order_id,
          key: process.env.RAZORPAY_KEY_ID,
          amount: o.total_paise,
        });
      const claimed = await rpc("gateway_claim", {
        p_customer: s.user.id,
        p_order: id,
      });
      if (!claimed)
        throw new Fault(
          409,
          "GATEWAY_REVIEW_REQUIRED",
          "Payment setup is pending or needs staff review. Do not start another payment.",
        );
      try {
        const provider = await razor("orders", {
          amount: o.total_paise,
          currency: "INR",
          receipt: `MS-${o.number}`,
          notes: { store_order_id: id },
        });
        if (!provider.id || provider.amount !== o.total_paise)
          throw new Fault(502, "GATEWAY_REQUEST_FAILED");
        const result = await service()
          .from("orders")
          .update({ provider_order_id: provider.id, gateway_state: "ready" })
          .eq("id", id)
          .eq("gateway_state", "creating");
        if (result.error) throw new Fault(503, "GATEWAY_SAVE_FAILED");
        return ok({
          order_id: provider.id,
          key: process.env.RAZORPAY_KEY_ID,
          amount: o.total_paise,
        });
      } catch (e) {
        await service()
          .from("orders")
          .update({ gateway_state: "review" })
          .eq("id", id)
          .eq("gateway_state", "creating");
        throw e;
      }
    }
    if (action === "verify") {
      const d = z
        .object({
          payment_id: z.string().max(100),
          signature: z.string().max(128),
        })
        .strict()
        .parse(p);
      if (
        !o.provider_order_id ||
        !process.env.RAZORPAY_KEY_SECRET ||
        !verifyHmac(
          `${o.provider_order_id}|${d.payment_id}`,
          d.signature,
          process.env.RAZORPAY_KEY_SECRET,
        )
      )
        throw new Fault(400, "PAYMENT_SIGNATURE_INVALID");
      await reconcile(d.payment_id, id);
      return ok({ message: "Payment checked." });
    }
    if (action === "recheck") {
      if (!o.provider_payment_id)
        throw new Fault(409, "WAIT_FOR_PAYMENT_UPDATE");
      await reconcile(o.provider_payment_id, id);
      return ok({ message: "Payment checked." });
    }
    throw new Fault(404, "NOT_FOUND");
  } catch (e) {
    return failure(e);
  }
}
