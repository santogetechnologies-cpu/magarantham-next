import { protectedSecret, rpc, ok, failure } from "@/lib/server";
export async function GET(req: Request) {
  try {
    await protectedSecret(req, "CRON_SECRET");
    let expired = 0;
    for (let i = 0; i < 50; i++) {
      const n = await rpc("expire_reservations", {});
      expired += n;
      if (!n) break;
    }
    let sent = 0;
    if (process.env.RESEND_API_KEY && process.env.ORDER_FROM_EMAIL) {
      await rpc("email_recover", {});
      const rows = await rpc("email_claim", {});
      for (const r of rows || []) {
        let success = false;
        try {
          const res = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
              "Content-Type": "application/json",
              "Idempotency-Key": r.id,
            },
            body: JSON.stringify({
              from: process.env.ORDER_FROM_EMAIL,
              to: [r.email],
              subject: r.title,
              text: r.body,
            }),
            signal: AbortSignal.timeout(10000),
          });
          success = res.ok;
        } catch {
          /* Retried from the durable outbox. */
        }
        await rpc("email_finish", { p_id: r.id, p_success: success });
        if (success) sent++;
      }
    }
    return ok({ expired, sent });
  } catch (e) {
    return failure(e);
  }
}
