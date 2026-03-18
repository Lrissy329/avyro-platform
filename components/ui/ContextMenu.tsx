import { useEffect, useMemo, useRef } from "react";

export type ContextMenuItem = {
  label: string;
  icon?: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
};

type ContextMenuProps = {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
};

export function ContextMenu({ open, x, y, items, onClose }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);

  const position = useMemo(() => {
    if (typeof window === "undefined") return { left: x, top: y };
    const menuWidth = 224;
    const menuHeight = items.length * 40 + 12;
    const maxLeft = window.innerWidth - menuWidth - 8;
    const maxTop = window.innerHeight - menuHeight - 8;
    return {
      left: Math.max(8, Math.min(x, maxLeft)),
      top: Math.max(8, Math.min(y, maxTop)),
    };
  }, [x, y, items.length]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (menuRef.current && menuRef.current.contains(event.target as Node)) return;
      onClose();
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const handleScroll = () => onClose();
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    document.addEventListener("scroll", handleScroll, true);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("scroll", handleScroll, true);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={menuRef}
      className="fixed z-50 w-56 rounded-xl border border-slate-200 bg-white p-1 shadow-lg"
      style={{ left: position.left, top: position.top }}
      role="menu"
    >
      {items.map((item, index) => (
        <button
          key={`${item.label}-${index}`}
          type="button"
          role="menuitem"
          disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.onClick();
            onClose();
          }}
          className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm transition ${
            item.danger
              ? "text-red-600 hover:bg-red-50"
              : "text-slate-700 hover:bg-slate-50"
          } ${item.disabled ? "cursor-not-allowed opacity-50" : ""}`}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
