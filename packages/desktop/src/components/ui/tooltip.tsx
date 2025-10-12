import React, { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  className?: string;
  position?: "above" | "below";
}

export function Tooltip({
  content,
  children,
  className = "",
  position = "above",
}: TooltipProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isVisible && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      setCoords({
        top: position === "below" ? rect.bottom + 8 : rect.top - 8,
        left: rect.left + rect.width / 2,
      });
    }
  }, [isVisible, position]);

  return (
    <>
      <div
        ref={triggerRef}
        className={`relative ${className}`}
        onMouseEnter={() => setIsVisible(true)}
        onMouseLeave={() => setIsVisible(false)}
      >
        {children}
      </div>
      {isVisible &&
        createPortal(
          <div
            className="fixed px-3 py-1.5 text-xs rounded whitespace-nowrap pointer-events-none shadow-lg"
            style={{
              transform:
                position === "below"
                  ? "translateX(-50%)"
                  : "translate(-50%, -100%)",
              backgroundColor: "hsl(0 0% 10%)",
              color: "hsl(0 0% 98%)",
              border: "1px solid hsl(0 0% 20%)",
              zIndex: 99999,
              top: `${coords.top}px`,
              left: `${coords.left}px`,
            }}
          >
            {content}
          </div>,
          document.body
        )}
    </>
  );
}
