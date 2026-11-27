'use client';

import React, { useEffect, useRef, useState } from 'react';
import { BrowserMultiFormatReader, IScannerControls } from '@zxing/browser';
import { BarcodeFormat, DecodeHintType } from '@zxing/library';

export type CameraScanResult = {
  ok: boolean;
  message: string;
};

type CameraScannerModalProps = {
  open: boolean;
  paused?: boolean;
  onDetected: (code: string) => Promise<CameraScanResult>;
  onClose: () => void;
};

const SUPPORTED_FORMATS = [
  BarcodeFormat.CODE_128,
  BarcodeFormat.EAN_13,
  BarcodeFormat.EAN_8,
  BarcodeFormat.UPC_A,
  BarcodeFormat.UPC_E,
];

function friendlyCameraError(err: unknown): string {
  const e = err as { name?: string; message?: string };
  const name = e?.name || '';
  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return 'Camera permission was denied. Please allow camera access in your browser settings and try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera was found on this device. Please use the barcode scanner or manual search instead.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'Camera is currently in use by another app. Close other camera apps and try again.';
  }
  if (name === 'OverconstrainedError') {
    return 'Rear camera could not be initialized with the requested settings.';
  }
  return e?.message || 'Unable to start camera scanner. Please check camera permissions.';
}

export function CameraScannerModal({
  open,
  paused = false,
  onDetected,
  onClose,
}: CameraScannerModalProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onDetectedRef = useRef(onDetected);
  onDetectedRef.current = onDetected;
  const pausedPropRef = useRef(paused);
  pausedPropRef.current = paused;

  const processingRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  const [status, setStatus] = useState<'starting' | 'scanning' | 'paused' | 'error'>('starting');
  const [errorMsg, setErrorMsg] = useState('');
  const [feedback, setFeedback] = useState<{ ok: boolean; text: string } | null>(null);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  function stopCamera() {
    if (resumeTimerRef.current) {
      clearTimeout(resumeTimerRef.current);
      resumeTimerRef.current = null;
    }
    try {
      controlsRef.current?.stop();
    } catch {}
    controlsRef.current = null;

    const stream = streamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        try {
          track.stop();
        } catch {}
      }
      streamRef.current = null;
    }

    if (videoRef.current) {
      try {
        videoRef.current.srcObject = null;
      } catch {}
    }

    processingRef.current = false;
    setTorchOn(false);
    setTorchSupported(false);
  }

  async function toggleTorch() {
    const stream = streamRef.current;
    if (!stream) return;
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({
        advanced: [{ torch: next } as MediaTrackConstraintSet],
      });
      setTorchOn(next);
    } catch {
      setTorchSupported(false);
    }
  }

  useEffect(() => {
    if (!open) {
      stopCamera();
      return;
    }

    let cancelled = false;
    setStatus('starting');
    setErrorMsg('');
    setFeedback(null);
    processingRef.current = false;

    async function start() {
      if (typeof window === 'undefined') return;
      if (!window.isSecureContext) {
        setStatus('error');
        setErrorMsg('Camera scanning requires a secure HTTPS connection or localhost.');
        return;
      }
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('error');
        setErrorMsg('Camera API is not supported in this browser.');
        return;
      }

      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: { ideal: 'environment' },
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
        });
      } catch (err) {
        // Fallback for devices that reject resolution constraints
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' } },
          });
        } catch (fallbackErr) {
          if (cancelled) return;
          setStatus('error');
          setErrorMsg(friendlyCameraError(fallbackErr || err));
          return;
        }
      }

      if (cancelled) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      streamRef.current = stream;

      const track = stream.getVideoTracks()[0];
      if (track && typeof track.getCapabilities === 'function') {
        const caps = track.getCapabilities() as MediaTrackCapabilities & { torch?: boolean };
        setTorchSupported(Boolean(caps?.torch));
      }

      const videoEl = videoRef.current;
      if (!videoEl) {
        stopCamera();
        return;
      }

      const hints = new Map<DecodeHintType, unknown>();
      hints.set(DecodeHintType.POSSIBLE_FORMATS, SUPPORTED_FORMATS);
      hints.set(DecodeHintType.TRY_HARDER, true);

      const reader = new BrowserMultiFormatReader(hints, {
        delayBetweenScanAttempts: 180,
        delayBetweenScanSuccess: 1500,
      });

      try {
        const controls = await reader.decodeFromStream(stream, videoEl, async (result) => {
          if (cancelled || !result) return;
          if (processingRef.current || pausedPropRef.current) return;

          const rawCode = result.getText().trim();
          if (!rawCode) return;

          const now = Date.now();
          if (
            rawCode === lastScanRef.current.code &&
            now - lastScanRef.current.at < 2400
          ) {
            return;
          }

          processingRef.current = true;
          lastScanRef.current = { code: rawCode, at: now };
          setStatus('paused');

          try {
            const res = await onDetectedRef.current(rawCode);
            if (!cancelled) {
              setFeedback({ ok: res.ok, text: res.message });
            }
          } catch (e) {
            if (!cancelled) {
              setFeedback({
                ok: false,
                text: (e as Error)?.message || `Barcode "${rawCode}" not found.`,
              });
            }
          } finally {
            if (!cancelled) {
              resumeTimerRef.current = setTimeout(() => {
                if (!cancelled) {
                  processingRef.current = false;
                  setStatus('scanning');
                }
              }, 1600);
            }
          }
        });

        if (cancelled) {
          controls.stop();
          return;
        }
        controlsRef.current = controls;
        setStatus('scanning');
      } catch (err) {
        if (!cancelled) {
          stopCamera();
          setStatus('error');
          setErrorMsg(friendlyCameraError(err));
        }
      }
    }

    void start();

    function handleVisibility() {
      if (document.hidden) {
        stopCamera();
        onClose();
      }
    }

    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        stopCamera();
        onClose();
      }
    }

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('keydown', handleKey);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('keydown', handleKey);
      stopCamera();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="pos-cam-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Mobile Camera Barcode Scanner"
      onClick={() => {
        stopCamera();
        onClose();
      }}
    >
      <div className="pos-cam-modal" onClick={(e) => e.stopPropagation()}>
        <div className="pos-cam-header">
          <div className="pos-cam-title-wrap">
            <span className="pos-cam-badge">LIVE SCANNER</span>
            <h3>Scan Barcode with Camera</h3>
          </div>
          <div className="pos-cam-header-actions">
            {torchSupported && status !== 'error' && (
              <button
                type="button"
                className={`pos-cam-torch-btn ${torchOn ? 'active' : ''}`}
                onClick={() => void toggleTorch()}
                title={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
                aria-label={torchOn ? 'Turn off flashlight' : 'Turn on flashlight'}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                  <path d="M13 2 3 14h9l-1 8 10-12h-9l1-8Z" />
                </svg>
                <span>{torchOn ? 'Flash On' : 'Flash'}</span>
              </button>
            )}
            <button
              type="button"
              className="pos-cam-close-btn"
              onClick={() => {
                stopCamera();
                onClose();
              }}
              aria-label="Close camera scanner"
            >
              ✕ Close
            </button>
          </div>
        </div>

        <div className="pos-cam-viewport">
          {status === 'error' ? (
            <div className="pos-cam-error">
              <div className="pos-cam-error-icon">📷</div>
              <strong>Camera Unavailable</strong>
              <p>{errorMsg}</p>
              <button
                type="button"
                className="ms-btn ms-btn-primary ms-btn-sm"
                onClick={() => {
                  stopCamera();
                  onClose();
                }}
              >
                Back to POS Search
              </button>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className="pos-cam-video"
                playsInline
                muted
                autoPlay
              />
              <div className="pos-cam-overlay" aria-hidden="true">
                <div className={`pos-cam-frame ${status === 'paused' ? 'detected' : ''}`}>
                  <span className="pos-cam-corner tl" />
                  <span className="pos-cam-corner tr" />
                  <span className="pos-cam-corner bl" />
                  <span className="pos-cam-corner br" />
                  <div className="pos-cam-laser" />
                </div>
              </div>
              {status === 'starting' && (
                <div className="pos-cam-starting">Starting rear camera…</div>
              )}
            </>
          )}
        </div>

        <div className="pos-cam-footer">
          {feedback ? (
            <div className={`pos-cam-feedback ${feedback.ok ? 'ok' : 'err'}`} role="status">
              <span>{feedback.ok ? '✓' : '⚠'}</span>
              <span>{feedback.text}</span>
            </div>
          ) : (
            <p className="pos-cam-hint">
              Align the barcode inside the frame. Supports Code 128, EAN-13, EAN-8, UPC-A &amp; UPC-E.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
