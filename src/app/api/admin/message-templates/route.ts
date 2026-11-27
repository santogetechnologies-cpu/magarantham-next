import { z } from "zod";
import { staff, service, origin, json, rate, ok, failure, Fault } from "@/lib/server";
import { DEFAULT_TEMPLATES, MESSAGE_TEMPLATE_KEYS } from "@/lib/message-templates";

/** Read: any staff who bills or handles orders. Edit: superadmin only. */
export async function GET() {
  try {
    await staff();
    const { data } = await service().from("message_templates").select("key,body,enabled");
    const rows = MESSAGE_TEMPLATE_KEYS.map((key) => {
      const r = (data || []).find((x) => x.key === key);
      return { key, body: r?.body || DEFAULT_TEMPLATES[key], enabled: r ? Boolean(r.enabled) : true };
    });
    return ok({ rows });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    origin(req);
    const s = await staff("superadmin");
    await rate(req, "admin-write", s.user.id, 60);
    const p = z
      .object({ key: z.enum(MESSAGE_TEMPLATE_KEYS), body: z.string().trim().min(1).max(2000), enabled: z.boolean().default(true) })
      .strict()
      .parse(await json(req));
    const { error } = await service()
      .from("message_templates")
      .upsert({ key: p.key, body: p.body, enabled: p.enabled, updated_by: s.user.id, updated_at: new Date().toISOString() });
    if (error) throw new Fault(503, "SAVE_FAILED", "Apply migration 202611270023_colour_stock.sql to store message templates.");
    await service().from("audit_log").insert({ actor_id: s.user.id, action: "template.saved", entity: "message_templates", entity_id: p.key, details: { enabled: p.enabled } });
    return ok({ message: "Message saved." });
  } catch (e) {
    return failure(e);
  }
}
