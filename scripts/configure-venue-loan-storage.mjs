import {readFile} from 'node:fs/promises';
import {createClient} from '@supabase/supabase-js';
import dotenv from 'dotenv';
const arg=name=>process.argv[process.argv.indexOf(name)+1];
const expected={pruebas:'loaztwwpwsaqzdtdtvvj',produccion:'orbqznfpeqbigyrubfkm'};
const target=arg('--environment'),file=arg('--config'),bucket='cartas-prestamo-canchas';
try{
  if(!process.argv.includes('--environment')||!process.argv.includes('--config')||!expected[target]||!file)throw Error();
  const env=dotenv.parse(await readFile(file,'utf8')),url=new URL(env.SUPABASE_URL);
  if(url.origin!==`https://${expected[target]}.supabase.co`||url.pathname!=='/'||url.search||url.hash||!env.SUPABASE_STORAGE_SERVER_KEY)throw Error();
  const client=createClient(url.origin,env.SUPABASE_STORAGE_SERVER_KEY,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,init)=>fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(20000)})}});
  const options={public:false,fileSizeLimit:10485760,allowedMimeTypes:['application/pdf','image/jpeg','image/png']};
  const first=await client.storage.getBucket(bucket);let action='verified';
  if(first.error){if(!/not found/i.test(first.error.message))throw Error();const created=await client.storage.createBucket(bucket,options);if(created.error)throw Error();action='created';}
  else if(first.data.public!==false||Number(first.data.file_size_limit)!==options.fileSizeLimit||JSON.stringify([...(first.data.allowed_mime_types??[])].sort())!==JSON.stringify([...options.allowedMimeTypes].sort())){const changed=await client.storage.updateBucket(bucket,options);if(changed.error)throw Error();action='configured';}
  const {data,error}=await client.storage.getBucket(bucket);if(error||data.public!==false||Number(data.file_size_limit)!==10485760||data.allowed_mime_types?.length!==3||!options.allowedMimeTypes.every(m=>data.allowed_mime_types.includes(m)))throw Error();
  console.log(JSON.stringify({environment:target,bucket,action,private:true,maxBytes:10485760,mimeTypes:options.allowedMimeTypes,uploadedObjects:0}));
}catch{console.error(JSON.stringify({code:'VENUE_LOAN_STORAGE_CONFIGURATION_FAILED',environment:target}));process.exitCode=1;}
