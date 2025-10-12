import React from "react";

interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Switch({
  checked,
  onCheckedChange,
  disabled = false,
  id,
}: SwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => !disabled && onCheckedChange(!checked)}
      className={`
        relative inline-flex h-6 w-11 items-center rounded-full transition-colors
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2
        ${disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer"}
        ${checked ? "bg-green-500" : "bg-input"}
      `}
    >
      <span
        className={`
          inline-block h-5 w-5 transform rounded-full bg-background shadow-lg transition-transform
          ${checked ? "translate-x-5" : "translate-x-1"}
        `}
      />
    </button>
  );
}
