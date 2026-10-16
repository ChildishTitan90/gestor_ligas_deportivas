"use client";

import { useEffect, useState } from "react";

export function SessionActivity() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    let stopped = false;
    let busy = false;
    let lastAttempt = -Infinity;
    let expirationTimer: ReturnType<typeof setTimeout> | undefined;

    const controller = new AbortController();

    function goToLogin() {
      if (stopped) return;

      window.location.replace("/login?reason=session-expired");
    }

    async function checkSession() {
      const response = await fetch("/api/auth/session", {
        credentials: "same-origin",
        cache: "no-store",
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error("SESSION_UNAVAILABLE");
      }

      const session = await response.json();

      if (stopped) return;

      if (!session?.user?.id) {
        goToLogin();
        return;
      }

      const expiration = Date.parse(session.expires);

      if (!Number.isFinite(expiration)) {
        throw new Error("INVALID_EXPIRATION");
      }

      if (expirationTimer !== undefined) {
        clearTimeout(expirationTimer);
      }

      // El temporizador solo comprueba: no renueva actividad.
      expirationTimer = setTimeout(() => {
        void verifySession();
      }, Math.min(
        Math.max(expiration - Date.now(), 100),
        2_147_483_647,
      ));

      setMessage("");
    }

    async function verifySession() {
      try {
        await checkSession();
      } catch {
        if (!stopped) {
          setMessage(
            "No pudimos comprobar tu sesión. Revisa tu conexión.",
          );
        }
      }
    }

    async function renewActivity() {
      if (
        stopped ||
        busy ||
        document.visibilityState !== "visible"
      ) {
        return;
      }

      const now = performance.now();

      // Evitar una petición por cada tecla durante escritura rápida.
      if (now - lastAttempt < 1000) return;

      lastAttempt = now;
      busy = true;

      try {
        const response = await fetch("/api/session/activity", {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          headers: {
            "X-Session-Activity": "interaction",
          },
          signal: controller.signal,
        });

        if (stopped) return;

        if (response.status === 401) {
          goToLogin();
          return;
        }

        if (!response.ok) {
          throw new Error("ACTIVITY_UNAVAILABLE");
        }

        // NextAuth actualiza la cookie. Esta consulta, por sí sola,
        // no modifica last_activity_at en PostgreSQL.
        await checkSession();
      } catch {
        if (!stopped) {
          setMessage(
            "No pudimos renovar tu sesión. Revisa tu conexión.",
          );
        }
      } finally {
        busy = false;
      }
    }

    function handleInteraction(event: Event) {
      if (!event.isTrusted) return;

      void renewActivity();
    }

    function handleVisibility() {
      if (document.visibilityState === "visible") {
        void verifySession();
      }
    }

    document.addEventListener("pointerdown", handleInteraction);
    document.addEventListener("keydown", handleInteraction);
    document.addEventListener("input", handleInteraction);
    document.addEventListener(
      "visibilitychange",
      handleVisibility,
    );
    window.addEventListener("online", verifySession);

    // Validación inicial sin renovar actividad.
    void verifySession();

    return () => {
      stopped = true;
      controller.abort();

      if (expirationTimer !== undefined) {
        clearTimeout(expirationTimer);
      }

      document.removeEventListener(
        "pointerdown",
        handleInteraction,
      );
      document.removeEventListener("keydown", handleInteraction);
      document.removeEventListener("input", handleInteraction);
      document.removeEventListener(
        "visibilitychange",
        handleVisibility,
      );
      window.removeEventListener("online", verifySession);
    };
  }, []);

  if (!message) return null;

  return (
    <p
      role="status"
      className="mb-4 rounded-xl border border-border bg-surface p-3 text-sm text-muted"
    >
      {message}
    </p>
  );
}