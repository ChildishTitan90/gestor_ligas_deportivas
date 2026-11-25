import {notFound} from "next/navigation";
import {ManagementPageHeader} from "@/components/layout/management-page-header";
import {ConfigurationForm} from "@/features/competitions/components/configuration-form";
import {DocumentPolicyFields} from "@/features/competitions/components/document-policy-fields";
import {getPlayerConfigurationWorkspace} from "@/features/competitions/server/player-configuration-queries";
export const metadata={title:"Política documental de categoría"};
export default async function Page({params}:{params:Promise<{id:string;participationId:string}>}){
  const {id,participationId}=await params,data=await getPlayerConfigurationWorkspace(id);
  const category=data.categories.find(row=>row.id===participationId);
  if(!category)notFound();
  return <section className="mx-auto w-full max-w-4xl space-y-6">
    <ManagementPageHeader title="Política documental"
      description="Define qué documentos admite el expediente y cuáles deben aprobarse antes de habilitar al jugador."
      back={{ href: `/competitions/seasons/${id}#category-${participationId}`, label: "Volver a la categoría" }}
      context={[{ label: "Temporada", value: data.season.name }, { label: "Categoría", value: category.name }]} />
    {!category.policy?<p role="status" className="rounded-xl border border-border bg-surface p-5">Primero configura las reglas deportivas de esta categoría desde la temporada. No se asignarán edades ni cupos por defecto.</p>:
      <ConfigurationForm key={`${category.id}:${data.season.version}`} title="Guardar política documental" endpoint={`/api/competitions/seasons/${id}/categories/${category.id}/player-policy`} method="PATCH" version={data.season.version} actorId={data.actorId} disabled={!data.canEdit}>
        {!data.canEdit && <p role="status">Consulta de la configuración. La temporada ya no permite modificar sus reglas.</p>}
        <fieldset disabled={!data.canEdit}><DocumentPolicyFields sportPolicy={category.policy} type={category.type} canApprove={data.canApprove}/></fieldset>
      </ConfigurationForm>}
  </section>;
}
