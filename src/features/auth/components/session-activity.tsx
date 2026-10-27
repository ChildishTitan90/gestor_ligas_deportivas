"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { isTeamRegistrationPreview } from "@/lib/development-preview";

const ACTIVITY_INTERVAL_MS = 15_000;
const activityEvents = ["pointerdown", "click", "keydown", "wheel", "touchstart", "input"] as const;

/** Un solo monitor global: las páginas públicas sin sesión no provocan redirecciones. */
export function SessionActivity() {
  const pathname = usePathname();
  const router = useRouter();
  const [message, setMessage] = useState("");
  const wasAuthenticated = useRef(false);
  const lastSessionState = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    // Preview sintética local: no iniciar lecturas ni actividad de sesión.
    // La página usa la misma guarda y responde 404 fuera de development.
    if (isTeamRegistrationPreview(pathname, process.env.NODE_ENV)) return;
    let stopped = false;
    let busy = false;
    let expiresAt = 0;
    let lastActivitySent = -Infinity;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    let activityTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    function scheduleCheck(delay: number) {
      if (expiryTimer) clearTimeout(expiryTimer);
      expiryTimer = setTimeout(() => void checkSession(false), Math.min(Math.max(delay, 100), 2_147_483_647));
    }

    async function checkSession(activity: boolean) {
      if (stopped || busy) return;
      busy = true;
      try {
        let init: RequestInit = {};
        if (activity) {
          lastActivitySent = Date.now();
          // Compartir la cancelación del efecto también con la lectura CSRF.
          const csrfResponse = await fetch("/api/auth/csrf", {
            credentials: "same-origin", cache: "no-store", signal: controller.signal,
          });
          if (!csrfResponse.ok) throw new Error("SESSION_UNAVAILABLE");
          const { csrfToken } = await csrfResponse.json();
          if (stopped) return;
          if (typeof csrfToken !== "string" || !csrfToken) throw new Error("SESSION_UNAVAILABLE");
          // Mantener el contrato de develop: NextAuth verifica CSRF y emite la cookie.
          init = { method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ csrfToken, data: { action: "activity" } }) };
        }
        const response = await fetch("/api/auth/session", {
          ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal,
        });
        if (!response.ok) throw new Error("SESSION_UNAVAILABLE");
        const session = await response.json();
        if (stopped) return;
        const publicPage = ["/", "/futbol", "/login"].includes(window.location.pathname);
        const sessionState = session?.user?.id ? `${session.user.id}:${Boolean(session.user.mustChangePassword)}` : null;
        const changed = lastSessionState.current !== undefined && lastSessionState.current !== sessionState;
        lastSessionState.current = sessionState;
        // Actualizar la identidad renderizada si cambia la cuenta en otra pestaña
        // o vence la sesión pública; conservar al espectador en el portal.
        if (changed && (sessionState !== null || publicPage)) router.refresh();
        if (!session?.user?.id) {
          if (expiryTimer) clearTimeout(expiryTimer);
          if (activityTimer) clearTimeout(activityTimer);
          // Solo abandonar una sesión que este monitor había visto autenticada.
          // Un espectador puede seguir en el portal si su sesión anterior vence.
          if (wasAuthenticated.current && !publicPage) window.location.replace("/login");
          wasAuthenticated.current = false;
          return;
        }
        const expiration = Date.parse(session.expires);
        if (!Number.isFinite(expiration)) throw new Error("SESSION_UNAVAILABLE");
        wasAuthenticated.current = true;
        expiresAt = expiration;
        setMessage("");
        // Consultar al vencer permite observar actividad legítima de otra pestaña.
        scheduleCheck(expiresAt - Date.now());
      } catch {
        if (!stopped && wasAuthenticated.current) {
          setMessage("No pudimos comprobar tu sesión. Revisa tu conexión; volveremos a intentarlo.");
          scheduleCheck(ACTIVITY_INTERVAL_MS); // Reintento de lectura, nunca heartbeat.
        }
      } finally {
        busy = false;
      }
    }

    function onActivity(event: Event) {
      if (!event.isTrusted || !wasAuthenticated.current || document.visibilityState !== "visible") return;
      if (Date.now() >= expiresAt) { void checkSession(false); return; }
      if (activityTimer) clearTimeout(activityTimer);
      const remaining = lastActivitySent + ACTIVITY_INTERVAL_MS - Date.now();
      if (remaining <= 0) void checkSession(true);
      else activityTimer = setTimeout(() => {
        if (document.visibilityState === "visible") void checkSession(Date.now() < expiresAt);
      }, remaining);
    }
    function onVisibility() {
      if (document.visibilityState === "visible") void checkSession(false);
    }

    for (const event of activityEvents) document.addEventListener(event, onActivity, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("focus", onVisibility);
    window.addEventListener("online", onVisibility);
    void checkSession(false);
    return () => {
      stopped = true;
      controller.abort();
      if (expiryTimer) clearTimeout(expiryTimer);
      if (activityTimer) clearTimeout(activityTimer);
      for (const event of activityEvents) document.removeEventListener(event, onActivity);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("focus", onVisibility);
      window.removeEventListener("online", onVisibility);
    };
  // El layout conserva el ref entre rutas; cada navegación consulta la sesión.
  // Esta lectura no renueva la actividad y detecta una sesión que ya venció.
  }, [pathname, router]);

  return message ? <p role="status" className="p-3 text-sm text-muted">{message}</p> : null;
}
