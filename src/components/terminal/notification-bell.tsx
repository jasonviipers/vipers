"use client";

import { useEffect, useRef, useState } from "react";
import {
  NotificationBadgeIcon,
  NotificationsList,
} from "@/components/terminal/notifications-list";
import { useNotifications } from "@/hooks/use-notifications";

/**
 * Header notification bell (desktop + tablet).
 *
 * Thin wrapper around the shared notifications hook and list panel: button
 * with unread badge, click-outside/Escape dismissal, accessible expanded
 * state. On mobile (<md) the bottom nav's NOTIFS tab takes over and this
 * renders nothing, mirroring how ActiveBrokerSwitcher yields to the MORE
 * panel.
 */
export function NotificationBell() {
  const { unreadCount } = useNotifications();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const bellButtonRef = useRef<HTMLButtonElement>(null);

  // Click-outside + Escape dismissal.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        bellButtonRef.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative hidden md:block">
      <button
        ref={bellButtonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={
          unreadCount > 0
            ? `Notifications, ${unreadCount} unread`
            : "Notifications"
        }
        aria-haspopup="true"
        aria-expanded={open}
        title="Notifications"
        className={`relative flex items-center justify-center border border-transparent p-2 transition-colors ${
          open
            ? "border-terminal-green/30 bg-secondary text-terminal-green"
            : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
        }`}
      >
        <NotificationBadgeIcon size="sm" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notifications"
          className="absolute top-full right-0 z-50 mt-2 w-80 max-w-[calc(100vw-2rem)] border border-border bg-card shadow-lg shadow-black/40"
        >
          <NotificationsList maxHeight="20rem" />
        </div>
      )}
    </div>
  );
}
