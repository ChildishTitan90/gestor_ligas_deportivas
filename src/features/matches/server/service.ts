import "server-only";
import { requireOperationalUser } from "@/server/auth/session";
import { getPrisma } from "@/server/db/prisma";
import { transitionMatchInTransaction } from "./transition";
import { rescheduleAbsentMatchInTransaction } from "./reschedule";
import { Prisma } from "@prisma/client";
import { MatchTransitionError } from "../transition-rules";
import { cancelReviewedMatchInTransaction } from "./resolve-review";

/** Entrada de servidor para las futuras acciones de programación de PDGLD-133. */
export async function transitionMatch(input: unknown) {
  const actor = await requireOperationalUser();
  return getPrisma().$transaction(tx => transitionMatchInTransaction(tx, actor.id, input));
}

export async function cancelReviewedMatch(input:unknown) {
  const actor=await requireOperationalUser();
  try {return await getPrisma().$transaction(tx=>cancelReviewedMatchInTransaction(tx,actor.id,input),{isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});}
  catch(error) {if(error instanceof Prisma.PrismaClientKnownRequestError && error.code==="P2034")throw new MatchTransitionError("CONCURRENT_CHANGE");throw error;}
}

export async function rescheduleAbsentMatch(input:unknown) {
  const actor=await requireOperationalUser();
  for(let attempt=0;attempt<3;attempt++) {
    try {return await getPrisma().$transaction(tx=>rescheduleAbsentMatchInTransaction(tx,actor.id,input),
      {isolationLevel:Prisma.TransactionIsolationLevel.Serializable,timeout:30000});}
    catch(error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        const adapter = error.meta?.driverAdapterError as {cause?:{originalCode?:string}} | undefined;
        if ((adapter?.cause?.originalCode ?? error.meta?.code) === "23P01") throw new MatchTransitionError("RESERVATION_CONFLICT");
      }
      if(!(error instanceof Prisma.PrismaClientKnownRequestError)||error.code!=="P2034") throw error;
      if(attempt===2) throw new MatchTransitionError("CONCURRENT_CHANGE");
    }
  }
  throw new MatchTransitionError("CONCURRENT_CHANGE");
}
