"use client";

import { getCsrfToken } from "next-auth/react";

/** NextAuth 4 puede redirigir aunque el servidor rechace el cierre; comprobarlo explícitamente. */
export async function signOutCurrentSession() {
  const csrfToken = await getCsrfToken();
  if (!csrfToken) throw new Error("SIGNOUT_FAILED");
  const response = await fetch("/api/auth/signout", {
    method: "POST", credentials: "same-origin", cache: "no-store",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ csrfToken, callbackUrl: "/login", json: "true" }),
  });
  if (!response.ok) throw new Error("SIGNOUT_FAILED");
}
