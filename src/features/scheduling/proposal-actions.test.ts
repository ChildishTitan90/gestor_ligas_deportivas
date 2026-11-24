import assert from "node:assert/strict";
import test from "node:test";
import { proposalActions } from "./proposal-actions";

test("las acciones visibles dependen del permiso, el estado y la temporada", () => {
  const base={seasonOpen:true,generated:true,operationalCount:0};
  const actions=(status:string,canUpdate:boolean,canApprove:boolean)=>proposalActions({...base,status,canUpdate,canApprove});
  assert.deepEqual(actions("DRAFT",true,false),{canEdit:true,canReview:false,canActivate:false});
  assert.deepEqual(actions("IN_REVIEW",true,false),{canEdit:false,canReview:false,canActivate:false});
  assert.deepEqual(actions("DRAFT",false,true),{canEdit:false,canReview:false,canActivate:false});
  assert.deepEqual(actions("IN_REVIEW",false,true),{canEdit:false,canReview:true,canActivate:false});
  assert.deepEqual(actions("APPROVED",false,true),{canEdit:false,canReview:false,canActivate:true});
  for(const status of ["DRAFT","IN_REVIEW","APPROVED"]) assert.deepEqual(actions(status,false,false),{canEdit:false,canReview:false,canActivate:false});
  assert.deepEqual(proposalActions({...base,status:"IN_REVIEW",seasonOpen:false,canUpdate:true,canApprove:true}),{canEdit:false,canReview:false,canActivate:false});
  assert.equal(proposalActions({...base,status:"APPROVED",operationalCount:1,canUpdate:false,canApprove:true}).canActivate,false);
});
