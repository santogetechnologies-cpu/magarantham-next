import 'server-only';
import { service } from './server';
import { generateInvoicePdf, InvoiceOrderData } from './invoice';
import { normalizePhone } from './phone';

export interface WhatsAppNotificationResult {
  success: boolean;
  status: 'sent' | 'pending' | 'failed';
  messageId?: string;
  error?: string;
}

/**
 * Formats the exact order confirmation message specified by Magarantham Silks
 */
export function formatOrderConfirmationMessage(order: InvoiceOrderData): string {
  const orderDate = new Date(order.created_at).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });

  const subtotalRs = ((order.subtotal_paise || 0) / 100).toLocaleString('en-IN');
  const discountRs = ((order.discount_paise || 0) / 100).toLocaleString('en-IN');
  const shippingRs = ((order.shipping_paise || 0) / 100).toLocaleString('en-IN');
  const totalRs = ((order.total_paise || 0) / 100).toLocaleString('en-IN');

  const itemsText = (order.order_items || [])
    .map(
      (item) =>
        `Product Name: ${item.name}${(item as { colour?: string }).colour ? ` (${(item as { colour?: string }).colour})` : ""}\nQuantity: ${item.quantity}\nPrice: ₹${((item.unit_price_paise || 0) / 100).toLocaleString('en-IN')}`
    )
    .join('\n\n');

  const paymentStatusDisplay =
    order.payment_status === 'paid'
      ? 'Paid'
      : order.payment_status === 'submitted'
      ? 'Under Verification'
      : 'Pending';

  const paymentMethodDisplay =
    order.channel === 'razorpay'
      ? 'UPI / Online'
      : order.channel === 'upi'
      ? 'UPI'
      : 'WhatsApp';

  return `MAGARANTHAM SILKS

Dear Customer,

Thank you for shopping with Magarantham Silks!

Your order has been successfully placed.

Order Number: MS-${order.number}
Order Date: ${orderDate}

Order Details:
${itemsText}

Subtotal: ₹${subtotalRs}
Discount: ₹${discountRs}
Delivery Charges: ₹${shippingRs}

Total Amount: ₹${totalRs}

Payment Method: ${paymentMethodDisplay}
Payment Status: ${paymentStatusDisplay}

Your invoice is attached below.

Thank you for choosing Magarantham Silks!`;
}

/**
 * Sends order confirmation with attached PDF invoice via Meta WhatsApp Business Cloud API.
 * Idempotent, tracks delivery in `whatsapp_notifications`, and never throws to ensure checkout is unaffected.
 */
export async function sendOrderConfirmationWhatsApp(orderId: string): Promise<WhatsAppNotificationResult> {
  const db = service();

  try {
    // 1. Fetch full order details
    const { data: order, error: orderErr } = await db
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', orderId)
      .single();

    if (orderErr || !order) {
      console.warn(`[WhatsApp] Order ${orderId} not found.`);
      return { success: false, status: 'failed', error: 'Order not found.' };
    }

    // Determine customer phone number
    const rawPhone =
      order.customer_phone ||
      order.address?.phone ||
      '';

    if (!rawPhone) {
      console.warn(`[WhatsApp] No phone number available for order MS-${order.number}`);
      return { success: false, status: 'failed', error: 'No recipient phone number on order.' };
    }

    const normalizedPhone = normalizePhone(rawPhone, '+91');
    const recipientDigits = normalizedPhone.replace(/\D/g, '');

    // 2. Idempotency Check: prevent duplicate WhatsApp messages
    const { data: existingNotif } = await db
      .from('whatsapp_notifications')
      .select('id, status, whatsapp_message_id')
      .eq('order_id', orderId)
      .maybeSingle();

    if (existingNotif && (existingNotif.status === 'sent' || existingNotif.status === 'delivered')) {
      return {
        success: true,
        status: existingNotif.status,
        messageId: existingNotif.whatsapp_message_id,
      };
    }

    // Record or update pending notification
    const nowIso = new Date().toISOString();
    let notifId = existingNotif?.id;

    if (!notifId) {
      const { data: ins } = await db
        .from('whatsapp_notifications')
        .insert({
          order_id: orderId,
          customer_id: order.customer_id,
          recipient_phone: normalizedPhone,
          status: 'pending',
          attempts: 1,
          last_attempt_at: nowIso,
        })
        .select('id')
        .single();
      notifId = ins?.id;
    } else {
      await db
        .from('whatsapp_notifications')
        .update({
          status: 'pending',
          recipient_phone: normalizedPhone,
          last_attempt_at: nowIso,
        })
        .eq('id', notifId);
    }

    // 3. Generate PDF Invoice
    const { data: settings } = await db
      .from('store_settings')
      .select('brand_name,support_email,support_phone,whatsapp_phone')
      .eq('id', true)
      .maybeSingle();

    const pdfBuffer = await generateInvoicePdf(order, settings || undefined);

    // Save invoice to Supabase private storage
    const storagePath = `invoices/Invoice-MS-${order.number}-${Date.now()}.pdf`;
    let invoiceDownloadUrl = '';

    try {
      await db.storage.from('invoices').upload(storagePath, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

      const { data: signed } = await db.storage
        .from('invoices')
        .createSignedUrl(storagePath, 60 * 60 * 24 * 7); // 7 days validity
      invoiceDownloadUrl = signed?.signedUrl || '';
    } catch (storageErr) {
      console.warn('[WhatsApp] Invoice storage warning:', (storageErr as Error).message);
    }

    // If storage URL is unavailable, fallback to direct app route URL
    if (!invoiceDownloadUrl && process.env.NEXT_PUBLIC_SITE_URL) {
      invoiceDownloadUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/api/orders/${order.id}/invoice`;
    }

    // 4. Send via Meta WhatsApp Cloud API
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
    const apiVersion = process.env.WHATSAPP_API_VERSION || 'v21.0';
    const templateName = process.env.WHATSAPP_TEMPLATE_NAME;

    if (!phoneNumberId || !accessToken) {
      const notice = 'Meta WhatsApp API credentials not configured in environment. Notification pending.';
      console.info(`[WhatsApp] ${notice} (Order MS-${order.number})`);
      if (notifId) {
        await db
          .from('whatsapp_notifications')
          .update({
            status: 'pending',
            pdf_storage_path: storagePath,
            error_message: notice,
            updated_at: new Date().toISOString(),
          })
          .eq('id', notifId);
      }
      return { success: false, status: 'pending', error: notice };
    }

    const messageText = formatOrderConfirmationMessage(order);
    const invoiceFilename = `Magarantham_Silks_Invoice_MS-${order.number}.pdf`;

    let payload: Record<string, unknown>;

    if (templateName) {
      // Approved Meta WhatsApp Business Template message
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientDigits,
        type: 'template',
        template: {
          name: templateName,
          language: { code: 'en' },
          components: [
            ...(invoiceDownloadUrl
              ? [
                  {
                    type: 'header',
                    parameters: [
                      {
                        type: 'document',
                        document: {
                          link: invoiceDownloadUrl,
                          filename: invoiceFilename,
                        },
                      },
                    ],
                  },
                ]
              : []),
            {
              type: 'body',
              parameters: [
                { type: 'text', text: order.address?.name || 'Customer' },
                { type: 'text', text: `MS-${order.number}` },
                { type: 'text', text: `₹${(order.total_paise / 100).toLocaleString('en-IN')}` },
              ],
            },
          ],
        },
      };
    } else {
      // Standard WhatsApp Document Message with Caption
      payload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientDigits,
        type: 'document',
        document: {
          link: invoiceDownloadUrl,
          caption: messageText,
          filename: invoiceFilename,
        },
      };
    }

    const response = await fetch(`https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const resJson = await response.json();

    if (!response.ok || resJson.error) {
      const errMsg = resJson.error?.message || `HTTP ${response.status}: Failed to deliver WhatsApp message`;
      console.warn(`[WhatsApp] Delivery failed for MS-${order.number}:`, errMsg);

      if (notifId) {
        await db
          .from('whatsapp_notifications')
          .update({
            status: 'failed',
            pdf_storage_path: storagePath,
            error_message: errMsg,
            updated_at: new Date().toISOString(),
          })
          .eq('id', notifId);
      }
      return { success: false, status: 'failed', error: errMsg };
    }

    const messageId = resJson.messages?.[0]?.id || '';

    if (notifId) {
      await db
        .from('whatsapp_notifications')
        .update({
          status: 'sent',
          whatsapp_message_id: messageId,
          pdf_storage_path: storagePath,
          sent_at: new Date().toISOString(),
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', notifId);
    }

    console.info(`[WhatsApp] Order confirmation sent for MS-${order.number} to ${recipientDigits} (MsgID: ${messageId})`);
    return { success: true, status: 'sent', messageId };
  } catch (err) {
    const errorMsg = (err as Error).message;
    console.error(`[WhatsApp] Unexpected notification error for order ${orderId}:`, errorMsg);
    return { success: false, status: 'failed', error: errorMsg };
  }
}
