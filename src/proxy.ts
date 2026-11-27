import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabasePublicKey, supabaseUrl } from "./lib/env";
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const url = supabaseUrl(), key = supabasePublicKey();
  if (!url || !key) return response;

  // Fast path: if there are no Supabase auth cookies, skip remote network call in middleware
  const hasAuthCookies = request.cookies
    .getAll()
    .some((c) => c.name.startsWith("sb-") && c.name.includes("-auth-token"));
  if (!hasAuthCookies) {
    return response;
  }

  const supabase = createServerClient(
    url,
    key,
    {
      cookieOptions: {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (items) => {
          for (const i of items) request.cookies.set(i.name, i.value);
          response = NextResponse.next({ request });
          for (const i of items)
            response.cookies.set(i.name, i.value, i.options);
        },
      },
    },
  );
  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: [
    "/account/:path*",
    "/admin/:path*",
    "/api/:path*",
    "/mfa",
    "/reset-password",
  ],
};
