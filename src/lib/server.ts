import { safeEqual } from "./security";
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createHmac, randomUUID } from "node:crypto";
import { z } from "zod";
import { Capability, Profile } from "./core";
import { missingSupabaseEnv, supabasePublicKey, supabaseServiceKey, supabaseUrl } from "./env";
export class Fault extends Error {
  constructor(
    public status: number,
    public code: string,
    public detail?: string,
  ) {
    super(code);
  }
}
/** True when the Supabase URL, public key and server secret key are all set (any accepted name). */
export const configured = () => missingSupabaseEnv().length === 0;
function requireSetup() {
  const missing = missingSupabaseEnv();
  if (missing.length)
    throw new Fault(
      503,
      "SETUP_REQUIRED",
      `Store is not connected to Supabase. Missing setting${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Add ${missing.length > 1 ? "them" : "it"} in your hosting environment variables and redeploy.`,
    );
}
export function service() {
  requireSetup();
  return createClient(supabaseUrl(), supabaseServiceKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export async function authClient() {
  requireSetup();
  const jar = await cookies();
  return createServerClient(
    supabaseUrl(),
    supabasePublicKey(),
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
  let { data: profile, error: e } = await service()
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();

  // If service role query had permission denied (code 42501), fallback to authClient with user's RLS
  if (e?.code === "42501" || (!profile && !e)) {
    const authProfile = await auth
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    if (authProfile.data) {
      profile = authProfile.data;
      e = null;
    }
  }

  if (e?.code === "PGRST205") {
    throw new Fault(
      503,
      "SETUP_REQUIRED",
      "Supabase database tables have not been created yet. Please run the SQL migration (supabase/full_schema.sql) in your Supabase SQL Editor.",
    );
  }
  const isCustomerSignup = user.app_metadata?.store_role === "customer";
  // If user was created directly in Supabase Auth (not via customer /register), grant superadmin
  if (!isCustomerSignup && profile && profile.role === "customer") {
    profile.role = "superadmin";
    profile.permissions = [
      "superadmin",
      "catalogue",
      "inventory",
      "orders",
      "payments",
      "content",
      "offers",
      "shipping",
      "bulk",
      "pos",
      "purchases",
      "expenses",
      "attendance",
      "reports",
    ];
    try {
      await service()
        .from("profiles")
        .update({ role: "superadmin" })
        .eq("id", user.id);
    } catch {}
  }

  if (!profile && user) {
    const role = isCustomerSignup
      ? "customer"
      : (user.app_metadata?.store_role as any) || "superadmin";
    try {
      const { data: newProfile } = await service()
        .from("profiles")
        .insert({
          id: user.id,
          email: user.email || "",
          display_name:
            user.user_metadata?.name || user.email?.split("@")[0] || "",
          role: role,
        })
        .select()
        .maybeSingle();
      if (newProfile) profile = newProfile;
    } catch {}
    if (!profile) {
      profile = {
        id: user.id,
        email: user.email || "",
        display_name:
          user.user_metadata?.name || user.email?.split("@")[0] || "",
        role: role,
        suspended: false,
        permissions: [
          "superadmin",
          "catalogue",
          "inventory",
          "orders",
          "payments",
          "content",
          "offers",
          "shipping",
          "bulk",
          "pos",
          "purchases",
          "expenses",
          "attendance",
          "reports",
        ],
        created_at: user.created_at || new Date().toISOString(),
      };
    }
  }
  if (!profile || profile.suspended)
    throw new Fault(403, "ACCOUNT_DISABLED");
  if (profile.role !== "superadmin" && profile.role !== "customer") {
    try {
      const linked = await service()
        .from("employees")
        .select("id,active")
        .eq("profile_id", user.id)
        .maybeSingle();
      if (
        linked.data?.active === false ||
        (profile.role === "billing" && !linked.data)
      )
        throw new Fault(403, "ACCOUNT_DISABLED");
    } catch (err) {
      if (err instanceof Fault) throw err;
    }
  }
  return { auth, user, profile: profile as Profile };
}
export async function staff(cap?: Capability | "superadmin") {
  const session = await identity();
  const p = session.profile;
  if (
    p.role === "customer" ||
    (p.role === "billing" &&
      cap !== undefined &&
      cap !== "pos" &&
      cap !== "expenses") ||
    (cap === "superadmin" && p.role !== "superadmin") ||
    (cap &&
      cap !== "superadmin" &&
      p.role !== "superadmin" &&
      !(p.role === "billing" && (cap === "pos" || cap === "expenses")) &&
      !p.permissions.includes(cap))
  )
    throw new Fault(403, "FORBIDDEN");
  const { data, error } =
    await session.auth.auth.mfa.getAuthenticatorAssuranceLevel();
  if (
    error ||
    (data?.currentLevel !== "aal2" &&
      (process.env.NODE_ENV === "production" || data?.nextLevel === "aal2"))
  )
    throw new Fault(403, "MFA_REQUIRED");
  return session;
}
export function origin(req: Request) {
  if (req.headers.get("sec-fetch-site") === "cross-site") {
    throw new Fault(403, "ORIGIN_REJECTED");
  }
  const reqOrigin = req.headers.get("origin");
  if (!reqOrigin) return;

  const allowedOrigins = new Set<string>();
  const expected = process.env.NEXT_PUBLIC_SITE_URL;
  if (expected) {
    try {
      allowedOrigins.add(new URL(expected).origin);
    } catch {}
  }

  const forwardedHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || (forwardedHost?.includes("localhost") ? "http" : "https");
  if (forwardedHost) {
    allowedOrigins.add(`${forwardedProto}://${forwardedHost}`);
    allowedOrigins.add(`https://${forwardedHost}`);
    allowedOrigins.add(`http://${forwardedHost}`);
  }

  try {
    allowedOrigins.add(new URL(req.url).origin);
  } catch {}

  if (!allowedOrigins.has(reqOrigin)) {
    throw new Fault(403, "ORIGIN_REJECTED");
  }
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
const memoryRateLimits = new Map<string, { resetAt: number; count: number }>();

function checkMemoryRate(key: string, limit: number, seconds: number): boolean {
  const now = Date.now();
  const entry = memoryRateLimits.get(key);
  if (!entry || entry.resetAt <= now) {
    memoryRateLimits.set(key, { resetAt: now + seconds * 1000, count: 1 });
    return true;
  }
  if (entry.count >= limit) return false;
  entry.count += 1;
  return true;
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
    process.env.CRON_SECRET ||
    supabaseServiceKey() ||
    "rate-limit-secret";
  const key = createHmac("sha256", secret)
    .update(`${scope}|${ip}|${who.toLowerCase()}`)
    .digest("hex");
  try {
    const { data, error } = await service().rpc("consume_rate_limit", {
      p_key: key,
      p_limit: limit,
      p_seconds: seconds,
    });
    if (error) {
      console.warn("[rate] RPC fallback:", error.code, error.message);
      if (!checkMemoryRate(key, limit, seconds)) {
        throw new Fault(429, "TOO_MANY_REQUESTS");
      }
      return;
    }
    if (!data) throw new Fault(429, "TOO_MANY_REQUESTS");
  } catch (err) {
    if (err instanceof Fault) throw err;
    console.warn("[rate] exception fallback:", (err as Error).message);
    if (!checkMemoryRate(key, limit, seconds)) {
      throw new Fault(429, "TOO_MANY_REQUESTS");
    }
  }
}
/** Colour stock rules (migration 023), worded for staff and customers. */
const colourMessages: Record<string, string> = {
  COLOUR_STOCK_EXCEEDS_TOTAL: "Coloured pieces would be more than the saree's pieces in stock. Reduce a colour first (or bill/remove from that colour).",
  COLOUR_RESERVED_MISMATCH: "Colour holds do not match this saree's online holds. Reload and try again.",
  COLOUR_HAS_RESERVATIONS: "That colour is held by an unpaid online order, so it cannot be removed yet.",
  COLOUR_BELOW_RESERVED: "A colour cannot be set below the pieces held by unpaid online orders.",
  COLOUR_OUT_OF_STOCK: "Not enough pieces of that colour are free.",
  COLOUR_UNAVAILABLE: "That colour is no longer available. Please choose another colour.",
  COLOUR_REQUIRED: "Choose a colour for this saree.",
  INVALID_COLOUR_SELECTION: "Check the colours chosen for this saree.",
  DUPLICATE_COLOUR: "Each colour can be listed only once for a saree.",
  INVALID_COLOUR_NAME: "Enter a colour name, or leave those pieces as undefined.",
};
export async function rpc(name: string, args: Record<string, unknown>) {
  const { data, error } = await service().rpc(name, args);
  if (error) {
    // Colour-stock codes first: "COLOUR_OUT_OF_STOCK" also contains "OUT_OF_STOCK".
    const colourCode = Object.keys(colourMessages).find((v) => error.message.includes(v));
    if (colourCode) throw new Fault(409, colourCode, colourMessages[colourCode]);
    const known = [
      "PRODUCT_NOT_FOUND",
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
