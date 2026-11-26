'use client';

import React, { useState, useEffect } from 'react';
import { api } from './api';

interface CustomerAuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  initialRedirect?: string;
}

type ModalTab = 'login' | 'register' | 'forgot';

export function CustomerAuthModal({
  isOpen,
  onClose,
  onSuccess,
  initialRedirect = '/account',
}: CustomerAuthModalProps) {
  const [tab, setTab] = useState<ModalTab>('login');
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [statusMsg, setStatusMsg] = useState('');

  useEffect(() => {
    if (isOpen) {
      setErrorMsg('');
      setStatusMsg('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg('');
    setStatusMsg('');

    if (tab === 'register') {
      if (fullName.trim().length < 2) {
        setErrorMsg('Please enter your full name (minimum 2 characters).');
        return;
      }
      if (password !== confirmPassword) {
        setErrorMsg('Password and Confirm Password do not match.');
        return;
      }
    }

    setBusy(true);
    try {
      if (tab === 'login') {
        const res = await api<{ redirect?: string }>('/api/auth/login', {
          email: email.trim(),
          password,
        });
        onClose();
        if (onSuccess) onSuccess();
        else window.location.assign(initialRedirect || res.redirect || '/account');
      } else if (tab === 'register') {
        const res = await api<{ message?: string }>('/api/auth/register', {
          name: fullName.trim(),
          email: email.trim(),
          password,
          confirm_password: confirmPassword,
          captcha_token: '',
        });
        setStatusMsg(
          res.message ||
            'Account created. Please check your inbox to confirm your email before signing in.'
        );
      } else {
        const res = await api<{ message?: string }>('/api/auth/forgot', {
          email: email.trim(),
        });
        setStatusMsg(
          res.message || 'If an account exists for this email, a password reset link has been sent.'
        );
      }
    } catch (err) {
      setErrorMsg((err as Error).message || 'Authentication failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(26, 15, 10, 0.6)',
        backdropFilter: 'blur(4px)',
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div
        style={{
          background: '#FFFFFF',
          width: '100%',
          maxWidth: 460,
          borderRadius: 14,
          boxShadow: '0 24px 60px rgba(0, 0, 0, 0.25)',
          border: '1px solid #EAD5C0',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            background: 'linear-gradient(135deg, #6B1724 0%, #4A0E17 100%)',
            padding: '22px 26px',
            color: '#FFFFFF',
            position: 'relative',
            borderBottom: '3px solid #C49A52',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close login modal"
            style={{
              position: 'absolute',
              top: 14,
              right: 14,
              background: 'rgba(255,255,255,0.12)',
              border: '1px solid rgba(255,255,255,0.2)',
              color: '#FFFFFF',
              width: 30,
              height: 30,
              borderRadius: '50%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              fontSize: 16,
            }}
          >
            ✕
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <img
              src="/assets/brand-logo.png"
              alt="Magarantham Silks"
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: '#FFFFFF',
                padding: 3,
                objectFit: 'contain',
              }}
            />
            <div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                  color: '#FDE047',
                  fontWeight: 600,
                }}
              >
                Magarantham Silks
              </div>
              <h2
                id="auth-modal-title"
                style={{
                  margin: '2px 0 0 0',
                  fontSize: 19,
                  fontWeight: 600,
                  color: '#FFFFFF',
                }}
              >
                {tab === 'register'
                  ? 'Create Customer Account'
                  : tab === 'forgot'
                    ? 'Reset Your Password'
                    : 'Welcome to Magarantham Silks'}
              </h2>
            </div>
          </div>
        </div>

        <div style={{ padding: '24px 26px' }}>
          {errorMsg && (
            <div
              style={{
                background: '#FEF2F2',
                border: '1px solid #FECACA',
                color: '#991B1B',
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {errorMsg}
            </div>
          )}
          {statusMsg && (
            <div
              style={{
                background: '#ECFDF5',
                border: '1px solid #A7F3D0',
                color: '#065F46',
                padding: '10px 14px',
                borderRadius: 8,
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {statusMsg}
            </div>
          )}

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {tab === 'register' && (
              <label style={{ display: 'block', marginBottom: 0 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  Full Name
                </span>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Priyadharshini"
                  required
                  minLength={2}
                  maxLength={80}
                  className="auth-input"
                />
              </label>
            )}

            <label style={{ display: 'block', marginBottom: 0 }}>
              <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                Email Address
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="auth-input"
              />
            </label>

            {tab !== 'forgot' && (
              <label style={{ display: 'block', marginBottom: 0 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  Password
                </span>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Minimum 6 characters"
                    required
                    minLength={6}
                    className="auth-input"
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#800020',
                    }}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>
            )}

            {tab === 'register' && (
              <label style={{ display: 'block', marginBottom: 0 }}>
                <span style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#374151', marginBottom: 5 }}>
                  Confirm Password
                </span>
                <div style={{ position: 'relative' }}>
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    minLength={6}
                    className="auth-input"
                    style={{ paddingRight: 44 }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword((s) => !s)}
                    style={{
                      position: 'absolute',
                      right: 10,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      color: '#800020',
                    }}
                  >
                    {showConfirmPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </label>
            )}

            <button
              type="submit"
              disabled={busy}
              className="button"
              style={{ width: '100%', marginTop: 6, height: 46 }}
            >
              {busy
                ? 'Please wait…'
                : tab === 'register'
                  ? 'Create Account ↗'
                  : tab === 'forgot'
                    ? 'Send Reset Link ↗'
                    : 'Login ↗'}
            </button>
          </form>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 18,
              paddingTop: 14,
              borderTop: '1px solid #F3EAE0',
              fontSize: 12,
            }}
          >
            {tab === 'login' ? (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setTab('register');
                    setErrorMsg('');
                    setStatusMsg('');
                  }}
                  style={{ background: 'none', border: 'none', color: '#800020', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setTab('forgot');
                    setErrorMsg('');
                    setStatusMsg('');
                  }}
                  style={{ background: 'none', border: 'none', color: '#6B7280', fontWeight: 500, cursor: 'pointer', textDecoration: 'underline' }}
                >
                  Forgot Password?
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setTab('login');
                  setErrorMsg('');
                  setStatusMsg('');
                }}
                style={{ background: 'none', border: 'none', color: '#800020', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}
              >
                ← Back to Login
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
