"use client";

import { getCsrfToken } from "next-auth/react";

let pendingSignOut: Promise<void> | null = null;

/** Los dos accesos de salida comparten una sola petición mientras está pendiente. */
export function signOutCurrentSession(): Promise<void> {
  pendingSignOut ??= performSignOut().finally(() => { pendingSignOut = null; });
  return pendingSignOut;
}

/** NextAuth 4 puede redirigir aunque el servidor rechace el cierre; comprobarlo explícitamente. */
async function performSignOut() {
  const csrfToken = await getCsrfToken();
  if (!csrfToken) throw new Error("SIGNOUT_FAILED");
  const response = await fetch("/api/auth/signout", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, callbackUrl: "/login", json: "true" }),
  });
  if (!response.ok) throw new Error("SIGNOUT_FAILED");
}
