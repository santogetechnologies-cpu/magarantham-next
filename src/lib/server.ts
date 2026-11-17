import { safeEqual } from "./security";
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { Capability, Profile } from "./core";
export class Fault extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
  ) {
    super(code);
  }
}
export const configured = () =>
  Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
      process.env.SUPABASE_SERVICE_ROLE_KEY &&
      !process.env.NEXT_PUBLIC_SUPABASE_URL.includes("YOUR_"),
  );
export function service() {
  if (!configured()) throw new Fault(503, "SETUP_REQUIRED");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
export async function authClient() {
  if (!configured()) throw new Fault(503, "SETUP_REQUIRED");
  const jar = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        getAll: () => jar.getAll(),
        setAll: (items) => {
          for (const i of items) {
            try {
              jar.set(i.name, i.value, i.options);
            } catch {
              /* Server components cannot refresh cookies. Routes/proxy can. */
            }
          }
        },
      },
    },
  );
}
export async function identity() {
  const auth = await authClient();
  const {
    data: { user },
    error,
  } = await auth.auth.getUser();
  if (error || !user) throw new Fault(401, "LOGIN_REQUIRED");
  const { data: profile, error: e } = await service()
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();
  if (e || !profile || profile.suspended)
    throw new Fault(403, "ACCOUNT_DISABLED");
  if (profile.role !== 'superadmin' && profile.role !== 'customer') {
    const linked=await service().from('employees').select('id,active').eq('profile_id',user.id).maybeSingle();
    if (linked.error || linked.data?.active===false || (profile.role==='billing'&&!linked.data)) throw new Fault(403,'ACCOUNT_DISABLED');
  }
  return { auth, user, profile: profile as Profile };
}
export async function staff(cap?: Capability | "superadmin") {
  const session = await identity();
  const p = session.profile;
  if (
    p.role === "customer" ||
    (p.role === 'billing' && cap !== undefined && cap !== 'pos') ||
    (cap === "superadmin" && p.role !== "superadmin") ||
    (cap &&
      cap !== "superadmin" &&
      p.role !== "superadmin" &&
      !p.permissions.includes(cap))
  )
    throw new Fault(403, "FORBIDDEN");
  const { data, error } =
    await session.auth.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error || data?.currentLevel !== "aal2")
    throw new Fault(403, "MFA_REQUIRED");
  return session;
}
export function origin(req: Request) {
  const expected = process.env.NEXT_PUBLIC_SITE_URL;
  if (!expected) throw new Fault(503, "SITE_URL_REQUIRED");
  if (req.headers.get("origin") !== new URL(expected).origin)
    throw new Fault(403, "ORIGIN_REJECTED");
  if (req.headers.get("sec-fetch-site") === "cross-site")
    throw new Fault(403, "ORIGIN_REJECTED");
}
export async function json(req: Request, max = 40000) {
  if (!req.headers.get("content-type")?.startsWith("application/json"))
    throw new Fault(415, "JSON_REQUIRED");
  return JSON.parse(await readBody(req, max));
}
export async function readBody(req: Request, max: number) {
  if (Number(req.headers.get("content-length") || 0) > max)
    throw new Fault(413, "BODY_TOO_LARGE");
  const reader = req.body?.getReader();
  if (!reader) return "";
  let size = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > max) {
      await reader.cancel();
      throw new Fault(413, "BODY_TOO_LARGE");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
export async function rate(
  req: Request,
  scope: string,
  who = "",
  limit = 30,
  seconds = 300,
) {
  const header = process.env.TRUSTED_IP_HEADER;
  const ip = header ? req.headers.get(header) || "unknown" : "shared";
  const secret =
    process.env.CRON_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const key = createHmac("sha256", secret)
    .update(`${scope}|${ip}|${who.toLowerCase()}`)
    .digest("hex");
  const { data, error } = await service().rpc("consume_rate_limit", {
    p_key: key,
    p_limit: limit,
    p_seconds: seconds,
  });
  if (error) throw new Fault(503, "RATE_CHECK_UNAVAILABLE");
  if (!data) throw new Fault(429, "TOO_MANY_REQUESTS");
}
export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service().rpc(name, args);
  if (error) {
    const known = [
      "POS_DISABLED","INVALID_TENDER","BANK_CHECK_REQUIRED","TENDER_MISMATCH","DISCOUNT_LIMIT","DISCOUNT_REASON_REQUIRED","UNIT_UNAVAILABLE","BARCODE_QUANTITY_MISMATCH","BARCODE_ALREADY_USED","RESERVED_BARCODE_PREFIX","UNIT_STOCK_MISMATCH","SUBCATEGORY_REQUIRED","INVALID_CATEGORY_PARENT","SUBCATEGORY_IN_USE","INVALID_DISCOUNT_TARGET","SUPPLIER_UNAVAILABLE","PURCHASE_LOCKED","PURCHASE_NOT_ORDERED","INVALID_PURCHASE_LINES","OVER_RECEIPT","RETURN_EXCEEDS_STOCK","PURCHASE_UNITS_UNAVAILABLE","PAYMENT_DETAILS_REQUIRED","PAYMENT_EXCEEDS_BALANCE","EXPENSE_LOCKED","INVALID_SALARY_DIVISOR","PAYROLL_LOCKED","PAYROLL_STALE","PAYROLL_MONTH_NOT_CLOSED","MISSING_ATTENDANCE","INVALID_ATTENDANCE_DATE","INVALID_ATTENDANCE_UNITS","INVALID_LEAVE_TIERS","INVALID_WORK_WEEK","NO_EMPLOYMENT_IN_PERIOD","SALARY_POLICY_REQUIRED","INVALID_NET_PAY","PAYROLL_PAYMENT_REQUIRED","INVALID_EMPLOYMENT","LOGIN_ALREADY_LINKED","INVALID_EMPLOYEE_LOGIN","PRINT_STOCK_CHANGED","REPORT_DATE_RANGE","RETURN_DETAILS_REQUIRED",
      "FORBIDDEN",
      "ACCOUNT_DISABLED",
      "ORDERING_DISABLED",
      "CHANNEL_DISABLED",
      "INVALID_CART",
      "INVALID_ADDRESS",
      "IDEMPOTENCY_CONFLICT",
      "TOO_MANY_PENDING_ORDERS",
      "INVALID_QUANTITY",
      "DUPLICATE_ITEM",
      "INVALID_COUPON",
      "COUPON_NOT_ELIGIBLE",
      "PRODUCT_UNAVAILABLE",
      "PRICE_NOT_SET",
      "OUT_OF_STOCK",
      "INVALID_ORDER_TOTAL",
      "PAYMENT_MISMATCH",
      "PAYMENT_METHOD_MISMATCH",
      "PAYMENT_REFERENCE_REQUIRED",
      "STOCK_BELOW_RESERVED",
      "INVALID_STATUS_CHANGE",
      "PROOF_NOT_ALLOWED",
      "REFUND_NOT_ALLOWED",
      "LAST_SUPERADMIN",
      "INVALID_TRACKING",
    ];
    throw new Fault(
      409,
      known.find((v) => error.message.includes(v)) || "CHANGE_FAILED",
    );
  }
  return data;
}
export const ok = (data: unknown, status = 200) =>
  NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
export function failure(error: unknown) {
  if (error instanceof z.ZodError)
    return ok(
      {
        error: "CHECK_FIELDS",
        message: error.issues
          .map((v) => `${v.path.join(".")}: ${v.message}`)
          .join("; "),
      },
      400,
    );
  if (error instanceof Fault)
    return ok(
      {
        error: error.code,
        message: error.detail || error.code.replaceAll("_", " ").toLowerCase(),
      },
      error.status,
    );
  if (error instanceof SyntaxError)
    return ok(
      { error: "INVALID_JSON", message: "Check the submitted details." },
      400,
    );
  const reference = randomUUID();
  console.error("Request failed", reference);
  return ok(
    {
      error: "REQUEST_FAILED",
      message: "The request could not be completed.",
      reference,
    },
    500,
  );
}
export async function protectedSecret(req: Request, env: string) {
  const expected = process.env[env];
  if (
    !expected ||
    expected.length < 32 ||
    !safeEqual(req.headers.get("authorization") || "", `Bearer ${expected}`)
  )
    throw new Fault(401, "UNAUTHORIZED");
}
export async function captcha(token: string, req: Request) {
  if (!process.env.TURNSTILE_SECRET_KEY) {
    if (process.env.NODE_ENV === "production")
      throw new Fault(503, "CAPTCHA_REQUIRED");
    return;
  }
  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    {
      method: "POST",
      body: new URLSearchParams({
        secret: process.env.TURNSTILE_SECRET_KEY,
        response: token,
      }),
      signal: AbortSignal.timeout(10000),
    },
  );
  const result = await response.json();
  if (
    !result.success ||
    result.hostname !== new URL(process.env.NEXT_PUBLIC_SITE_URL!).hostname ||
    result.action !== "register"
  )
    throw new Fault(400, "CAPTCHA_FAILED");
}
export async function razor(path: string, body?: unknown) {
  const key = process.env.RAZORPAY_KEY_ID,
    secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) throw new Fault(503, "GATEWAY_NOT_CONFIGURED");
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${key}:${secret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15000),
    cache: "no-store",
  });
  if (!res.ok) throw new Fault(502, "GATEWAY_REQUEST_FAILED");
  return res.json();
}
