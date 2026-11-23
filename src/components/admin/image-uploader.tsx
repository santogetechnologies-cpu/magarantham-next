"use client";
import React, { useState, useRef } from "react";
import {
  compressImage,
  validateImageFile,
  CompressionResult,
} from "@/lib/image-compress";

export function ImageUploader({
  kind = "product",
  currentImageUrl,
  onUploadComplete,
  label = "Upload Product Image",
  maxWidth = 1200,
  maxHeight = 1200,
  maxSizeKB = 50,
}: {
  kind?: "product" | "employee" | "media";
  currentImageUrl?: string;
  onUploadComplete: (url: string) => void;
  label?: string;
  /** Banners need larger images than product thumbnails. */
  maxWidth?: number;
  maxHeight?: number;
  maxSizeKB?: number;
}) {
  const [compressing, setCompressing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const [result, setResult] = useState<CompressionResult | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleFile(file: File) {
    setError("");
    setUploaded(false);
    const validation = validateImageFile(file);
    if (!validation.valid) {
      setError("Please select a valid JPG, PNG, or WebP image.");
      return;
    }

    setResult(null);
    setCompressing(true);
    try {
      // Automatic iterative compression targeting 1 KB - 50 KB (unchanged)
      const compressed = await compressImage(file, {
        maxSizeKB,
        minSizeKB: 1,
        maxWidth,
        maxHeight,
        preferFormat: "image/webp",
      });

      setResult(compressed);
    } catch {
      setError("Unable to optimize this image. Please choose another image and try again.");
    } finally {
      setCompressing(false);
    }
  }

  async function handleUpload() {
    if (!result) return;
    setUploading(true);
    setProgress(20);
    setError("");

    try {
      const formData = new FormData();
      formData.append("kind", kind);
      formData.append("file", result.file);

      setProgress(55);

      const res = await fetch("/api/uploads", {
        method: "POST",
        body: formData,
      });

      setProgress(85);

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || data.error || "Upload failed.");
      }

      setProgress(100);
      setUploaded(true);
      onUploadComplete(data.url);
    } catch {
      setError("Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  function onDragOver(e: React.DragEvent) {
    e.preventDefault();
    if (!compressing && !uploading) setDragActive(true);
  }

  function onDragLeave(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragActive(false);
    if (!compressing && !uploading && e.dataTransfer.files && e.dataTransfer.files[0]) {
      void handleFile(e.dataTransfer.files[0]);
    }
  }

  function openPicker() {
    if (compressing || uploading) return;
    fileInputRef.current?.click();
  }

  return (
    <div className="luxury-image-uploader">
      <div className="uploader-header">
        <label className="uploader-label">{label}</label>
      </div>

      {error && (
        <div className="uploader-error-banner" role="alert">
          <span>{error}</span>
          <button
            type="button"
            className="text-link"
            onClick={openPicker}
            style={{ marginLeft: 10 }}
          >
            Try Another Image
          </button>
        </div>
      )}

      {/* Dropzone */}
      <div
        className={`uploader-dropzone ${dragActive ? "drag-active" : ""} ${
          compressing ? "compressing" : ""
        }`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={openPicker}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,.webp,image/jpeg,image/png,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) {
              void handleFile(file);
            }
          }}
        />

        {compressing ? (
          <div className="uploader-loading-state" role="status" aria-live="polite">
            <span className="spinner-gold" aria-hidden="true" />
            <p className="optimizing-title">Optimizing Image...</p>
            <div className="optimizing-bar" aria-hidden="true">
              <div className="optimizing-bar-fill" />
            </div>
          </div>
        ) : result ? (
          <div className="uploader-preview-layout">
            <div className="preview-image-box">
              <img
                src={result.previewUrl}
                alt="Image preview"
                className="preview-img"
              />
            </div>

            <div className="preview-meta-panel" onClick={(e) => e.stopPropagation()}>
              <div className="image-ready-row">
                <span className="image-ready-badge">
                  <span aria-hidden="true">✓</span> {uploaded ? "Uploaded to Storage" : "Image Ready"}
                </span>
              </div>

              {uploading ? (
                <div className="upload-progress-box">
                  <div className="progress-bar">
                    <div
                      className="progress-fill"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                  <span className="progress-text">Uploading to Storage...</span>
                </div>
              ) : (
                <div className="preview-actions-row">
                  <button
                    type="button"
                    className="button btn-upload-now"
                    onClick={handleUpload}
                  >
                    Upload to Storage
                  </button>
                  <button
                    type="button"
                    className="text-link btn-change"
                    onClick={openPicker}
                  >
                    Choose Different Image
                  </button>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="uploader-empty-prompt">
            {currentImageUrl ? (
              <div className="current-image-preview">
                <img src={currentImageUrl} alt="Current product" />
                <span className="replace-overlay">Click or drag to replace image</span>
              </div>
            ) : (
              <div className="prompt-content">
                <span className="upload-icon-symbol" aria-hidden="true">&#128444;</span>
                <p className="prompt-title">Click to upload or drag &amp; drop</p>
                <p className="prompt-subtitle">JPG, PNG or WebP</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
