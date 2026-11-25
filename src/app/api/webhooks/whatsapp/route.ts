import { NextResponse } from 'next/server';
import { service } from '@/lib/server';

/**
 * Meta WhatsApp Business Webhook:
 * Handles webhook verification (GET) and delivery status receipts (POST).
 */

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge');

  const verifyToken = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'magarantham_whatsapp_verify_token';

  if (mode === 'subscribe' && token === verifyToken) {
    return new Response(challenge, { status: 200 });
  }

  return new Response('Forbidden', { status: 403 });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Meta sends changes array in entry
    const entries = body.entry || [];
    const db = service();

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        const statuses = change.value?.statuses || [];
        for (const st of statuses) {
          const messageId = st.id;
          const status = st.status; // 'sent' | 'delivered' | 'read' | 'failed'

          if (messageId) {
            let dbStatus: 'sent' | 'delivered' | 'failed' | null = null;
            if (status === 'delivered' || status === 'read') {
              dbStatus = 'delivered';
            } else if (status === 'sent') {
              dbStatus = 'sent';
            } else if (status === 'failed') {
              dbStatus = 'failed';
            }

            if (dbStatus) {
              const upd: Record<string, unknown> = {
                status: dbStatus,
                updated_at: new Date().toISOString(),
              };
              if (dbStatus === 'delivered') {
                upd.delivered_at = new Date().toISOString();
              }
              if (status === 'failed' && st.errors?.[0]?.message) {
                upd.error_message = st.errors[0].message;
              }

              await db
                .from('whatsapp_notifications')
                .update(upd)
                .eq('whatsapp_message_id', messageId);
            }
          }
        }
      }
    }

    return NextResponse.json({ status: 'ok' });
  } catch (err) {
    console.warn('[WhatsApp Webhook] Error processing event:', (err as Error).message);
    return NextResponse.json({ status: 'error' }, { status: 200 });
  }
}
