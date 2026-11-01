import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import dotenv from 'dotenv';

// Nunca abrir el archivo de producción ni deducirlo a partir del de pruebas.
const privateTestFile='C:/Users/victo/Documents/Codex/storage-expedientes-20261031/.env.storage-pruebas';
export async function readPlayerDocumentTestConfiguration({configureLocal=false}={}) {
  const root=new URL('../../',import.meta.url);
  const localFile=new URL('.env.local',root);
  const localText=await readFile(localFile,'utf8');
  const local=dotenv.parse(localText);
  const expected=dotenv.parse(await readFile(privateTestFile,'utf8'));
  const keys=['SUPABASE_URL','SUPABASE_STORAGE_SERVER_KEY'];
  if(keys.some(key=>!local[key] || !expected[key] || local[key]!==expected[key])) throw new Error('La configuración local no coincide con el archivo privado de pruebas.');
  const url=new URL(local.SUPABASE_URL);
  if(url.protocol!=='https:' || url.username || url.password || url.pathname!=='/' || url.search || url.hash) throw new Error('Configuración de pruebas inválida.');
  const bucket='expedientes-jugadores';
  if(local.SUPABASE_PLAYER_DOCUMENTS_BUCKET && local.SUPABASE_PLAYER_DOCUMENTS_BUCKET!==bucket)throw new Error('Bucket local diferente del autorizado.');
  if(expected.SUPABASE_PLAYER_DOCUMENTS_BUCKET && expected.SUPABASE_PLAYER_DOCUMENTS_BUCKET!==bucket)throw new Error('Bucket de pruebas diferente del autorizado.');
  if(configureLocal && !local.SUPABASE_PLAYER_DOCUMENTS_BUCKET)await writeFile(localFile,`${localText.trimEnd()}\nSUPABASE_PLAYER_DOCUMENTS_BUCKET="${bucket}"\n`);
  return {SUPABASE_URL:local.SUPABASE_URL,SUPABASE_STORAGE_SERVER_KEY:local.SUPABASE_STORAGE_SERVER_KEY,SUPABASE_PLAYER_DOCUMENTS_BUCKET:bucket};
}
if(process.argv[1] && fileURLToPath(import.meta.url)===process.argv[1]) {
  try{await readPlayerDocumentTestConfiguration({configureLocal:process.argv.includes('--configure-local')});
    console.log('Configuración verificada: URL y clave coinciden con pruebas; bucket local preparado. No se abrió producción.');
  }catch{console.error('No se pudo verificar la configuración privada de pruebas; no se muestran valores.');process.exitCode=1;}
}
