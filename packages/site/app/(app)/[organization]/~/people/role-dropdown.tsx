"use client";

import { useEffect, useRef, useState } from "react";

interface RoleDropdownProps {
  value: "admin" | "member" | "billing_admin";
  onChange: (value: "admin" | "member" | "billing_admin") => void;
  className?: string;
}

const roleOptions = [
  {
    value: "member" as const,
    title: "Member",
    description: "Can create agents and use them, admin on agents they create",
  },
  {
    value: "admin" as const,
    title: "Admin",
    description: "Can manage members and has admin access to ALL agents",
  },
];

export function RoleDropdown({
  value,
  onChange,
  className = "",
}: RoleDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const selectedRole = roleOptions.find((role) => role.value === value)!;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-3 py-2 border rounded-lg bg-background text-left focus:ring-2 focus:ring-ring flex items-center justify-between"
      >
        <span className="text-sm font-medium">{selectedRole.title}</span>
        <svg
          className="h-4 w-4 text-muted-foreground"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M19 9l-7 7-7-7"
          />
        </svg>
      </button>

      {isOpen && (
        <div className="absolute z-10 mt-1 w-full bg-popover border rounded-lg shadow-lg">
          {roleOptions.map((role) => (
            <button
              key={role.value}
              type="button"
              onClick={() => {
                onChange(role.value);
                setIsOpen(false);
              }}
              className="w-full px-3 py-3 text-left hover:bg-accent first:rounded-t-lg last:rounded-b-lg"
            >
              <div className="text-sm font-medium">{role.title}</div>
              <div className="text-sm text-muted-foreground mt-1">
                {role.description}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
