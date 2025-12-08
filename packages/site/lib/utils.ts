import type { ClassValue } from "class-variance-authority/types";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import { validate as uuidValidate } from "uuid";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ApplicationError extends Error {
  info: string;
  status: number;
}

const fetcher = async <T>(url: string): Promise<T> => {
  const res = await fetch(url);

  if (!res.ok) {
    const error = new Error(
      "An error occurred while fetching the data."
    ) as ApplicationError;

    error.info = await res.json();
    error.status = res.status;

    throw error;
  }

  return res.json();
};

export function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatFullTimestamp(date: Date): string {
  return date.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

const ALPHABET =
  "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const BASE = BigInt(62);

// UUID → 22-char base-62
export function uuidToSlug(uuid: string, title?: string): string {
  let n = BigInt("0x" + uuid.replace(/-/g, "")); // 128-bit bigint
  let out = "";
  while (n > BigInt(0)) {
    out = ALPHABET[Number(n % BASE)] + out;
    n /= BASE;
  }
  const slug = out.padStart(22, "0"); // always 22 chars
  if (!title) {
    return slug;
  }
  return `${titleToSlug(title)}-${slug}`;
}

// slug → canonical UUID
// If a UUIDv4 is provided, it is returned as is.
export function slugToUuid(slug: string): string {
  if (!slug) {
    throw new Error("Invalid slug");
  }
  if (uuidValidate(slug)) {
    return slug;
  }
  slug = slug.split("-").pop() ?? "";
  if (!slug) {
    throw new Error("Invalid slug");
  }

  let n = BigInt(0);
  for (const c of slug) n = n * BASE + BigInt(ALPHABET.indexOf(c));

  const hex = n.toString(16).padStart(32, "0");
  return hex.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, "$1-$2-$3-$4-$5");
}

// Create a URL-safe slug from a title
export function titleToSlug(title: string | null): string {
  if (!title) {
    return "untitled";
  }
  return (
    title
      .trim()
      // Replace whitespace with hyphens
      .replace(/\s+/g, "-")
      // Remove or replace special characters
      .replace(/[^\w\-]/g, "")
      // Remove multiple consecutive hyphens
      .replace(/-+/g, "-")
      // Remove leading/trailing hyphens
      .replace(/^-+|-+$/g, "") ||
    // Ensure it's not empty
    "untitled"
  );
}

// Image validation constants
const MAX_IMAGE_WIDTH = 2000;
const MAX_IMAGE_HEIGHT = 2000;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// Validate image dimensions and file size
function validateImageFile(
  file: File
): Promise<{ isValid: boolean; error?: string }> {
  return new Promise((resolve) => {
    // Check if it's an image file
    if (!file.type.startsWith("image/")) {
      resolve({ isValid: true }); // Not an image, skip validation
      return;
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      resolve({
        isValid: false,
        error: `Image file size (${(file.size / 1024 / 1024).toFixed(1)}MB) exceeds the 10MB limit`,
      });
      return;
    }

    // Create image element to check dimensions
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(url);

      if (img.width > MAX_IMAGE_WIDTH) {
        resolve({
          isValid: false,
          error: `Image width (${img.width}px) exceeds the maximum allowed width of ${MAX_IMAGE_WIDTH}px`,
        });
        return;
      }

      if (img.height > MAX_IMAGE_HEIGHT) {
        resolve({
          isValid: false,
          error: `Image height (${img.height}px) exceeds the maximum allowed height of ${MAX_IMAGE_HEIGHT}px`,
        });
        return;
      }

      resolve({ isValid: true });
    };

    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({
        isValid: false,
        error: "Invalid image file",
      });
    };

    img.src = url;
  });
}

// Tremor Raw cx [v0.0.0]

function cx(...args: ClassValue[]) {
  return twMerge(clsx(...args));
}

// Tremor focusInput [v0.0.2]

const focusInput = [
  // base
  "focus:ring-2",
  // ring color
  "focus:ring-blue-200 dark:focus:ring-blue-700/30",
  // border color
  "focus:border-blue-500 dark:focus:border-blue-700",
];

// Tremor Raw focusRing [v0.0.1]

const focusRing = [
  // base
  "outline outline-offset-2 outline-0 focus-visible:outline-2",
  // outline color
  "outline-blue-500 dark:outline-blue-500",
];

// Tremor Raw hasErrorInput [v0.0.1]

const hasErrorInput = [
  // base
  "ring-2",
  // border color
  "border-red-500 dark:border-red-700",
  // ring color
  "ring-red-200 dark:ring-red-700/30",
];
