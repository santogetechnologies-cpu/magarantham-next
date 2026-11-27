/**
 * Supabase settings, accepting both this project's names and the names the
 * Vercel ↔ Supabase integration creates. NEXT_PUBLIC_* values are written out
 * literally so Next.js can inline them into browser/edge bundles at build time.
 */
const clean = (v: string | undefined) => {
  const s = (v || "").trim();
  return s && !s.includes("YOUR_") ? s : "";
};

export const supabaseUrl = () =>
  clean(process.env.NEXT_PUBLIC_SUPABASE_URL) || clean(process.env.SUPABASE_URL);

/** Public (anon / publishable) key: safe for browsers. */
export const supabasePublicKey = () =>
  clean(process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) ||
  clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) ||
  clean(process.env.SUPABASE_PUBLISHABLE_KEY) ||
  clean(process.env.SUPABASE_ANON_KEY);

/** Server-only secret key. Never exposed to the browser. */
export const supabaseServiceKey = () =>
  clean(process.env.SUPABASE_SERVICE_ROLE_KEY) || clean(process.env.SUPABASE_SECRET_KEY);

/** Names of the settings that are missing, for a clear setup message. */
export function missingSupabaseEnv(): string[] {
  const missing: string[] = [];
  if (!supabaseUrl()) missing.push("NEXT_PUBLIC_SUPABASE_URL");
  if (!supabasePublicKey()) missing.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)");
  if (!supabaseServiceKey()) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  return missing;
}
