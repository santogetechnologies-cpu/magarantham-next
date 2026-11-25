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
import { normalizePhone, isValidE164, formatPhoneForDisplay } from "@/lib/phone";
const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(6).max(128),
});
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
    if (action === "phone-send-otp") {
      const p = z
        .object({
          phone: z.string().min(5).max(30),
          dial_code: z.string().max(10).default("+91"),
        })
        .strict()
        .parse(data);
      const normalized = normalizePhone(p.phone, p.dial_code);
      if (!isValidE164(normalized)) {
        throw new Fault(400, "INVALID_PHONE", "Please enter a valid mobile number with country code.");
      }
      await rate(req, "phone-otp-send", normalized, 4, 600);
      await rate(req, "phone-otp-ip", "", 25, 3600);
      const { error } = await auth.auth.signInWithOtp({
        phone: normalized,
        options: { channel: "sms" },
      });
      if (error) {
        const msg = error.message?.toLowerCase().includes("sms provider")
          ? "SMS service is initializing. Please verify Supabase Phone provider in project dashboard."
          : error.message || "Could not send OTP. Please check the mobile number and try again.";
        throw new Fault(400, "OTP_SEND_FAILED", msg);
      }
      return ok({
        message: `OTP sent to ${formatPhoneForDisplay(normalized)}.`,
        phone: normalized,
        expires_in: 60,
      });
    }
    if (action === "phone-verify-otp") {
      const p = z
        .object({
          phone: z.string().min(5).max(30),
          token: z.string().regex(/^\d{6}$/),
          dial_code: z.string().max(10).default("+91"),
          name: z.string().max(80).optional(),
        })
        .strict()
        .parse(data);
      const normalized = normalizePhone(p.phone, p.dial_code);
      await rate(req, "phone-otp-verify", normalized, 6, 900);
      const { data: verifiedData, error: verifyErr } = await auth.auth.verifyOtp({
        phone: normalized,
        token: p.token,
        type: "sms",
      });
      if (verifyErr || !verifiedData.user) {
        throw new Fault(400, "INVALID_OTP", verifyErr?.message || "Invalid or expired 6-digit OTP code.");
      }
      const userId = verifiedData.user.id;
      const db = service();

      // Ensure customer role in profiles (never admin permissions)
      let { data: profile } = await db
        .from("profiles")
        .select("id,role,email,display_name,phone")
        .eq("id", userId)
        .maybeSingle();

      if (!profile) {
        const displayName = p.name?.trim() || verifiedData.user.user_metadata?.name || "Customer";
        await db.from("profiles").insert({
          id: userId,
          email: verifiedData.user.email || "",
          display_name: displayName,
          role: "customer",
          phone: normalized,
          phone_confirmed_at: new Date().toISOString(),
        });
      } else {
        await db
          .from("profiles")
          .update({
            phone: normalized,
            phone_confirmed_at: new Date().toISOString(),
          })
          .eq("id", userId);
      }

      // Safe account linking: preserve existing orders placed with this verified phone
      try {
        await db
          .from("orders")
          .update({ customer_phone: normalized })
          .eq("customer_id", userId);
      } catch {}

      return ok({
        message: "Mobile number verified successfully.",
        redirect: "/account",
        user: {
          id: userId,
          phone: normalized,
          role: profile?.role || "customer",
        },
      });
    }
    if (action === "login") {
      const p = credentials.parse(data);
      await rate(req, "login", p.email, 10);
      const { error } = await auth.auth.signInWithPassword(p);
      if (error) {
        const msg =
          error.message?.toLowerCase().includes("email not confirmed")
            ? "Your email is not confirmed yet. In Supabase Dashboard, please check 'Auto Confirm User' or confirm your email."
            : error.message || "Check your email, password and email confirmation.";
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
            ? "/account"
            : "/admin",
      });
    }
    if (action === "register") {
      const p = credentials
        .extend({
          name: z.string().trim().min(2).max(80),
          captcha_token: z.string().max(4000).default(""),
        })
        .strict()
        .parse(data);
      await rate(req, "registration", "", 10, 3600);
      await rate(req, "registration-email", p.email, 3, 3600);
      await captcha(p.captcha_token, req);
      const { error } = await service().auth.admin.createUser({
        email: p.email,
        password: p.password,
        email_confirm: false,
        app_metadata: { store_role: "customer" },
        user_metadata: { name: p.name },
      });
      if (!error)
        await auth.auth.resend({
          type: "signup",
          email: p.email,
          options: {
            emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/auth/callback`,
          },
        });
      return ok({
        message:
          "If this address can be registered, a confirmation email has been sent. Check your inbox before signing in.",
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
