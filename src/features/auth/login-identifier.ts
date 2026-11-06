/** Revalidar tras el bloqueo; la búsqueda inicial pudo preceder a una edición. */
export function matchesLoginIdentifier(identifier: string, user: { username: string; email: string }) {
  const key = identifier.toLowerCase();
  return user.username.toLowerCase() === key || (key.includes("@") && user.email.toLowerCase() === key);
}
