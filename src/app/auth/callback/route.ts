import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { authClient } from "@/lib/server";
import { safeReturn } from "@/lib/core";
export async function GET(req: Request) {
  const u = new URL(req.url);
  const base = process.env.NEXT_PUBLIC_SITE_URL || u.origin;
  try {
    const auth = await authClient();
    let error: unknown;
    const code = u.searchParams.get("code"),
      hash = u.searchParams.get("token_hash"),
      type = u.searchParams.get("type");
    if (code) ({ error } = await auth.auth.exchangeCodeForSession(code));
    else if (
      hash &&
      ["signup", "recovery", "email", "invite"].includes(type || "")
    )
      ({ error } = await auth.auth.verifyOtp({
        token_hash: hash,
        type: type as EmailOtpType,
      }));
    else error = true;
    if (error)
      return NextResponse.redirect(new URL("/login?error=confirmation", base));
    return NextResponse.redirect(
      new URL(safeReturn(u.searchParams.get("next")), base),
    );
  } catch {
    return NextResponse.redirect(new URL("/login?error=setup", base));
  }
}
