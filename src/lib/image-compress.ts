export type CompressionOptions = {
  maxSizeKB?: number; // default 50 KB
  minSizeKB?: number; // default 1 KB
  maxWidth?: number; // default 1200px
  maxHeight?: number; // default 1200px
  initialQuality?: number; // default 0.85
  minQuality?: number; // default 0.35
  preferFormat?: "image/webp" | "image/jpeg";
};

export type CompressionResult = {
  file: File;
  blob: Blob;
  originalSize: number;
  compressedSize: number;
  compressionPercentage: number;
  width: number;
  height: number;
  mimeType: string;
  previewUrl: string;
  formattedOriginalSize: string;
  formattedCompressedSize: string;
};

const SUPPORTED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
];

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function validateImageFile(file: File): { valid: boolean; error?: string } {
  if (!file) {
    return { valid: false, error: "No file selected." };
  }
  const type = file.type.toLowerCase();
  const name = file.name.toLowerCase();
  const hasSupportedExt =
    name.endsWith(".jpg") ||
    name.endsWith(".jpeg") ||
    name.endsWith(".png") ||
    name.endsWith(".webp");

  if (!SUPPORTED_MIME_TYPES.includes(type) && !hasSupportedExt) {
    return {
      valid: false,
      error: "Unsupported image format. Please upload JPG, PNG or WebP.",
    };
  }

  // Reject files that are absurdly large (> 25MB)
  if (file.size > 25 * 1024 * 1024) {
    return {
      valid: false,
      error: "File is too large. Please select an image under 25 MB.",
    };
  }

  return { valid: true };
}

export async function compressImage(
  file: File,
  options: CompressionOptions = {},
): Promise<CompressionResult> {
  const validation = validateImageFile(file);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const maxSizeKB = options.maxSizeKB ?? 50;
  const targetMaxBytes = maxSizeKB * 1024;
  const maxWidth = options.maxWidth ?? 1200;
  const maxHeight = options.maxHeight ?? 1200;
  const initialQuality = options.initialQuality ?? 0.85;
  const minQuality = options.minQuality ?? 0.35;
  const preferFormat = options.preferFormat ?? "image/webp";

  // Load image
  const img = await loadImage(file);
  let curWidth = img.naturalWidth || img.width;
  let curHeight = img.naturalHeight || img.height;

  // Scale down dimensions to fit bounding box while strictly preserving aspect ratio
  if (curWidth > maxWidth || curHeight > maxHeight) {
    const ratio = Math.min(maxWidth / curWidth, maxHeight / curHeight);
    curWidth = Math.round(curWidth * ratio);
    curHeight = Math.round(curHeight * ratio);
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) {
    throw new Error("Unable to create canvas context for image processing.");
  }

  // Enable high-quality image smoothing
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  let bestBlob: Blob | null = null;
  let bestQuality = initialQuality;
  let scale = 1.0;
  const steps = [initialQuality, 0.75, 0.65, 0.55, 0.45, 0.38, minQuality];

  // Iterative compression loop
  for (let s = 0; s < 3; s++) {
    const targetW = Math.max(200, Math.round(curWidth * scale));
    const targetH = Math.max(200, Math.round(curHeight * scale));
    canvas.width = targetW;
    canvas.height = targetH;

    ctx.clearRect(0, 0, targetW, targetH);
    ctx.drawImage(img, 0, 0, targetW, targetH);

    for (const q of steps) {
      const blob = await canvasToBlob(canvas, preferFormat, q);
      if (!blob) continue;

      if (!bestBlob || blob.size < bestBlob.size) {
        bestBlob = blob;
        bestQuality = q;
      }

      // If we met target <= 50KB, we can stop
      if (blob.size <= targetMaxBytes) {
        bestBlob = blob;
        break;
      }
    }

    if (bestBlob && bestBlob.size <= targetMaxBytes) {
      break;
    }

    // If still over target, scale dimensions down by 20% for next iteration
    scale *= 0.8;
  }

  // Fallback to jpeg if webp was not produced or if canvas did not support webp
  if (!bestBlob) {
    canvas.width = curWidth;
    canvas.height = curHeight;
    ctx.drawImage(img, 0, 0, curWidth, curHeight);
    bestBlob = (await canvasToBlob(canvas, "image/jpeg", 0.6)) || file;
  }

  const originalSize = file.size;
  const compressedSize = bestBlob.size;
  const diff = Math.max(0, originalSize - compressedSize);
  const compressionPercentage =
    originalSize > 0 ? Math.round((diff / originalSize) * 100) : 0;

  const ext = bestBlob.type === "image/webp" ? "webp" : "jpg";
  const baseName = file.name.substring(0, file.name.lastIndexOf(".")) || "image";
  const compressedFile = new File([bestBlob], `${baseName}.${ext}`, {
    type: bestBlob.type,
    lastModified: Date.now(),
  });

  const previewUrl = URL.createObjectURL(bestBlob);

  return {
    file: compressedFile,
    blob: bestBlob,
    originalSize,
    compressedSize,
    compressionPercentage,
    width: canvas.width,
    height: canvas.height,
    mimeType: bestBlob.type,
    previewUrl,
    formattedOriginalSize: formatFileSize(originalSize),
    formattedCompressedSize: formatFileSize(compressedSize),
  };
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Failed to load image file."));
    };
    img.src = url;
  });
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), format, quality);
  });
}
