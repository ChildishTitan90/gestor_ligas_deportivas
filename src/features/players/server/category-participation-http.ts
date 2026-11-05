import "server-only";
import {CategoryParticipationError} from "./category-participations";
import {documentFailure,documentHeaders} from "./document-http";
export function categoryParticipationFailure(error:unknown){
  if(error instanceof CategoryParticipationError)return Response.json({code:error.code},{status:error.status,headers:documentHeaders});
  return documentFailure(error);
}
