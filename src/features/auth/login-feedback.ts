export type LoginFeedback = { title: string; description: string };

/** Contrato público controlado: solo política y minutos restantes, nunca datos de la cuenta. */
export function loginLockoutCode(attempts: number, remainingMs: number) {
  return `LOGIN_LOCKED_${attempts}_${Math.max(1, Math.ceil(remainingMs / 60_000))}`;
}

export function getLoginFeedback(code: string | null | undefined): LoginFeedback {
  const match = /^LOGIN_LOCKED_([1-9]\d?)_([1-9]\d{0,3})$/.exec(code ?? "");
  if (match && Number(match[1]) <= 20 && Number(match[2]) <= 1440) {
    const attempts = Number(match[1]);
    const minutes = Number(match[2]);
    return {
      title: "Acceso bloqueado temporalmente",
      description: `Por seguridad, el acceso se bloquea tras ${attempts} ${attempts === 1 ? "intento fallido" : "intentos fallidos"}. Espera aproximadamente ${minutes} ${minutes === 1 ? "minuto" : "minutos"} antes de volver a intentarlo. Los intentos durante el bloqueo no prolongan este plazo.`,
    };
  }
  if (code === "CredentialsSignin") return {
    title: "Datos de acceso incorrectos",
    description: "Revisa tu usuario o correo y tu contraseña. Si necesitas ayuda para acceder, comunícate con la administración de la liga.",
  };
  return {
    title: "No pudimos conectar con el servicio",
    description: "Inténtalo de nuevo en unos momentos. Si el problema continúa, comunícate con la administración de la liga.",
  };
}
