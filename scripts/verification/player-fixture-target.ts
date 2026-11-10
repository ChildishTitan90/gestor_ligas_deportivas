/** Capability of an isolated manual fixture, never a browser flag or habitual DB. */
export function isManualPlayerDatabase(environment:NodeJS.ProcessEnv){
  if(environment.NODE_ENV!=="development" || environment.PLAYER_MANUAL_SCENARIOS!=="1")return false;
  let url:URL;try{url=new URL(environment.DATABASE_URL ?? "");}catch{return false;}
  return ["postgres:","postgresql:"].includes(url.protocol) && ["127.0.0.1","localhost","[::1]"].includes(url.hostname) && ["5432","5433"].includes(url.port || "5432") && /^\/pdgld48_test_[a-f0-9]{16}$/.test(url.pathname) && !url.search && !url.hash;
}
