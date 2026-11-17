import { z } from "zod";
import {
  authClient,
  identity,
  staff,
  service,
  origin,
  json,
  rate,
  ok,
  failure,
  Fault,
  captcha,
} from "@/lib/server";
const credentials = z.object({
  email: z.email().max(254),
  password: z.string().min(12).max(128),
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
    if (action === "login") {
      const p = credentials.parse(data);
      await rate(req, "login", p.email, 10);
      const { error } = await auth.auth.signInWithPassword(p);
      if (error)
        throw new Fault(
          401,
          "LOGIN_FAILED",
          "Check your email, password and email confirmation.",
        );
      const session = await identity();
      return ok({
        redirect: session.profile.role === "customer" ? "/account" : "/mfa",
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
      await auth.auth.signOut({ scope: "local" });
      return ok({ redirect: "/" });
    }
    if (action === "password") {
      await identity();
      const p = z
        .object({ password: z.string().min(12).max(128) })
        .strict()
        .parse(data);
      const { error } = await auth.auth.updateUser(p);
      if (error) throw new Fault(400, "PASSWORD_UPDATE_FAILED");
      return ok({ message: "Password updated." });
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
        email_confirm: false,
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
