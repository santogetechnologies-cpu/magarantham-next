'use client';

import { useState, useEffect, useRef, FormEvent } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { api } from './api';
import { SUPPORTED_COUNTRY_CODES } from '@/lib/phone';

export function CustomerAuthModal({
  isOpen,
  onClose,
  initialRedirect = '/account',
}: {
  isOpen: boolean;
  onClose: () => void;
  initialRedirect?: string;
}) {
  const [mounted, setMounted] = useState(false);
  const [step, setStep] = useState<'phone' | 'otp' | 'email'>('phone');
  const [dialCode, setDialCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [countdown, setCountdown] = useState(60);
  const [canResend, setCanResend] = useState(false);

  // Email fallback form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const otpInputsRef = useRef<(HTMLInputElement | null)[]>([]);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Countdown timer for OTP resend
  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (step === 'otp' && countdown > 0) {
      timer = setInterval(() => {
        setCountdown((prev) => {
          if (prev <= 1) {
            setCanResend(true);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [step, countdown]);

  // Focus first OTP input when moving to OTP step
  useEffect(() => {
    if (step === 'otp') {
      setTimeout(() => {
        otpInputsRef.current[0]?.focus();
      }, 100);
    }
  }, [step]);

  // Reset states when closed
  useEffect(() => {
    if (!isOpen) {
      setErrorMsg('');
      setSuccessMsg('');
      setBusy(false);
    }
  }, [isOpen]);

  if (!mounted || !isOpen) return null;

  async function handleSendOtp(e?: FormEvent) {
    if (e) e.preventDefault();
    const cleanDigits = phoneNumber.replace(/\D/g, '');
    if (dialCode === '+91' && cleanDigits.length !== 10) {
      setErrorMsg('Please enter a valid 10-digit Indian mobile number.');
      return;
    }
    if (cleanDigits.length < 7) {
      setErrorMsg('Please enter a valid mobile number.');
      return;
    }

    setBusy(true);
    setErrorMsg('');
    setSuccessMsg('');

    try {
      const res = await api<{ message: string; phone: string; expires_in?: number }>('/api/auth/phone-send-otp', {
        phone: cleanDigits,
        dial_code: dialCode,
      });

      setSuccessMsg(res.message || 'OTP sent successfully.');
      setStep('otp');
      setOtp(['', '', '', '', '', '']);
      setCountdown(res.expires_in || 60);
      setCanResend(false);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleVerifyOtp(e?: FormEvent) {
    if (e) e.preventDefault();
    const token = otp.join('');
    if (token.length !== 6) {
      setErrorMsg('Please enter the full 6-digit OTP code.');
      return;
    }

    setBusy(true);
    setErrorMsg('');

    try {
      const res = await api<{ redirect?: string; message?: string }>('/api/auth/phone-verify-otp', {
        phone: phoneNumber.replace(/\D/g, ''),
        dial_code: dialCode,
        token,
        name: customerName,
      });

      onClose();
      window.location.assign(res.redirect || initialRedirect);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleEmailLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErrorMsg('');

    try {
      const res = await api<{ redirect?: string }>('/api/auth/login', {
        email,
        password,
      });
      onClose();
      window.location.assign(res.redirect || initialRedirect);
    } catch (err) {
      setErrorMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function handleOtpChange(index: number, val: string) {
    // Support pasting 6-digit code
    if (val.length > 1) {
      const digits = val.replace(/\D/g, '').slice(0, 6).split('');
      const newOtp = [...otp];
      digits.forEach((d, i) => {
        newOtp[i] = d;
      });
      setOtp(newOtp);
      const nextIndex = Math.min(digits.length, 5);
      otpInputsRef.current[nextIndex]?.focus();
      return;
    }

    const digit = val.replace(/\D/g, '');
    const newOtp = [...otp];
    newOtp[index] = digit;
    setOtp(newOtp);

    // Auto-advance
    if (digit && index < 5) {
      otpInputsRef.current[index + 1]?.focus();
    }
  }

  function handleOtpKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputsRef.current[index - 1]?.focus();
    }
  }

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        background: 'rgba(26, 10, 15, 0.7)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        overflowY: 'auto',
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: '#FFFFFF',
          borderRadius: 20,
          boxShadow: '0 25px 70px rgba(80, 0, 20, 0.28)',
          border: '1.5px solid var(--erp-gold, #C49A52)',
          width: '100%',
          maxWidth: 450,
          margin: 'auto',
          overflow: 'hidden',
          animation: 'fadeIn 0.2s ease-out',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Header with Brand Accent */}
        <div
          style={{
            background: 'linear-gradient(135deg, #FAF4EB 0%, #F5E8D3 100%)',
            padding: '20px 24px 16px',
            borderBottom: '1px solid #EAD5C0',
            position: 'relative',
            textAlign: 'center',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              background: 'none',
              border: 'none',
              fontSize: 24,
              color: 'var(--erp-maroon, #6B1724)',
              cursor: 'pointer',
              lineHeight: 1,
              padding: 4,
            }}
          >
            ×
          </button>

          <img
            src="/assets/logo.png"
            alt="Magarantham Silks"
            style={{ height: 44, width: 'auto', margin: '0 auto 6px', display: 'block' }}
            onError={(e) => {
              (e.currentTarget as HTMLElement).style.display = 'none';
            }}
          />
          <span
            style={{
              display: 'block',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              color: 'var(--erp-gold-dark, #96702E)',
            }}
          >
            மகரந்தம் சில்க்ஸ் · MAGARANTHAM SILKS
          </span>
          <h2
            style={{
              margin: '6px 0 2px',
              fontSize: 21,
              fontWeight: 700,
              color: 'var(--erp-maroon, #6B1724)',
              fontFamily: 'var(--serif)',
            }}
          >
            {step === 'otp' ? 'Verify Mobile Number' : step === 'email' ? 'Customer Sign In' : 'Welcome to Magarantham'}
          </h2>
          <p style={{ margin: 0, fontSize: 12.5, color: '#6B7280' }}>
            {step === 'otp'
              ? `Enter the 6-digit OTP sent to ${dialCode} ${phoneNumber}`
              : step === 'email'
              ? 'Access your orders with your email and password'
              : 'Sign in with your mobile number for quick checkout and order tracking'}
          </p>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '22px 24px 24px' }}>
          {errorMsg && (
            <div
              style={{
                background: '#FEF2F2',
                border: '1px solid #FCA5A5',
                color: '#991B1B',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 12.5,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>⚠️</span>
              <span style={{ flex: 1 }}>{errorMsg}</span>
            </div>
          )}

          {successMsg && (
            <div
              style={{
                background: '#F0FDF4',
                border: '1px solid #86EFAC',
                color: '#166534',
                borderRadius: 8,
                padding: '10px 12px',
                fontSize: 12.5,
                marginBottom: 16,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
              }}
            >
              <span>✓</span>
              <span style={{ flex: 1 }}>{successMsg}</span>
            </div>
          )}

          {/* Step 1: Mobile Number Input */}
          {step === 'phone' && (
            <form onSubmit={handleSendOtp}>
              <label style={{ display: 'block', marginBottom: 16 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--erp-maroon, #6B1724)', marginBottom: 6 }}>
                  Mobile Number *
                </span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <select
                    value={dialCode}
                    onChange={(e) => setDialCode(e.target.value)}
                    style={{
                      width: 110,
                      padding: '10px 8px',
                      fontSize: 13,
                      borderRadius: 8,
                      border: '1.5px solid #D4B99F',
                      background: '#FAF7F2',
                      color: 'var(--erp-text, #1F2937)',
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {SUPPORTED_COUNTRY_CODES.map((c) => (
                      <option key={c.code} value={c.dialCode}>
                        {c.flag} {c.dialCode} ({c.name})
                      </option>
                    ))}
                  </select>

                  <input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="e.g. 98765 43210"
                    maxLength={15}
                    required
                    autoFocus
                    style={{
                      flex: 1,
                      padding: '10px 14px',
                      fontSize: 15,
                      fontWeight: 600,
                      letterSpacing: '0.04em',
                      borderRadius: 8,
                      border: '1.5px solid #D4B99F',
                      background: '#FFFFFF',
                      color: 'var(--erp-text, #1F2937)',
                      outline: 'none',
                    }}
                  />
                </div>
              </label>

              <button
                type="submit"
                disabled={busy || !phoneNumber.trim()}
                style={{
                  width: '100%',
                  background: 'var(--erp-maroon, #6B1724)',
                  color: '#FFFFFF',
                  padding: '12px 20px',
                  fontSize: 14,
                  fontWeight: 700,
                  border: 'none',
                  borderRadius: 9,
                  cursor: busy || !phoneNumber.trim() ? 'not-allowed' : 'pointer',
                  boxShadow: '0 3px 8px rgba(107, 23, 36, 0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  transition: 'background 0.15s ease',
                }}
              >
                {busy ? 'Sending OTP…' : 'Send OTP ↗'}
              </button>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  margin: '18px 0 14px',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
                <span style={{ fontSize: 11, color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  or
                </span>
                <div style={{ flex: 1, height: 1, background: '#E5E7EB' }} />
              </div>

              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setErrorMsg('');
                }}
                style={{
                  width: '100%',
                  background: '#FAF7F2',
                  border: '1px solid #D4B99F',
                  color: 'var(--erp-maroon, #6B1724)',
                  padding: '10px 16px',
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                ✉️ Sign in with Email & Password
              </button>
            </form>
          )}

          {/* Step 2: 6-Digit OTP Verification Screen */}
          {step === 'otp' && (
            <form onSubmit={handleVerifyOtp}>
              <div style={{ marginBottom: 18 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--erp-maroon, #6B1724)', marginBottom: 8, textAlign: 'center' }}>
                  Enter 6-Digit Verification Code
                </span>

                <div style={{ display: 'flex', justifyContent: 'center', gap: 8, margin: '10px 0' }}>
                  {otp.map((digit, idx) => (
                    <input
                      key={idx}
                      ref={(el) => {
                        otpInputsRef.current[idx] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      maxLength={1}
                      value={digit}
                      onChange={(e) => handleOtpChange(idx, e.target.value)}
                      onKeyDown={(e) => handleOtpKeyDown(idx, e)}
                      style={{
                        width: 44,
                        height: 50,
                        textAlign: 'center',
                        fontSize: 22,
                        fontWeight: 700,
                        borderRadius: 8,
                        border: digit ? '2px solid var(--erp-maroon, #6B1724)' : '1.5px solid #D4B99F',
                        background: digit ? '#FFFDF9' : '#FFFFFF',
                        color: 'var(--erp-maroon, #6B1724)',
                        outline: 'none',
                      }}
                    />
                  ))}
                </div>
              </div>

              <button
                type="submit"
                disabled={busy || otp.join('').length !== 6}
                style={{
                  width: '100%',
                  background: 'var(--erp-maroon, #6B1724)',
                  color: '#FFFFFF',
                  padding: '12px 20px',
                  fontSize: 14,
                  fontWeight: 700,
                  border: 'none',
                  borderRadius: 9,
                  cursor: busy || otp.join('').length !== 6 ? 'not-allowed' : 'pointer',
                  boxShadow: '0 3px 8px rgba(107, 23, 36, 0.28)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                }}
              >
                {busy ? 'Verifying OTP…' : 'Verify & Log In ✓'}
              </button>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginTop: 16,
                  fontSize: 12.5,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setErrorMsg('');
                    setSuccessMsg('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: '#6B7280',
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    padding: 0,
                  }}
                >
                  ← Change Number
                </button>

                {countdown > 0 ? (
                  <span style={{ color: '#9CA3AF' }}>Resend in {countdown}s</span>
                ) : (
                  <button
                    type="button"
                    onClick={handleSendOtp}
                    disabled={busy || !canResend}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--erp-maroon, #6B1724)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    Resend OTP ↻
                  </button>
                )}
              </div>
            </form>
          )}

          {/* Email Fallback Form */}
          {step === 'email' && (
            <form onSubmit={handleEmailLogin}>
              <label style={{ display: 'block', marginBottom: 12 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--erp-maroon, #6B1724)', marginBottom: 4 }}>
                  Email Address *
                </span>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="your.email@example.com"
                  required
                  autoFocus
                  style={{
                    width: '100%',
                    padding: '10px 14px',
                    fontSize: 14,
                    borderRadius: 8,
                    border: '1.5px solid #D4B99F',
                    background: '#FFFFFF',
                    boxSizing: 'border-box',
                  }}
                />
              </label>

              <label style={{ display: 'block', marginBottom: 16 }}>
                <span style={{ display: 'block', fontSize: 12.5, fontWeight: 700, color: 'var(--erp-maroon, #6B1724)', marginBottom: 4 }}>
                  Password *
                </span>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    style={{
                      width: '100%',
                      padding: '10px 42px 10px 14px',
                      fontSize: 14,
                      borderRadius: 8,
                      border: '1.5px solid #D4B99F',
                      background: '#FFFFFF',
                      boxSizing: 'border-box',
                    }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      position: 'absolute',
                      right: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      fontSize: 16,
                      color: '#9CA3AF',
                      cursor: 'pointer',
                    }}
                  >
                    {showPassword ? '👁️' : '👁️‍🗨️'}
                  </button>
                </div>
              </label>

              <button
                type="submit"
                disabled={busy}
                style={{
                  width: '100%',
                  background: 'var(--erp-maroon, #6B1724)',
                  color: '#FFFFFF',
                  padding: '12px 20px',
                  fontSize: 14,
                  fontWeight: 700,
                  border: 'none',
                  borderRadius: 9,
                  cursor: busy ? 'not-allowed' : 'pointer',
                  boxShadow: '0 3px 8px rgba(107, 23, 36, 0.28)',
                }}
              >
                {busy ? 'Signing in…' : 'Sign in with Password ↗'}
              </button>

              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 14, fontSize: 12.5 }}>
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setErrorMsg('');
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--erp-maroon, #6B1724)',
                    fontWeight: 700,
                    cursor: 'pointer',
                    padding: 0,
                  }}
                >
                  📱 Back to Mobile Login
                </button>
                <Link
                  href="/forgot-password"
                  onClick={onClose}
                  style={{ color: '#6B7280', textDecoration: 'underline' }}
                >
                  Forgot password?
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>,
    document.body
  );
}
