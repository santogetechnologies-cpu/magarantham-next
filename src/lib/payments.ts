import "server-only";
import { Fault, service, rpc, razor } from "./server";
import { sendOrderConfirmationWhatsApp } from "./whatsapp";
export async function reconcile(
  paymentId: string,
  expectedOrder?: string,
  event?: string,
) {
  if (!/^pay_[a-zA-Z0-9]+$/.test(paymentId))
    throw new Fault(400, "INVALID_PAYMENT_ID");
  const payment = await razor(`payments/${paymentId}`);
  const { data: o, error } = await service()
    .from("orders")
    .select("*")
    .eq("provider_order_id", payment.order_id)
    .single();
  if (error || !o || (expectedOrder && o.id !== expectedOrder))
    throw new Fault(409, "PAYMENT_MISMATCH");
  if (payment.status !== "captured" || payment.captured !== true)
    throw new Fault(
      409,
      "PAYMENT_NOT_CAPTURED",
      "Payment is not captured yet. Try checking again shortly.",
    );
  if (
    payment.amount !== o.total_paise ||
    payment.currency !== "INR" ||
    payment.method !== "upi" ||
    payment.order_id !== o.provider_order_id
  )
    throw new Fault(409, "PAYMENT_MISMATCH");
  const result = await rpc("record_payment", {
    p_order: o.id,
    p_event: event || `capture:${payment.id}`,
    p_payment: payment.id,
    p_amount: payment.amount,
    p_currency: payment.currency,
    p_method: payment.method,
  });
  // Colour stock is consumed inside record_payment (same transaction as the stock ledger).
  // Send WhatsApp confirmation & PDF invoice
  sendOrderConfirmationWhatsApp(o.id).catch((err) =>
    console.warn("[Payments] WhatsApp trigger error:", err),
  );
  return result;
}
export async function reconcileRefund(id: string, event: string) {
  if (!/^rfnd_[a-zA-Z0-9]+$/.test(id))
    throw new Fault(400, "INVALID_REFUND_ID");
  const r = await razor(`refunds/${id}`);
  const { data: refund } = await service()
    .from("refunds")
    .select("*,orders(*)")
    .eq("provider_refund_id", id)
    .single();
  if (!refund) throw new Fault(409, "REFUND_UNKNOWN");
  const o = refund.orders;
  if (
    r.status !== "processed" ||
    r.amount !== o.total_paise ||
    r.payment_id !== o.provider_payment_id
  )
    throw new Fault(409, "REFUND_NOT_COMPLETE");
  return rpc("refund_complete", {
    p_order: o.id,
    p_provider: id,
    p_reference: r.id,
    p_event: event,
  });
}
