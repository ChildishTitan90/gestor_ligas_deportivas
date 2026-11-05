import type { CategoryDocumentPolicy } from "../../src/features/competitions/document-policy";

/** Política aprobada SOLO en el fixture sintético. No configura categorías reales. */
export function syntheticDocumentPolicy(): CategoryDocumentPolicy {
  return { version: 1, profile: "GENERAL", status: "APPROVED", pendingDecisions: [], activation: "VERIFIED_ADULT_CURP", requirements: [
    { key: "CURP", audience: "ADULTS", anyOf: ["CURP"], quantity: 1, requiredForDossier: true, requiredForEligibility: false },
    { key: "CURP", audience: "MINORS", anyOf: ["CURP"], quantity: 1, requiredForDossier: true, requiredForEligibility: true },
    { key: "PLAYER_PHOTO", audience: "ALL", anyOf: ["PHOTO"], quantity: 1, requiredForDossier: false, requiredForEligibility: false },
    { key: "SCHOOL_EVIDENCE", audience: "MINORS", anyOf: ["STUDENT_ID", "STUDENT_CERTIFICATE"], quantity: 1, requiredForDossier: true, requiredForEligibility: true },
    { key: "GUARDIAN_CONSENT", audience: "MINORS", anyOf: ["GUARDIAN_CONSENT"], quantity: 1, requiredForDossier: true, requiredForEligibility: true },
    { key: "PHOTO_IDENTIFICATION", audience: "ADULTS", anyOf: ["INE", "DRIVER_LICENSE", "PASSPORT"], quantity: 1, requiredForDossier: false, requiredForEligibility: false },
  ] };
}

export function syntheticPlayerPolicy(documents=syntheticDocumentPolicy()) {
  return { referenceYear: 2026, minimumAge: 0, maximumAge: null, exceptionMinimumAge: null, documents, registrationDays: [1,2,3], timezone: "America/Mexico_City", playersOnField: 11, maximumCalledUp: null, maximumRoster: null };
}
