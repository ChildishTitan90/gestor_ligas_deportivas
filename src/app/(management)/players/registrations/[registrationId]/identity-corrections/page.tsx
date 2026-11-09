import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthAccessError, requireOperationalUser } from "@/server/auth/session";
import { AuthorizationError } from "@/server/auth/authorization";
import { correctionWorkspaceForActor } from "@/features/players/server/identity-correction";
import { IdentityCorrectionWorkspace } from "@/features/players/components/identity-correction-workspace";
export const metadata = { title: "Corrección de identidad deportiva" };
export default async function Page({ params }: {
    params: Promise<{
        registrationId: string;
    }>;
}) {
    let data:Awaited<ReturnType<typeof correctionWorkspaceForActor>>|undefined;
    let actorId="";
    try {
        const actor = await requireOperationalUser();
        data = await correctionWorkspaceForActor(actor.id, (await params).registrationId);
        actorId=actor.id;

    }
    catch (error) {
        if (error instanceof AuthAccessError)
            redirect(error.code === "PASSWORD_CHANGE_REQUIRED" ? "/change-password" : "/login");
        if (!(error instanceof AuthorizationError))
            throw error;
    }
    if(data)return <IdentityCorrectionWorkspace key={`${actorId}:${data.registrationId}`} data={data} actorId={actorId}/>;
    return <section className="space-y-4"><h1 className="text-2xl font-semibold">Corrección de identidad deportiva</h1><p role="alert">La solicitud no está disponible o tu cuenta no tiene permiso para consultarla.</p><Link href="/players/registrations" className="underline">Volver a jugadores</Link></section>;
}
