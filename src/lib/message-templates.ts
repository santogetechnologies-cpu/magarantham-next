/**
 * Customisable WhatsApp messages (table public.message_templates, migration 023).
 * Staff press "Open WhatsApp"; wa.me opens with the text filled in and they tap Send.
 */
export const MESSAGE_TEMPLATE_KEYS = ["pos_bill_whatsapp", "order_whatsapp", "order_dispatched_whatsapp"] as const;
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

export const MESSAGE_TEMPLATE_LABELS: Record<MessageTemplateKey, { title: string; hint: string }> = {
  pos_bill_whatsapp: { title: "POS bill (after billing at the counter)", hint: "Opens after every counter bill that has a customer mobile number." },
  order_whatsapp: { title: "Online order", hint: "Used from the order page to message the customer about their order." },
  order_dispatched_whatsapp: { title: "Order dispatched", hint: "Used after an order is marked Dispatched, with the courier tracking link." },
};

export const DEFAULT_TEMPLATES: Record<MessageTemplateKey, string> = {
  pos_bill_whatsapp:
    "Vanakkam {customer_name} 🙏\n\nThank you for shopping with {store_name}! Your bill *{invoice_no}* dated {date} comes to *{total}*.\n\n{items}\n\nWe hope you love wearing it. Please visit us again 💐\n{store_phone}",
  order_whatsapp:
    "Vanakkam {customer_name} 🙏\n\nThank you for your order *#{order_no}* with {store_name}. Order total: *{total}*.\n\n{items}\n\nWe will keep you updated at every step 💐",
  order_dispatched_whatsapp:
    "Vanakkam {customer_name} 🙏\n\nGood news! Your {store_name} order *#{order_no}* has been dispatched via {courier}.\nTracking ID: {tracking_id}\nTrack here: {tracking_link}\n\nThank you for shopping with us 💐",
};

export const TEMPLATE_PLACEHOLDERS = [
  "customer_name", "store_name", "invoice_no", "order_no", "total", "items", "date",
  "courier", "tracking_id", "tracking_link", "store_phone",
] as const;

/** Fill {placeholders}; unknown ones are left as typed. Blank lines left by empty values are tidied. */
export function renderTemplate(body: string, values: Partial<Record<(typeof TEMPLATE_PLACEHOLDERS)[number], string>>) {
  return body
    .replace(/\{([a-z_]+)\}/g, (m, k: string) => (k in values ? String(values[k as keyof typeof values] ?? "") : m))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Indian mobile → digits for wa.me (10 digits get the 91 country code). Null when unusable. */
export function whatsappNumber(phone: string): string | null {
  const digits = String(phone || "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10) return `91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return digits;
  return null;
}

export function whatsappLink(phone: string, text: string): string | null {
  const n = whatsappNumber(phone);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : null;
}
