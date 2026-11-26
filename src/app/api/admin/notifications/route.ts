import { z } from "zod";
import { staff, service, origin, json, ok, failure, Fault } from "@/lib/server";
import { uuid } from "@/lib/schemas";

export async function GET() {
  try {
    await staff("orders");
    const db = service();
    const { data, error } = await db
      .from("admin_notifications")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);

    if (error) {
      return ok({ notifications: [], unreadCount: 0 });
    }

    const notifications = data || [];
    const unreadCount = notifications.filter((n) => !n.is_read).length;
    return ok({ notifications, unreadCount });
  } catch (e) {
    return failure(e);
  }
}

export async function POST(req: Request) {
  try {
    origin(req);
    await staff("orders");
    const body = z
      .object({
        id: uuid.optional(),
        markAllRead: z.boolean().optional(),
      })
      .strict()
      .parse(await json(req));

    const db = service();
    if (body.markAllRead) {
      await db
        .from("admin_notifications")
        .update({ is_read: true })
        .eq("is_read", false);
      return ok({ updated: true });
    }

    if (body.id) {
      await db
        .from("admin_notifications")
        .update({ is_read: true })
        .eq("id", body.id);
      return ok({ updated: true });
    }

    throw new Fault(400, "INVALID_REQUEST");
  } catch (e) {
    return failure(e);
  }
}
