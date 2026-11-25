import "server-only";
import { createSupabasePrivateDocumentStorage } from "@/server/files/private-document-storage";

export const VENUE_LOAN_LETTER_PREFIX = "venue-loan-letters";

export function createVenueLoanLetterStorage() {
  return createSupabasePrivateDocumentStorage({
    bucket: "cartas-prestamo-canchas",
    variable: "SUPABASE_VENUE_LOAN_LETTERS_BUCKET",
    prefix: VENUE_LOAN_LETTER_PREFIX,
    testFlag: "VENUE_LOAN_STORAGE_REAL_TEST",
  });
}
