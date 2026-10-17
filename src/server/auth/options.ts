import "server-only";
import { getIdleTimeoutMs } from "./session-policy";
import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import { authorizeCredentials } from "./credentials";
import { refreshIdentityToken } from "./token";
import {
  createPersistentSession,
  revokePersistentSession,
} from "./session-store";

export function getAuthOptions(): NextAuthOptions {
  const secret = process.env.NEXTAUTH_SECRET;

  if (
    !secret ||
    secret.length < 32 ||
    secret.startsWith("REEMPLAZAR")
  ) {
    throw new Error(
      "NEXTAUTH_SECRET debe ser un secreto generado de al menos 32 caracteres.",
    );
  }

  return {
    secret,
    debug: false,

    // Duración técnica de la cookie/JWT.
    // La inactividad se verifica por separado en PostgreSQL.
    session: {
      strategy: "jwt",
      maxAge: getIdleTimeoutMs() / 1000,
    },

    pages: {
      signIn: "/login",
      error: "/login",
    },

    providers: [
      CredentialsProvider({
        name: "Correo y contraseña",
        credentials: {
          email: {
            label: "Correo electrónico",
            type: "email",
          },
          password: {
            label: "Contraseña",
            type: "password",
          },
        },
        authorize: authorizeCredentials,
      }),
    ],

    callbacks: {
      async jwt({ token, user }) {
        if (user) {
          const sid = await createPersistentSession(
            user.id,
            user.userVersion,
          );

          if (!sid) return {};

          return refreshIdentityToken({
            sub: user.id,
            userVersion: user.userVersion,
            mustChangePassword: user.mustChangePassword,
            sid,
          });
        }

        // No aceptar identidad ni permisos enviados con update().
        return refreshIdentityToken(token);
      },

      async session({ session, token }) {
        return {
          expires:
            typeof token.idleExpiresAt === "string"
              ? token.idleExpiresAt
              : session.expires,

          // No exponer sid en la sesión pública.
          user: token.sub
            ? {
                id: token.sub,
                mustChangePassword:
                  token.mustChangePassword !== false,
              }
            : undefined,
        };
      },

      async redirect({ url, baseUrl }) {
        try {
          const target = new URL(url, baseUrl);

          return target.origin === new URL(baseUrl).origin
            ? target.href
            : `${baseUrl}/access`;
        } catch {
          return `${baseUrl}/access`;
        }
      },
    },

    events: {
      async signOut({ token }) {
        // No ocultar un fallo de revocación como cierre exitoso.
        await revokePersistentSession(token?.sid);
      },
    },

    logger: {
      error() {
        console.error("[auth] AUTH_ERROR");
      },
      warn() {
        console.warn("[auth] AUTH_WARNING");
      },
      debug() {},
    },
  };
}