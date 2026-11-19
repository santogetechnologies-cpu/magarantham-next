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
function EyeIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#800020"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      stroke="#800020"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
      <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
      <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
      <line x1="2" x2="22" y1="2" y2="22" />
    </svg>
  );
}

export function AuthForm({ mode }: { mode: string }) {
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [token, setToken] = useState(""),
    [showPassword, setShowPassword] = useState(false);
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
              Password
              <div className="password-field-wrapper">
                <input
                  name="password"
                  type={showPassword ? "text" : "password"}
                  minLength={6}
                  maxLength={128}
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
                  required
                  className="password-input"
                />
                <button
                  type="button"
                  className="password-toggle-btn"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  title={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? (
                    <EyeOffIcon className="password-toggle-icon" />
                  ) : (
                    <EyeIcon className="password-toggle-icon" />
                  )}
                </button>
              </div>
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
        </div>
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
