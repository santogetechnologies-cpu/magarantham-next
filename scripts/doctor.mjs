import { createClient } from "@supabase/supabase-js";
let failed = false;
function check(name, pass) {
  console.log(`${pass ? "PASS" : "FAIL"} ${name}`);
  if (!pass) failed = true;
}
const env = process.env;
for (const name of [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  "NEXT_PUBLIC_SITE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
])
  check(`${name} is set`, Boolean(env[name] && !env[name].includes("YOUR_")));
check(
  "cron secret has at least 32 characters",
  Boolean(
    env.CRON_SECRET?.length >= 32 && !env.CRON_SECRET.startsWith("REPLACE"),
  ),
);
check(
  "server key is not assigned to any public variable",
  !Object.entries(env).some(
    ([k, v]) =>
      k.startsWith("NEXT_PUBLIC_") && v === env.SUPABASE_SERVICE_ROLE_KEY,
  ),
);
if (failed) process.exit(1);
const db = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);
const anon = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  { auth: { persistSession: false } },
);
const settings = await db
  .from("store_settings")
  .select("ordering_enabled,checkout_mode,online_method")
  .eq("id", true)
  .single();
check(
  "database migrations and service key",
  !settings.error && Boolean(settings.data),
);
const profiles = await anon.from("profiles").select("id");
check(
  "anonymous profiles are denied or empty",
  Boolean(profiles.error) || profiles.data?.length === 0,
);
const privateConfig = await anon.from("store_settings").select("*");
check("anonymous settings table is denied", Boolean(privateConfig.error));
const rpc = await anon.rpc("consume_rate_limit", {
  p_key: "doctor-forbidden",
  p_limit: 1,
  p_seconds: 1,
});
check("anonymous privileged RPC is denied", Boolean(rpc.error));
const bucket = await db.storage.getBucket("payment-proofs");
check(
  "proof bucket is private",
  !bucket.error && bucket.data?.public === false,
);
const media = await db.storage.getBucket("store-media");
check("media bucket exists", !media.error && media.data?.public === true);
if (env.NODE_ENV === "production") {
  check(
    "production site uses HTTPS",
    env.NEXT_PUBLIC_SITE_URL.startsWith("https://"),
  );
  check(
    "registration CAPTCHA configured",
    Boolean(env.TURNSTILE_SECRET_KEY && env.NEXT_PUBLIC_TURNSTILE_SITE_KEY),
  );
}
if (
  settings.data?.ordering_enabled &&
  settings.data.checkout_mode !== "whatsapp_only" &&
  settings.data.online_method === "razorpay_upi"
)
  check(
    "gateway keys and webhook secret configured",
    Boolean(
      env.RAZORPAY_KEY_ID &&
        env.RAZORPAY_KEY_SECRET &&
        env.RAZORPAY_WEBHOOK_SECRET,
    ),
  );
console.log(
  "Manual checks still required: public signup disabled, Before User Created hook enabled, email templates/SMTP, staff MFA, provider capture/refund and scheduler delivery.",
);
process.exitCode = failed ? 1 : 0;
