import { AuthorizationError } from "@/server/auth/authorization";
import { VenueLoans } from "@/features/venues/components/venue-loans";
import { getVenueLoanWorkspace } from "@/features/venues/server/loan-workspace";

export const metadata = { title: "Préstamos de canchas" };

export default async function VenueLoansPage() {
  let workspace;
  try { workspace = await getVenueLoanWorkspace(); }
  catch (error) {
    if (error instanceof AuthorizationError) return <p role="alert">Tu cuenta no tiene acceso a préstamos de canchas.</p>;
    throw error;
  }
  return <VenueLoans workspace={workspace} />;
}
