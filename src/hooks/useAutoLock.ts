import { useEffect, useRef } from "react";
import { useStore } from "../store";

/// Locks the screen after `autoLockMinutes` of user inactivity — a no-op
/// unless a screen-lock PIN is configured (nothing to lock to otherwise).
/// Activity = mouse, keyboard, scroll, touch, focus events anywhere in the document.
/// The countdown resets on every event.
export function useAutoLock() {
  const settings = useStore((s) => s.settings);
  const status = useStore((s) => s.status);
  const lock = useStore((s) => s.lock);
  const lastActivity = useRef(Date.now());

  const active = !!status?.pin_set && !status?.locked;

  useEffect(() => {
    if (!active) return;
    const events: (keyof DocumentEventMap)[] = [
      "mousemove",
      "mousedown",
      "keydown",
      "scroll",
      "touchstart",
      "wheel",
    ];
    const onActivity = () => {
      lastActivity.current = Date.now();
    };
    events.forEach((e) => document.addEventListener(e, onActivity, { passive: true }));
    return () => {
      events.forEach((e) => document.removeEventListener(e, onActivity));
    };
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const minutes = settings?.auto_lock_minutes ?? 5;
    const ms = minutes * 60_000;
    const t = setInterval(() => {
      if (Date.now() - lastActivity.current >= ms) {
        lock();
      }
    }, 5_000);
    return () => clearInterval(t);
  }, [active, settings?.auto_lock_minutes, lock]);
}
