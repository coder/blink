"use client";

import { cn } from "@/lib/utils";
import { useState } from "react";

const possibleColors = [
  "F43F5E", // rose
  "EC4899", // pink
  "D946EF", // fuchsia
  "A855F7", // purple
  "8B5CF6", // violet
  "6366F1", // indigo
  "3B82F6", // blue
  "0EA5E9", // sky
  "06B6D4", // cyan
  "14B8A6", // teal
  "10B981", // emerald
  "22C55E", // green
];

export interface AvatarProps {
  src?: string | null;
  seed: string;
  size?: number;
  className?: string;
  alt?: string;
  rounded?: "sm" | "md" | "lg";
}

export default function Avatar({
  src,
  seed,
  size = 32,
  className = "",
  alt,
  rounded = "sm",
}: AvatarProps) {
  const [imageError, setImageError] = useState(false);

  const roundedClass = {
    sm: "rounded-sm",
    md: "rounded-md",
    lg: "rounded-lg",
  }[rounded];

  const fallbackSrc = `https://api.dicebear.com/9.x/identicon/svg?rowColor=${possibleColors.join(",")}&seed=${encodeURIComponent(seed)}`;
  const imageSrc = imageError || !src ? fallbackSrc : src;

  return (
    <img
      src={imageSrc}
      alt={alt || seed}
      width={size}
      height={size}
      onError={() => setImageError(true)}
      className={cn(
        roundedClass,
        "border border-border object-cover",
        className
      )}
      style={{ aspectRatio: "1" }}
    />
  );
}
