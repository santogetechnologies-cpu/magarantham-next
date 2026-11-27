import { createBrowserClient } from "@supabase/ssr";
import { supabasePublicKey, supabaseUrl } from "./env";

export function createSupabaseBrowserClient() {
  const url = supabaseUrl();
  const key = supabasePublicKey();
  if (!url || !key) return null;
  return createBrowserClient(url, key);
}
