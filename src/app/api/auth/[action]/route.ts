import { z } from "zod";
import {
  authClient,
  identity,
  staff,
  service,
  rpc,
  origin,
  json,
  rate,
  ok,
  failure,
  Fault,
  captcha,
} from "@/lib/server";
import { indiaDate } from "@/lib/barcode";
const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(6).max(128),
});

export async function GET(
  _req: Request,
  {
    params,
  }: {
    params: Promise<{
      action: string;
    }>;
  },
) {
  try {
    const { action } = await params;
    if (action === "providers") {
      let google = false;
      try {
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
        if (url && key) {
          const res = await fetch(`${url}/auth/v1/settings`, {
            headers: { apikey: key },
            cache: "no-store",
          });
          if (res.ok) {
            const settings = await res.json();
            google = Boolean(settings?.external?.google);
          }
        }
      } catch {}
      return ok({ google });
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
      action: string;
    }>;
  },
) {
  try {
    origin(req);
    const { action } = await params;
    const data = await json(req, 8000);
    const auth = await authClient();
    if (action === "login") {
      const p = credentials.parse(data);
      const email = p.email.trim().toLowerCase();
      await rate(req, "login", email, 10);
      const { error } = await auth.auth.signInWithPassword({
        email,
        password: p.password,
      });
      if (error) {
        const lower = (error.message || "").toLowerCase();
        const msg = lower.includes("email not confirmed")
          ? "Your email is not confirmed yet. Please check your inbox or contact support."
          : lower.includes("invalid login credentials")
            ? "Invalid email or password. Please check your credentials or create an account."
            : error.message || "Could not sign in. Please check your email and password.";
        throw new Fault(401, "LOGIN_FAILED", msg);
      }
      const session = await identity();
      if (session.profile.role !== "customer") {
        try {
          await service().from("audit_log").insert({
            actor_id: session.user.id,
            action: "staff.login",
            entity: "profiles",
            entity_id: session.user.id,
            details: {
              email: session.profile.email,
              name: session.profile.display_name,
              role: session.profile.role,
            },
          });
        } catch {}
      }
      return ok({
        redirect:
          session.profile.role === "customer"
            ? "/"
            : "/admin",
      });
    }
    if (action === "register") {
      const p = credentials
        .extend({
          name: z.string().trim().min(2).max(80),
          confirm_password: z.string().min(6).max(128).optional(),
          captcha_token: z.string().max(4000).default(""),
        })
        .strict()
        .parse(data);
      if (p.confirm_password !== undefined && p.confirm_password !== p.password) {
        throw new Fault(400, "PASSWORD_MISMATCH", "Password and Confirm Password do not match.");
      }
      const email = p.email.trim().toLowerCase();
      await rate(req, "registration", "", 10, 3600);
      await rate(req, "registration-email", email, 5, 3600);
      await captcha(p.captcha_token, req);
      const { error: createErr } = await service().auth.admin.createUser({
        email,
        password: p.password,
        email_confirm: true,
        app_metadata: { store_role: "customer" },
        user_metadata: { name: p.name },
      });
      if (createErr) {
        const msg = createErr.message?.toLowerCase().includes("already")
          ? "An account with this email already exists. Please log in instead."
          : createErr.message || "Could not create account. Please try again.";
        throw new Fault(400, "REGISTRATION_FAILED", msg);
      }
      const { error: signInErr } = await auth.auth.signInWithPassword({
        email,
        password: p.password,
      });
      if (signInErr) {
        return ok({
          message: "Account created successfully! Please log in with your email and password.",
          redirect: "/login",
        });
      }
      return ok({
        message: "Account created successfully!",
        redirect: "/",
      });
    }
    if (action === "resend") {
      const p = z.object({ email: z.email() }).strict().parse(data);
      await rate(req, "resend", p.email, 3, 3600);
      await auth.auth.resend({
        type: "signup",
        email: p.email,
        options: {
          emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
        },
      });
      return ok({
        message: "If confirmation is needed, an email has been sent.",
      });
    }
    if (action === "forgot") {
      const p = z.object({ email: z.email() }).strict().parse(data);
      await rate(req, "reset", p.email, 3, 3600);
      await auth.auth.resetPasswordForEmail(p.email, {
        redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback?next=/reset-password`,
      });
      return ok({
        message: "If the account exists, a reset email has been sent.",
      });
    }
    if (action === "logout") {
      try {
        const session = await identity();
        if (session.profile.role !== "customer") {
          await service().from("audit_log").insert({
            actor_id: session.user.id,
            action: "staff.logout",
            entity: "profiles",
            entity_id: session.user.id,
            details: {
              email: session.profile.email,
              name: session.profile.display_name,
              role: session.profile.role,
            },
          });
        }
      } catch {}
      await auth.auth.signOut({ scope: "local" });
      return ok({ redirect: "/" });
    }
    if (action === "password") {
      await identity();
      const p = z
        .object({ password: z.string().min(6).max(128) })
        .strict()
        .parse(data);
      const { error } = await auth.auth.updateUser(p);
      if (error) throw new Fault(400, "PASSWORD_UPDATE_FAILED");
      return ok({ message: "Password updated." });
    }
    if (action === "staff-password") {
      const session = await staff("superadmin");
      const p = z
        .object({
          user_id: z.string().uuid(),
          password: z.string().min(6).max(128),
        })
        .strict()
        .parse(data);
      const db = service();
      const { error } = await db.auth.admin.updateUserById(p.user_id, {
        password: p.password,
        email_confirm: true,
      });
      if (error) throw new Fault(400, "PASSWORD_UPDATE_FAILED", error.message);
      try {
        await db.from("audit_log").insert({
          actor_id: session.user.id,
          action: "staff.password_reset",
          entity: "profiles",
          entity_id: p.user_id,
          details: { updated_by: session.profile.email },
        });
      } catch {}
      return ok({ message: "Staff password updated successfully." });
    }
    if (action === "mfa-list") {
      await identity();
      const { data, error } = await auth.auth.mfa.listFactors();
      if (error) throw new Fault(400, "MFA_FAILED");
      return ok({ factors: data.totp });
    }
    if (action === "mfa-enroll") {
      const session = await identity();
      if (session.profile.role === "customer")
        throw new Fault(403, "STAFF_ONLY");
      await rate(req, "mfa-enroll", session.user.id, 5, 3600);
      const { data: factors } = await auth.auth.mfa.listFactors();
      if (factors?.totp.some((f) => f.status === "verified"))
        throw new Fault(409, "USE_EXISTING_FACTOR");
      for (const f of factors?.all || [])
        if (f.factor_type === "totp" && f.status === "unverified")
          await auth.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await auth.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: "Store authenticator",
      });
      if (error) throw new Fault(400, "MFA_FAILED");
      return ok({
        id: data.id,
        qr_code: data.totp.qr_code,
        secret: data.totp.secret,
      });
    }
    if (action === "mfa-verify") {
      const s = await identity();
      const p = z
        .object({ factor_id: z.uuid(), code: z.string().regex(/^\d{6}$/) })
        .strict()
        .parse(data);
      await rate(req, "mfa-check", s.user.id, 10);
      const { data: challenge, error } = await auth.auth.mfa.challenge({
        factorId: p.factor_id,
      });
      if (error) throw new Fault(400, "MFA_FAILED");
      const checked = await auth.auth.mfa.verify({
        factorId: p.factor_id,
        challengeId: challenge.id,
        code: p.code,
      });
      if (checked.error) throw new Fault(400, "MFA_CODE_INVALID");
      return ok({
        redirect: s.profile.role === "customer" ? "/account" : "/admin",
      });
    }
    if (action === "billing") {
      const actor = await staff("superadmin");
      const p = credentials
        .extend({
          name: z.string().trim().min(2).max(80),
          phone: z.string().trim().max(25).optional().default(""),
          password: z.string().min(6).max(128),
        })
        .strict()
        .parse(data);
      await rate(req, "billing-create", actor.user.id, 15, 3600);
      const db = service();

      const { data: policy } = await db
        .from("salary_policies")
        .select("id")
        .eq("active", true)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();

      const { data: u, error } = await db.auth.admin.createUser({
        email: p.email,
        password: p.password,
        email_confirm: true,
        app_metadata: { store_role: "billing" },
        user_metadata: { name: p.name },
      });
      if (error || !u.user) {
        throw new Fault(
          409,
          "ACCOUNT_CREATE_FAILED",
          error?.message || "Could not create billing user. This email may already be registered.",
        );
      }

      try {
        if (policy?.id) {
          const empCode = `BILL-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
          const empId = await rpc("save_employee", {
            p_actor: actor.user.id,
            p_id: null,
            p_data: {
              code: empCode,
              name: p.name,
              phone: p.phone,
              employment: "full_time",
              pay_basis: "monthly",
              rate_paise: 0,
              scheduled_units: 26,
              overtime_rate_paise: 0,
              daily_minutes: 480,
              policy_id: policy.id,
              joined_on: indiaDate(),
              ended_on: null,
              allowances: [],
              deductions: [],
              active: true,
            },
          });
          await rpc("employee_link", {
            p_actor: actor.user.id,
            p_employee: empId,
            p_profile: u.user.id,
          });
        }
      } catch (linkErr) {
        await db.auth.admin.deleteUser(u.user.id);
        throw linkErr;
      }

      await db.from("audit_log").insert({
        actor_id: actor.user.id,
        action: "billing.created",
        entity: "profiles",
        entity_id: u.user.id,
        details: { email: p.email, name: p.name },
      });

      return ok({
        message:
          "Billing user created and ready to log in for POS Billing.",
      });
    }
    if (action === "staff-password") {
      const actor = await staff("superadmin");
      const p = z
        .object({
          user_id: z.uuid(),
          password: z.string().min(6).max(128),
        })
        .strict()
        .parse(data);
      await rate(req, "staff-password", actor.user.id, 20, 3600);
      const db = service();
      const { data: target, error: tErr } = await db
        .from("profiles")
        .select("id,email,role,display_name")
        .eq("id", p.user_id)
        .single();
      if (tErr || !target) throw new Fault(404, "NOT_FOUND");
      if (target.role === "superadmin" && target.id !== actor.user.id) {
        throw new Fault(403, "FORBIDDEN", "Cannot reset another Super Administrator password.");
      }
      const { error: uErr } = await db.auth.admin.updateUserById(p.user_id, {
        password: p.password,
        email_confirm: true,
      });
      if (uErr) {
        throw new Fault(400, "PASSWORD_UPDATE_FAILED", uErr.message || "Could not update password.");
      }
      try {
        await db.from("audit_log").insert({
          actor_id: actor.user.id,
          action: "staff.password_reset",
          entity: "profiles",
          entity_id: p.user_id,
          details: { email: target.email },
        });
      } catch {}
      return ok({
        message: `Password updated for ${target.display_name || target.email}.`,
      });
    }
    if (action === "manager") {
      const actor = await staff("superadmin");
      const p = credentials
        .extend({ name: z.string().trim().min(2).max(80) })
        .strict()
        .parse(data);
      await rate(req, "manager-create", actor.user.id, 10, 3600);
      const { data: u, error } = await service().auth.admin.createUser({
        email: p.email,
        password: p.password,
        email_confirm: true,
        app_metadata: { store_role: "manager" },
        user_metadata: { name: p.name },
      });
      if (error) throw new Fault(409, "ACCOUNT_CREATE_FAILED");
      await auth.auth.resend({
        type: "signup",
        email: p.email,
        options: {
          emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
        },
      });
      await service()
        .from("audit_log")
        .insert({
          actor_id: actor.user.id,
          action: "manager.created",
          entity: "profiles",
          entity_id: u.user.id,
        });
      return ok({
        message:
          "Manager created. Confirmation email requested; share the temporary password securely and ask them to change it.",
      });
    }
    throw new Fault(404, "NOT_FOUND");
  } catch (e) {
    return failure(e);
  }
}
