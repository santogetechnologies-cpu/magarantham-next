import { z } from "zod";
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
  razor,
} from "@/lib/server";
import { getOrder } from "@/lib/store";
import { reconcile, reconcileRefund } from "@/lib/payments";
import { syncOrderPieces } from "@/lib/piece-server";
import { sendOrderConfirmationWhatsApp } from "@/lib/whatsapp";
import { uuid } from "@/lib/schemas";
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
    const { id, action } = await params;
    uuid.parse(id);
    const s = await staff(action === "proofs" ? "payments" : "orders");
    if (action === "view") {
      const o = await getOrder(id);
      return ok({ order: o, profile: s.profile });
    }
    if (action === "proofs") {
      const { data, error } = await service()
        .from("payment_proofs")
        .select("*")
        .eq("order_id", id);
      if (error) throw new Fault(503, "LOAD_FAILED");
      const rows = [];
      for (const p of data) {
        const signed = await service()
          .storage.from("payment-proofs")
          .createSignedUrl(p.storage_path, 60);
        rows.push({
          id: p.id,
          reference: p.reference,
          created_at: p.created_at,
          url: signed.data?.signedUrl,
        });
      }
      return ok({ rows });
    }
    throw new Fault(404, "NOT_FOUND");
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
    const { id, action } = await params;
    uuid.parse(id);
    const cap =
      action === "tracking"
        ? "shipping"
        : ["confirm", "refund", "refund-check", "reconcile"].includes(action)
          ? "payments"
          : "orders";
    const s = await staff(cap);
    await rate(req, "staff-order", s.user.id, 60);
    const data = await json(req);
    const o = await getOrder(id);
    if (action === "status") {
      const p = z
        .object({
          status: z.enum([
            "packing",
            "shipped",
            "delivered",
            "cancelled",
            "return_requested",
            "returned",
          ]),
          note: z.string().max(500).default(""),
        })
        .strict()
        .parse(data);
      await rpc("change_order_status", {
        p_actor: s.user.id,
        p_order: id,
        p_status: p.status,
        p_note: p.note,
      });
      await syncOrderPieces(id);
    } else if (action === "confirm") {
      const p = z
        .object({
          reference: z
            .string()
            .trim()
            .min(6)
            .max(80)
            .regex(/^[a-zA-Z0-9 -]+$/),
          bank_checked: z.literal(true),
        })
        .strict()
        .parse(data);
      await rpc("record_payment", {
        p_order: id,
        p_event: `manual:${id}`,
        p_payment: null,
        p_amount: o.total_paise,
        p_currency: "INR",
        p_method: "manual",
        p_actor: s.user.id,
        p_reference: p.reference,
      });
      await syncOrderPieces(id);
      sendOrderConfirmationWhatsApp(id).catch((err) =>
        console.warn("[Admin Order] WhatsApp trigger error:", err),
      );
    } else if (action === "tracking") {
      const p = z
        .object({
          provider_id: uuid,
          tracking_id: z.string().trim().min(2).max(100),
        })
        .strict()
        .parse(data);
      await rpc("set_tracking", {
        p_actor: s.user.id,
        p_order: id,
        p_provider: p.provider_id,
        p_tracking: p.tracking_id,
      });
    } else if (action === "reconcile") {
      const p = z
        .object({ payment_id: z.string().regex(/^pay_[a-zA-Z0-9]+$/) })
        .strict()
        .parse(data);
      const payment = await razor(`payments/${p.payment_id}`);
      if (!o.provider_order_id) {
        const gatewayOrder = await razor(`orders/${payment.order_id}`);
        if (
          gatewayOrder.notes?.store_order_id !== o.id ||
          gatewayOrder.amount !== o.total_paise ||
          gatewayOrder.currency !== "INR" ||
          o.channel !== "razorpay"
        )
          throw new Fault(409, "PAYMENT_MISMATCH");
        const updated = await service()
          .from("orders")
          .update({
            provider_order_id: gatewayOrder.id,
            gateway_state: "ready",
          })
          .eq("id", o.id)
          .is("provider_order_id", null);
        if (updated.error) throw new Fault(409, "GATEWAY_SAVE_FAILED");
      }
      await reconcile(p.payment_id, id);
      await service()
        .from("audit_log")
        .insert({
          actor_id: s.user.id,
          action: "payment.reconciled",
          entity: "orders",
          entity_id: id,
        });
    } else if (action === "refund") {
      const p = z
        .object({
          note: z.string().trim().min(3).max(500),
          reference: z.string().trim().max(100).default(""),
          bank_checked: z.boolean().default(false),
        })
        .strict()
        .parse(data);
      if (
        o.channel !== "razorpay" &&
        (!p.bank_checked || p.reference.length < 6)
      )
        throw new Fault(400, "REFUND_REFERENCE_REQUIRED");
      const refundId = await rpc("refund_begin", {
        p_actor: s.user.id,
        p_order: id,
        p_note: p.note,
      });
      if (o.channel === "razorpay") {
        try {
          if (!o.provider_payment_id)
            throw new Fault(409, "PAYMENT_ID_REQUIRED");
          const r = await razor(`payments/${o.provider_payment_id}/refund`, {
            amount: o.total_paise,
            notes: { store_refund_id: refundId },
          });
          const saved = await service()
            .from("refunds")
            .update({ provider_refund_id: r.id })
            .eq("id", refundId);
          if (saved.error) throw new Fault(503, "REFUND_SAVE_FAILED");
          if (r.status === "processed")
            await reconcileRefund(r.id, `refund:${r.id}`);
        } catch (e) {
          await service()
            .from("refunds")
            .update({ status: "manual_review" })
            .eq("id", refundId);
          throw e;
        }
      } else
        await rpc("refund_complete", {
          p_order: id,
          p_provider: null,
          p_reference: p.reference,
          p_event: `manual-refund:${id}`,
        });
    } else if (action === "refund-check") {
      const p = z
        .object({ refund_id: z.string().regex(/^rfnd_[a-zA-Z0-9]+$/) })
        .strict()
        .parse(data);
      const r = await razor(`refunds/${p.refund_id}`);
      if (r.payment_id !== o.provider_payment_id || r.amount !== o.total_paise)
        throw new Fault(409, "PAYMENT_MISMATCH");
      const { data: ref } = await service()
        .from("refunds")
        .select("id,provider_refund_id")
        .eq("order_id", id)
        .single();
      if (!ref || (ref.provider_refund_id && ref.provider_refund_id !== r.id))
        throw new Fault(409, "REFUND_NOT_STARTED");
      const saved = await service()
        .from("refunds")
        .update({ provider_refund_id: r.id })
        .eq("id", ref.id);
      if (saved.error) throw new Fault(409, "CHANGE_FAILED");
      await reconcileRefund(r.id, `refund:${r.id}`);
      await service()
        .from("audit_log")
        .insert({
          actor_id: s.user.id,
          action: "refund.reconciled",
          entity: "orders",
          entity_id: id,
        });
    } else if (action === "retry-whatsapp") {
      const res = await sendOrderConfirmationWhatsApp(id);
      return ok({
        message: res.success
          ? "WhatsApp notification sent successfully."
          : `WhatsApp notification ${res.status}: ${res.error || "queued"}`,
      });
    } else throw new Fault(404, "NOT_FOUND");
    return ok({ message: "Order updated." });
  } catch (e) {
    return failure(e);
  }
}
