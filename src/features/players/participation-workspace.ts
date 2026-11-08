import {z} from "zod";
import type {EligibilityAssessment} from "./category-participation";
import type {PlayerReviewLabels} from "./review-workspace";

export const participationReceiptSchema=z.object({id:z.uuid(),originRegistrationId:z.uuid(),targetSeasonTeamId:z.uuid(),targetSeasonCategoryId:z.uuid(),status:z.enum(["PENDING_ELIGIBILITY","AUTHORIZED","WITHDRAWN"]),version:z.number().int().positive(),sportsEligible:z.boolean(),replayed:z.boolean()});
export type ParticipationWorkspace={
  actorId:string;registrationId:string;player:PlayerReviewLabels;
  source:{status:string;pathwayCode:string|null;level:number|null;canApprove:boolean;assessment:EligibilityAssessment|null};
  canRequest:boolean;targets:{targetId:string;targetTeam:string;targetCategory:string;targetCategoryId:string}[];
  participations:(z.infer<typeof participationReceiptSchema>&{assessment?:EligibilityAssessment;targetId:string;targetTeam:string;targetCategory:string;targetCategoryId:string;canReview:boolean})[];
};
export type ParticipationDirectory={actorId:string;rows:(PlayerReviewLabels&{status:string;pending:number;authorized:number;withdrawn:number})[]};
export const participationMessages:Record<string,string>={
  FORBIDDEN:"Tu cuenta no tiene permiso para esta operación en el contexto del jugador.",UNAUTHENTICATED:"Tu sesión terminó. Inicia sesión nuevamente.",
  ELIGIBILITY_NOT_READY:"Aún no se cumplen todas las condiciones para habilitar esta participación.",STALE_ELIGIBILITY:"Los datos o la revisión cambiaron. Consulta el estado antes de decidir de nuevo.",
  PARTICIPATION_CONFLICT:"La misma operación tiene otro contenido o ya existe una solicitud distinta para ese destino.",SUPERIOR_CATEGORY_REQUIRED:"El destino debe ser la categoría siguiente del orden para subir.",
  PATHWAY_NOT_CONFIGURED:"Administración debe configurar primero qué categorías permiten subir y en qué orden.",PLAYER_POLICY_PENDING:"Falta completar la política de jugadores de la categoría.",
  REGISTRATION_WINDOW_CLOSED:"Las solicitudes se registran de lunes a miércoles, conforme a la ventana de la categoría.",AGE_REQUIRES_REVIEW:"La edad no cumple el rango ordinario de origen o destino.",
  IDENTITY_REVIEW_REQUIRED:"Primero resuelve la posible coincidencia de identidad.",PARTICIPATION_BLOCKED:"Una sanción vigente impide la participación.",
  CONTEXT_NOT_AVAILABLE:"El estado del jugador, equipo o temporada no permite esta operación.",VALIDATION_ERROR:"Revisa el equipo y escribe un motivo de al menos 10 caracteres.",
};
