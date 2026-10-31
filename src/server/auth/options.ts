import "server-only";

import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authorizeCredentials } from "./credentials";
import { refreshIdentityToken } from "./token";
import { createIdentityToken, revokeIdentityToken } from "./persistent-session";
import { getIdleTimeoutSeconds } from "./idle-policy";

/** Evaluar en la petición: compilar no necesita secretos ni una base disponible. */
export function getAuthOptions(): NextAuthOptions {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret || secret.length < 32 || secret.startsWith("REEMPLAZAR")) {
    throw new Error("NEXTAUTH_SECRET debe ser un secreto generado de al menos 32 caracteres.");
  }

  return {
    secret,
    debug: false,
    // Conservar cookies HttpOnly/SameSite=lax, CSRF y JWE de NextAuth 4.
    // Secure se activa automáticamente con NEXTAUTH_URL HTTPS.
    // Vigencia técnica de la cookie; la actividad real se verifica en PostgreSQL.
    // updateAge no se aplica a la estrategia JWT de NextAuth 4.
    session: { strategy: "jwt", maxAge: getIdleTimeoutSeconds() },
    pages: { signIn: "/login", error: "/login" },
    providers: [
      CredentialsProvider({
        name: "Correo y contraseña",
        credentials: {
          email: { label: "Usuario o correo electrónico", type: "text" },
          password: { label: "Contraseña", type: "password" },
        },
        authorize: authorizeCredentials,
      }),
    ],
    callbacks: {
      async jwt({ token, user, trigger, session }) {
        if (user) return createIdentityToken(user);
        // update() pasa por el CSRF de NextAuth. Solo se admite esta intención;
        // identidad, fechas, versión y estado siempre proceden del servidor.
        const activity = trigger === "update" && session?.action === "activity";
        return refreshIdentityToken(token, activity);
      },
      async session({ session, token }) {
        return {
          expires: token.sub && token.idleExpiresAt
            ? new Date(token.idleExpiresAt).toISOString() : session.expires,
          user: token.sub ? { id: token.sub, mustChangePassword: token.mustChangePassword !== false } : undefined,
        };
      },
      async redirect({ url, baseUrl }) {
        // No seguir callbackUrl a otro origen, incluso con un formulario manipulado.
        try {
          const target = new URL(url, baseUrl);
          return target.origin === new URL(baseUrl).origin ? target.href : `${baseUrl}/access`;
        } catch {
          return `${baseUrl}/access`;
        }
      },
    },
    events: {
      async signOut({ token }) {
        await revokeIdentityToken(token);
      },
    },
    logger: {
      // Solo códigos controlados; nunca metadata/error con credenciales o SQL.
      error() { console.error("[auth] AUTH_ERROR"); },
      warn() { console.warn("[auth] AUTH_WARNING"); },
      debug() {},
    },
  };
}
