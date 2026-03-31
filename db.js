const fs=require('fs'),path=require('path');
const USE_SUPABASE=!!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_KEY);
let supabase=null;
if(USE_SUPABASE){const{createClient}=require('@supabase/supabase-js');supabase=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_KEY);console.log('Supabase connected');}
const DATA_DIR=process.env.DATA_DIR||(process.env.VERCEL?'/tmp/outreachpro-data':path.join(__dirname,'data'));
try{if(!fs.existsSync(DATA_DIR))fs.mkdirSync(DATA_DIR,{recursive:true});}catch(e){}
function readJSON(file,def=[]){try{const p=path.join(DATA_DIR,file);if(!fs.existsSync(p))return def;return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return def;}}
function writeJSON(file,data){try{fs.writeFileSync(path.join(DATA_DIR,file),JSON.stringify(data,null,2));}catch(e){console.error('writeJSON error:',e.message);}}
async function dbRead(key,def=[]){if(!USE_SUPABASE)return readJSON(key+'.json',def);try{const{data,error}=await supabase.from('kv').select('value').eq('key',key).single();if(error||!data)return def;return data.value??def;}catch(e){console.error('dbRead error:',e.message);return def;}}
async function dbWrite(key,value){if(!USE_SUPABASE){writeJSON(key+'.json',value);return;}try{await supabase.from('kv').upsert({key,value,updated_at:new Date().toISOString()},{onConflict:'key'});}catch(e){console.error('dbWrite error:',e.message);writeJSON(key+'.json',value);}}
module.exports={readJSON,writeJSON,dbRead,dbWrite,USE_SUPABASE};