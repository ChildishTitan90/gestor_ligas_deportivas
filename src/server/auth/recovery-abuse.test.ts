import assert from "node:assert/strict";
import test from "node:test";
import { recoveryAbusePolicy, recoveryClientKey } from "./recovery-abuse";
const env = { NODE_ENV:"development", NEXTAUTH_URL:"http://127.0.0.1:3032", PASSWORD_RECOVERY_CLIENT_IP_MODE:"local",
  PASSWORD_RECOVERY_RATE_WINDOW_SECONDS:"60", PASSWORD_RECOVERY_REQUESTS_PER_IP:"3", PASSWORD_RECOVERY_COMPLETIONS_PER_IP:"5",
  PASSWORD_RECOVERY_REQUESTS_GLOBAL:"30", PASSWORD_RECOVERY_COMPLETIONS_GLOBAL:"50", PASSWORD_RECOVERY_RATE_SECRET:"synthetic-rate-secret-at-least-thirty-two-characters" };
test("cuotas públicas exigen configuración explícita y un origen de IP confiable",()=>{
 assert.equal(recoveryAbusePolicy({}),null);
 const policy=recoveryAbusePolicy(env);assert.ok(policy);
 assert.equal(recoveryAbusePolicy({...env,NODE_ENV:"production"}),null);
 assert.equal(recoveryAbusePolicy({...env,VERCEL:"1"}),null);
 for(const key of ["PASSWORD_RECOVERY_RATE_SECRET","PASSWORD_RECOVERY_RATE_WINDOW_SECONDS","PASSWORD_RECOVERY_REQUESTS_PER_IP","PASSWORD_RECOVERY_COMPLETIONS_GLOBAL"])
   assert.equal(recoveryAbusePolicy({...env,[key]:""}),null);
 assert.equal(recoveryAbusePolicy({...env,PASSWORD_RECOVERY_REQUESTS_GLOBAL:"2"}),null);
 for(const forwarded of ["1.2.3.4","5.6.7.8"])assert.equal(recoveryClientKey(new Request("http://localhost",{headers:{"x-forwarded-for":forwarded,"x-vercel-forwarded-for":forwarded}}),policy),"local");
});
test("Vercel: no fallback a cabeceras manipulables; IPv6 canónico agrupado por /64",()=>{
 const policy=recoveryAbusePolicy({...env,PASSWORD_RECOVERY_CLIENT_IP_MODE:"vercel",VERCEL:"1"});assert.ok(policy);
 assert.equal(recoveryAbusePolicy({...env,PASSWORD_RECOVERY_CLIENT_IP_MODE:"vercel"}),null);
 const request=(value?:string)=>new Request("https://example.test",{headers:{"x-forwarded-for":"1.2.3.4",...(value?{"x-vercel-forwarded-for":value}:{})}});
 for(const value of [undefined,"garbage","1.2.3.4, 5.6.7.8"])assert.equal(recoveryClientKey(request(value),policy),null);
 assert.equal(recoveryClientKey(request("1.2.3.4"),policy),"1.2.3.4");
 assert.equal(recoveryClientKey(request("2001:db8::1"),policy),recoveryClientKey(request("2001:0db8:0000:0000::ffff"),policy));
 assert.notEqual(recoveryClientKey(request("2001:db8::1"),policy),recoveryClientKey(request("2001:db8:1::1"),policy));
});
