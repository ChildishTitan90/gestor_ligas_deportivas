import { z } from 'zod';
const optionalId = z.preprocess(value => value === '' ? undefined : value, z.uuid().optional());
export const standingFiltersSchema = z.strictObject({
  competitionId: optionalId, seasonId: optionalId, categoryId: optionalId, groupId: optionalId, matchdayId: optionalId,
}).refine(value => (!value.seasonId || value.competitionId) && (!value.categoryId || value.seasonId) &&
  (!value.groupId || value.categoryId) && (!value.matchdayId || value.groupId), 'Selecciona el contexto completo.');
