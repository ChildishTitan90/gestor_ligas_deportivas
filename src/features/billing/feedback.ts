export const billingMessages: Record<string, string> = {
  INVALID_INPUT: "Revisa el importe y las fechas antes de enviar.",
  FORBIDDEN: "Tu cuenta ya no tiene permiso para esta operación. Vuelve a consultar el contexto.",
  CONTEXT_CHANGED: "El contexto cambió. Vuelve a consultar antes de crear un cargo.",
  INVALID_DUE_DATE: "El vencimiento debe ser igual o posterior a la emisión del cargo.",
  INVALID_PERIOD: "El periodo debe quedar dentro de la ventana del plan semanal.",
  DUPLICATE_CHARGE: "Ya hay un cargo para este concepto, destinatario y periodo con otros datos. Consulta su detalle.",
  OPERATION_KEY_REUSED: "La clave de este intento corresponde a otros datos. Consulta el resultado original.",
  VERSION_CONFLICT: "Otra persona modificó el cargo. Vuelve a consultar su versión antes de corregirlo.",
  CHARGE_HAS_PAYMENTS: "El cargo tiene pagos asociados. Su modificación requiere acordar el tratamiento con PDGLD-78.",
  RESOLUTION_UNAVAILABLE: "La multa requiere el contrato de resolución oficial de PDGLD-27.",
  POLICY_UNCONFIRMED: "Esta modificación necesita una decisión pendiente de la Liga.",
};
