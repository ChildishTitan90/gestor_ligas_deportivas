import "next-auth";
import "next-auth/jwt";
import type { AuthIdentity } from "@/features/auth/types";

declare module "next-auth" {
  interface Session {
    user?: AuthIdentity;
  }
  interface User {
    userVersion: number;
    mustChangePassword: boolean;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userVersion?: number;
    mustChangePassword?: boolean;
    sid?: string;
    idleExpiresAt?: number;
  }
}
