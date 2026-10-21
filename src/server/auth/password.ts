import "server-only";

import { randomBytes } from "node:crypto";
import * as argon2 from "argon2";

const hashOptions = { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;
let dummyHash: Promise<string> | undefined;

/** Formato acordado para provisión/cambio. Nunca devolver este resultado a la UI. */
export function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, hashOptions);
}

export async function verifyPassword(hash: string | null, password: string): Promise<boolean> {
  // Ejecutar también el KDF para cuentas ausentes/formatos desconocidos.
  const supported = !!hash?.startsWith("$argon2id$");
  dummyHash ??= argon2.hash(randomBytes(32), hashOptions);
  try {
    const valid = await argon2.verify(supported ? hash! : await dummyHash, password);
    return supported && valid;
  } catch {
    return false;
  }
}
