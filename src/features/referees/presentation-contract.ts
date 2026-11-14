import { z } from "zod";
const name=z.string().trim().min(1).max(80);
const base={operationKey:z.uuid(),reason:z.string().trim().min(5).max(500)};
export const presentationMutation=z.discriminatedUnion("kind",[
  z.strictObject({...base,kind:z.literal("submit"),clubId:z.uuid(),seasonId:z.uuid(),candidate:z.discriminatedUnion("mode",[
    z.strictObject({mode:z.literal("existing"),personId:z.uuid()}),
    z.strictObject({mode:z.literal("new"),firstName:name,paternalSurname:name,maternalSurname:z.string().trim().max(80)}),
  ])}),
  z.strictObject({...base,kind:z.enum(["accept","reject"]),presentationId:z.uuid(),expectedVersion:z.number().int().positive(),personId:z.uuid().optional(),expectedIdentityVersion:z.number().int().positive().optional(),confirmNewPerson:z.boolean().default(false)}),
]);
export type PresentationMutation=z.infer<typeof presentationMutation>;
export type PresentationRow={id:string;clubId:string;club:string;seasonId:string;season:string;status:"PENDING"|"APPROVED"|"REJECTED";version:number;name:string;reason:string;requester:string;createdAt:string;reviewer:string|null;reviewReason:string|null;personId:string|null;approvedPersonId:string|null;approvedName:string|null;refereeId:string|null};
export type PresentationWorkspace={actorId:string;clubs:{id:string;name:string;seasonId:string;season:string;leagueId:string;league:string;timezone:string;canSubmit:boolean;canReview:boolean;canProvisionAccess:boolean;closed:boolean;teams:number;presented:number;pending:number}[];rows:PresentationRow[];people:{id:string;label:string;clubContexts:string[];leagueIds:string[];identityVersion:number}[]};
export const presentationMessages:Record<string,string>={
  INVALID_PAYLOAD:"Revisa los datos y el motivo.",FORBIDDEN:"No tienes permiso para ese club o temporada.",
  CLOSED_CONTEXT:"La temporada está cerrada.",STALE_VERSION:"La solicitud cambió. Cierra y vuelve a abrir para consultar su estado.",
  PRESENTING_CLUB_FIXED:"El árbitro ya está vinculado a otro club en esa temporada. No se sustituye el club de origen.",
  PERSON_MATCH_REQUIRES_REVIEW:"Hay una coincidencia de identidad que debe revisarse. Selecciona la persona existente si está autorizada; no se creó otra persona.",
  PERSON_CONFIRMATION_REQUIRED:"Selecciona una persona existente o confirma expresamente que se trata de una persona nueva.",
  IDENTITY_CHANGED:"La identidad seleccionada cambió. Consulta la información actual antes de incorporarla.",
  ALREADY_PRESENTED:"Esta persona ya está presentada o tiene una solicitud pendiente en la temporada.",
  OPERATION_KEY_REUSED:"La clave ya corresponde a otra solicitud. Consulta su acuse original.",
};
