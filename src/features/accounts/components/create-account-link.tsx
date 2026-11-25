import { ActionLink } from "@/components/ui/action-link";

export function CreateAccountLink({ search, page, pageSize }: {
  search: string;
  page?: number;
  pageSize?: number;
}) {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (page && page !== 1) params.set("page", String(page));
  if (pageSize && pageSize !== 20) params.set("pageSize", String(pageSize));
  return <ActionLink href={params.size ? `/accounts/new?${params}` : "/accounts/new"}>Crear cuenta</ActionLink>;
}
