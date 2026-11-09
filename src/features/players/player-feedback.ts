import { ageExceptionMessages } from "./age-exception";
export const playerErrorMessages: Record<string, string> = {
  ...ageExceptionMessages,
  UNAUTHENTICATED: "Tu sesión terminó. Vuelve a iniciar sesión.",
  PASSWORD_CHANGE_REQUIRED: "Debes cambiar tu contraseña antes de continuar.",
  FORBIDDEN: "Tu cuenta ya no tiene permiso para esta operación. Consulta nuevamente con tu sesión actual.",
  VALIDATION_ERROR: "Revisa los datos capturados antes de continuar.",
  IDENTITY_UNAVAILABLE: "No es posible reutilizar esa identidad con los datos o permisos actuales. Solicita revisión a Secretaría.",
  REGISTRATION_CONFLICT: "No se pudo completar el alta: existe una inscripción incompatible. Consulta los registros antes de reintentar.",
  REGISTRATION_WINDOW_CLOSED: "El alta está fuera de los días permitidos para la categoría y temporada, según su zona horaria configurada.",
  PLAYER_POLICY_PENDING: "Falta completar una política deportiva válida para la categoría y temporada. Solicita su revisión.",
  AGE_OUTSIDE_RANGE: "La edad por año de nacimiento está fuera del rango configurado para esta categoría.",
  AGE_EXCEPTION_REQUIRED: "La edad requiere una excepción autorizada. Una carta por sí sola no aprueba el alta; solicita revisión.",
  TEAM_CHANGE_NOT_ALLOWED: "No se permite cambiar de equipo después del inicio de la competencia.",
  CONTEXT_NOT_AVAILABLE: "El equipo, la afiliación o la temporada ya no permiten registrar jugadores.",
  USAGE_LIMIT_REACHED: "Se alcanzó el límite de consultas o debes esperar un minuto entre intentos de esta persona.",
  IDENTITY_CHANGED: "Los datos del jugador cambiaron. Consulta el estado actual antes de verificar.",
  OPERATION_CONFLICT: "El intento no corresponde a los datos actuales. Consulta su estado antes de continuar.",
  RETRY_CONFIRMATION_REQUIRED: "La consulta anterior pudo tener un cobro. Revisa el resultado antes de decidir una nueva consulta.",
};

export const curpStatusLabels: Record<string, string> = {
  NOT_PERFORMED: "Sin consulta externa", NOT_CONFIGURED: "Proveedor no configurado",
  PENDING: "Consulta pendiente de respuesta", VERIFIED: "Datos coincidentes con CURP",
  DISCREPANCY: "Los datos no coinciden; requieren revisión", NOT_FOUND: "Consulta sin resultado",
  INVALID_CREDENTIALS: "Acceso al proveedor no disponible", INSUFFICIENT_BALANCE: "Saldo insuficiente en el proveedor",
  UNAVAILABLE: "Proveedor temporalmente no disponible", UNEXPECTED_RESPONSE: "Respuesta del proveedor no reconocida",
  UNCERTAIN: "Resultado y posible cobro sin confirmar", STALE: "Comprobación invalidada por cambio de datos",
};
