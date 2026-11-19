import { z } from "zod";
import { failure, ok, service, staff } from "@/lib/server";
import { indiaDate } from "@/lib/barcode";

function toIstDate(iso?: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

export async function GET(req: Request) {
  try {
    await staff("superadmin");
    const url = new URL(req.url);
    const dateParam = url.searchParams.get("date") || indiaDate();
    const selectedDate = z.iso.date().parse(dateParam);

    // IST day boundaries in UTC (IST = UTC+05:30)
    const dayStartUtc = new Date(`${selectedDate}T00:00:00+05:30`).toISOString();
    const dayEndUtc = new Date(`${selectedDate}T23:59:59.999+05:30`).toISOString();

    const db = service();
    const [profilesRes, authRes, empRes, auditRes, salesRes] = await Promise.all([
      db
        .from("profiles")
        .select("id,email,display_name,role,suspended,created_at")
        .in("role", ["superadmin", "manager", "billing"])
        .order("created_at", { ascending: false }),
      db.auth.admin.listUsers({ perPage: 200 }).catch(() => ({ data: { users: [] } })),
      db.from("employees").select("id,code,name,phone,active,profile_id"),
      db
        .from("audit_log")
        .select("id,actor_id,action,details,created_at")
        .in("action", ["staff.login", "staff.logout"])
        .gte("created_at", dayStartUtc)
        .lte("created_at", dayEndUtc)
        .order("created_at", { ascending: false }),
      db
        .from("pos_sales")
        .select("id,cashier_id,total_paise,status,created_at")
        .gte("created_at", dayStartUtc)
        .lte("created_at", dayEndUtc),
    ]);

    const profiles = profilesRes.data || [];
    const authMap = new Map(
      (authRes?.data?.users || []).map((u) => [u.id, u]),
    );
    const empByProfile = new Map(
      (empRes.data || [])
        .filter((e) => e.profile_id)
        .map((e) => [e.profile_id, e]),
    );

    const salesByCashier = new Map<string, { bills: number; total_paise: number }>();
    for (const sale of salesRes.data || []) {
      if (!sale.cashier_id || sale.status === "returned") continue;
      const cur = salesByCashier.get(sale.cashier_id) || { bills: 0, total_paise: 0 };
      cur.bills += 1;
      cur.total_paise += Number(sale.total_paise || 0);
      salesByCashier.set(sale.cashier_id, cur);
    }

    const auditEvents = auditRes.data || [];
    const loginsByUser = new Map<string, string[]>();
    const logoutsByUser = new Map<string, string[]>();

    for (const ev of auditEvents) {
      if (!ev.actor_id) continue;
      if (ev.action === "staff.login") {
        const list = loginsByUser.get(ev.actor_id) || [];
        list.push(ev.created_at);
        loginsByUser.set(ev.actor_id, list);
      } else if (ev.action === "staff.logout") {
        const list = logoutsByUser.get(ev.actor_id) || [];
        list.push(ev.created_at);
        logoutsByUser.set(ev.actor_id, list);
      }
    }

    const loggedInStaff: Record<string, unknown>[] = [];
    const notLoggedInStaff: Record<string, unknown>[] = [];

    for (const p of profiles) {
      const au = authMap.get(p.id);
      const emp = empByProfile.get(p.id);
      const sales = salesByCashier.get(p.id) || { bills: 0, total_paise: 0 };

      const userLogins = [...(loginsByUser.get(p.id) || [])];
      const userLogouts = [...(logoutsByUser.get(p.id) || [])];

      // Include Auth's last_sign_in_at if it happened on selectedDate and wasn't already logged in audit_log
      const authLastSignIn = au?.last_sign_in_at || null;
      if (
        authLastSignIn &&
        toIstDate(authLastSignIn) === selectedDate &&
        userLogins.length === 0
      ) {
        userLogins.push(authLastSignIn);
      }

      userLogins.sort();
      userLogouts.sort();

      const firstLoginAt = userLogins[0] || null;
      const lastLoginAt = userLogins[userLogins.length - 1] || null;
      const lastLogoutAt = userLogouts[userLogouts.length - 1] || null;

      const isCurrentlyIn =
        Boolean(lastLoginAt) &&
        (!lastLogoutAt || new Date(lastLoginAt!) >= new Date(lastLogoutAt));

      const row = {
        id: p.id,
        name: emp?.name || p.display_name || p.email,
        email: p.email,
        role: p.role,
        code: emp?.code || null,
        phone: emp?.phone || null,
        suspended: Boolean(p.suspended),
        login_count: userLogins.length,
        first_login_at: firstLoginAt,
        last_login_at: lastLoginAt,
        last_logout_at: lastLogoutAt,
        currently_active: isCurrentlyIn,
        pos_bills_today: sales.bills,
        pos_sales_paise_today: sales.total_paise,
        last_seen_ever: authLastSignIn,
      };

      if (userLogins.length > 0) {
        loggedInStaff.push(row);
      } else {
        notLoggedInStaff.push(row);
      }
    }

    loggedInStaff.sort((a, b) =>
      String(b.last_login_at || "").localeCompare(String(a.last_login_at || "")),
    );

    // Build chronological login/logout timeline for the selected date
    const profileMap = new Map(profiles.map((p) => [p.id, p]));
    const timeline: Record<string, unknown>[] = auditEvents.map((ev) => {
      const p = ev.actor_id ? profileMap.get(ev.actor_id) : null;
      const emp = ev.actor_id ? empByProfile.get(ev.actor_id) : null;
      return {
        id: ev.id,
        action: ev.action,
        at: ev.created_at,
        name: emp?.name || p?.display_name || (ev.details as any)?.name || "Staff",
        email: p?.email || (ev.details as any)?.email || "",
        role: p?.role || (ev.details as any)?.role || "staff",
        code: emp?.code || null,
      };
    });

    // Add fallback auth sign-in events for staff who signed in today before audit logging started
    for (const s of loggedInStaff) {
      const sid = String(s.id);
      if (!(loginsByUser.get(sid)?.length) && s.last_login_at) {
        timeline.push({
          id: `auth-${sid}`,
          action: "staff.login",
          at: s.last_login_at,
          name: s.name,
          email: s.email,
          role: s.role,
          code: s.code,
        });
      }
    }
    timeline.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));

    const totalBillsToday = Array.from(salesByCashier.values()).reduce(
      (sum, x) => sum + x.bills,
      0,
    );
    const totalSalesPaiseToday = Array.from(salesByCashier.values()).reduce(
      (sum, x) => sum + x.total_paise,
      0,
    );

    return ok({
      date: selectedDate,
      loggedInStaff,
      notLoggedInStaff,
      events: timeline,
      summary: {
        logged_in_count: loggedInStaff.length,
        not_logged_in_count: notLoggedInStaff.length,
        total_staff_accounts: profiles.length,
        total_bills_today: totalBillsToday,
        total_sales_paise_today: totalSalesPaiseToday,
      },
    });
  } catch (e) {
    return failure(e);
  }
}
