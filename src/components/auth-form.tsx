"use client";
import { FormEvent, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Script from "next/script";
import { api } from "./api";
declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, options: Record<string, unknown>) => string;
      reset: (id: string) => void;
      remove: (id: string) => void;
    };
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
    };
  }
}
export function AuthForm({ mode }: { mode: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [token, setToken] = useState("");
  const captchaRef = useRef<HTMLDivElement>(null),
    widget = useRef("");
  const title =
    mode === "register"
      ? "Create your account."
      : mode === "forgot-password"
        ? "Reset your password."
        : mode === "reset-password"
          ? "Choose a new password."
          : "Welcome back.";
  function mountCaptcha() {
    if (captchaRef.current && window.turnstile && !widget.current)
      widget.current = window.turnstile.render(captchaRef.current, {
        sitekey: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
        action: "register",
        callback: (value: string) => setToken(value),
        "expired-callback": () => setToken(""),
      });
  }
  useEffect(() => {
    mountCaptcha();
    return () => {
      if (widget.current) window.turnstile?.remove(widget.current);
    };
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setMessage("");
    const f = new FormData(e.currentTarget);
    const action =
      mode === "register"
        ? "register"
        : mode === "forgot-password"
          ? "forgot"
          : mode === "reset-password"
            ? "password"
            : "login";
    const payload =
      action === "password"
        ? { password: f.get("password") }
        : action === "forgot"
          ? { email: f.get("email") }
          : action === "register"
            ? {
                email: f.get("email"),
                password: f.get("password"),
                name: f.get("name"),
                captcha_token: token,
              }
            : { email: f.get("email"), password: f.get("password") };
    try {
      const r = await api<{
        message?: string;
        redirect?: string;
      }>(`/api/auth/${action}`, payload);
      if (r.redirect) window.location.assign(r.redirect);
      else setMessage(r.message || "Done.");
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      setBusy(false);
      if (widget.current) {
        window.turnstile?.reset(widget.current);
        setToken("");
      }
    }
  }
  return (
    <section className="section auth-layout">
      <div className="auth-photo">
        <img src="/assets/product-02.jpg" alt="Gold soft silk saree" />
        <div>
          <span className="eyebrow">மகரந்தம் சில்க்ஸ்</span>
          <h2>
            A little silk.
            <br />A lot of joy.
          </h2>
        </div>
      </div>
      <div className="auth-copy">
        <p className="eyebrow">Your sarees. Your account.</p>
        <h1>{title}</h1>
        <form className="form-panel" onSubmit={submit}>
          {mode === "register" && (
            <label>
              Your name
              <input name="name" autoComplete="name" required maxLength={80} />
            </label>
          )}
          {mode !== "reset-password" && (
            <label>
              Email address
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                maxLength={254}
              />
            </label>
          )}
          {mode !== "forgot-password" && (
            <label>
              Password · at least 12 characters
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                required
              />
            </label>
          )}
          {mode === "register" &&
            process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY && (
              <>
                <Script
                  src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                  onReady={mountCaptcha}
                />
                <div ref={captchaRef} />
              </>
            )}
          <button
            disabled={
              busy ||
              (mode === "register" &&
                Boolean(process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY) &&
                !token)
            }
            className="button"
          >
            {busy
              ? "Please wait…"
              : mode === "register"
                ? "Create account"
                : mode === "forgot-password"
                  ? "Send reset email"
                  : mode === "reset-password"
                    ? "Save password"
                    : "Sign in"}{" "}
            ↗
          </button>
          <p role="status">{message}</p>
        </form>
        <div className="auth-links">
          <Link href="/login">Sign in</Link>
          <Link href="/register">Create account</Link>
          <Link href="/forgot-password">Forgot password?</Link>
        </div>
        {mode === "login" && (
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                const r = await api<{
                  message: string;
                }>("/api/auth/resend", {
                  email: new FormData(e.currentTarget).get("email"),
                });
                setMessage(r.message);
              } catch (error) {
                setMessage((error as Error).message);
              }
            }}
          >
            <label>
              Need a new confirmation email?
              <input
                name="email"
                type="email"
                required
                placeholder="Your email"
              />
            </label>
            <button className="text-link">Resend confirmation</button>
          </form>
        )}
      </div>
    </section>
  );
}
export function Mfa() {
  const [factors, setFactors] = useState<
      {
        id: string;
        status: string;
        friendly_name: string;
      }[]
    >([]),
    [enrollment, setEnrollment] = useState<{
      id: string;
      qr_code: string;
      secret: string;
    } | null>(null),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<{
      factors: typeof factors;
    }>("/api/auth/mfa-list", {})
      .then((r) => setFactors(r.factors))
      .catch((e) => setMessage(e.message));
  }, []);
  const factor = factors.find((f) => f.status === "verified");
  return (
    <section className="section narrow">
      <p className="eyebrow">Staff account security</p>
      <h1>Two-step sign in.</h1>
      <p>
        Use an authenticator app. A fresh code is required before staff tools
        open.
      </p>
      {!factor && !enrollment && (
        <button
          disabled={busy}
          className="button"
          onClick={async () => {
            setBusy(true);
            try {
              setEnrollment(await api("/api/auth/mfa-enroll", {}));
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Set up authenticator
        </button>
      )}
      {enrollment && (
        <div className="mfa-setup">
          <img
            src={`data:image/svg+xml;utf8,${encodeURIComponent(enrollment.qr_code)}`}
            alt="Authenticator setup QR code"
          />
          <p>Scan with your authenticator. Keep this key private.</p>
          <code className="secret">{enrollment.secret}</code>
        </div>
      )}
      {(factor || enrollment) && (
        <form
          className="form-panel"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await api<{
                redirect: string;
              }>("/api/auth/mfa-verify", {
                factor_id: factor?.id || enrollment?.id,
                code: new FormData(e.currentTarget).get("code"),
              });
              window.location.assign(r.redirect);
            } catch (e) {
              setMessage((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            6-digit code
            <input
              name="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              required
            />
          </label>
          <button className="button" disabled={busy}>
            Verify & open admin ↗
          </button>
        </form>
      )}
      <p role="status">{message}</p>
      <p className="subtle">
        Lost your authenticator? Ask the project owner to reset your MFA in
        Supabase Auth. The app has no security bypass.
      </p>
    </section>
  );
}
