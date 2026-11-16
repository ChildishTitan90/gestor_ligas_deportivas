import assert from "node:assert/strict";
import test from "node:test";
import type {PrismaClient} from "@prisma/client";
import {getPrisma} from "./prisma";

test("retira el singleton de otro esquema y conserva el cliente actualizado durante HMR",async()=>{
  const globals=globalThis as unknown as {prisma?:PrismaClient;prismaCacheKey?:string};
  const saved={client:globals.prisma,key:globals.prismaCacheKey,url:process.env.DATABASE_URL,environment:process.env.NODE_ENV};let disconnected=0;
  const stale={$disconnect:async()=>{disconnected++;}} as unknown as PrismaClient;
  try{
    Object.assign(process.env,{DATABASE_URL:"postgresql://synthetic@localhost:5433/no_connection_opened",NODE_ENV:"development"});
    globals.prisma=stale;globals.prismaCacheKey="previous-generated-schema";
    const current=getPrisma();assert.notEqual(current,stale);
    assert.equal(typeof current.referee_presentation_credentials.findMany,"function");
    assert.equal(getPrisma(),current);assert.equal(globals.prisma,current);assert.equal(disconnected,1);
    await current.$disconnect();
  }finally{
    globals.prisma=saved.client;globals.prismaCacheKey=saved.key;
    for(const [key,value]of [["DATABASE_URL",saved.url],["NODE_ENV",saved.environment]]){if(value===undefined)Reflect.deleteProperty(process.env,key!);else Reflect.set(process.env,key!,value);}
  }
});
