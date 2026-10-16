"use client";

import { useEffect, useRef } from "react";
import { SessionProvider, useSession } from "next-auth/react";

const ACTIVITY_INTERVAL_MS = 15_000;
const activityEvents = ["pointerdown", "click", "keydown", "wheel", "touchstart"] as const;

function ActivityMonitor() {
  const { data: session, status, update } = useSession();
  const wasAuthenticated = useRef(false);
  const lastSentAt = useRef(0);
  const retryAfter = useRef(0);
  const pending = useRef(false);

  useEffect(() => {
    if (status === "loading") return;
    if (!session?.user) {
      if (wasAuthenticated.current) window.location.replace("/login");
      return;
    }
    wasAuthenticated.current = true;
    const expiresAt = Date.parse(session.expires);
    let activityTimer: ReturnType<typeof setTimeout> | undefined;

    async function checkSession(activity: boolean) {
      if (pending.current) return;
      pending.current = true;
      if (activity) lastSentAt.current = Date.now();
      try {
        // POST de NextAuth con CSRF. Sin action no se actualiza la actividad.
        const current = await update(activity ? { action: "activity" } : undefined);
        if (current && !current.user) window.location.replace("/login");
        if (current === null) {
          // NextAuth devuelve null tanto al perder la red como al desaparecer
          // la cookie vencida. Confirmar por HTTP antes de abandonar la página.
          const response = await fetch("/api/auth/session", { cache: "no-store" });
          if (response.ok && !(await response.json())?.user) window.location.replace("/login");
        }
        retryAfter.current = current ? 0 : Date.now() + ACTIVITY_INTERVAL_MS;
      } catch {
        retryAfter.current = Date.now() + ACTIVITY_INTERVAL_MS;
      } finally {
        pending.current = false;
      }
    }

    function onActivity(event: Event) {
      if (!event.isTrusted || document.visibilityState !== "visible") return;
      if (Date.now() >= expiresAt) {
        void checkSession(false);
        return;
      }
      if (activityTimer) clearTimeout(activityTimer);
      const remaining = lastSentAt.current + ACTIVITY_INTERVAL_MS - Date.now();
      if (remaining <= 0) void checkSession(true);
      else {
        // Solo programar un envío si hubo una acción real. No hay heartbeat.
        activityTimer = setTimeout(() => {
          if (document.visibilityState === "visible") void checkSession(true);
        }, remaining);
      }
    }

    function onVisibility() {
      if (document.visibilityState === "visible") void checkSession(false);
    }

    // Consultar de nuevo antes de salir: otra pestaña pudo registrar actividad.
    const expiryTimer = setTimeout(() => void checkSession(false),
      Math.max(expiresAt - Date.now(), retryAfter.current - Date.now(), 100));
    for (const event of activityEvents) document.addEventListener(event, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    return () => {
      clearTimeout(expiryTimer);
      if (activityTimer) clearTimeout(activityTimer);
      for (const event of activityEvents) document.removeEventListener(event, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
    };
  }, [session, status, update]);

  return null;
}

export function SessionActivity() {
  return (
    <SessionProvider refetchInterval={0} refetchOnWindowFocus={false}>
      <ActivityMonitor />
    </SessionProvider>
  );
}
