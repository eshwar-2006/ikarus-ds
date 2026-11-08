// Server-only tooling. Never copy this script or its output into the web build.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{execFileSync}=require('node:child_process');
module.exports=function(){
 const root=path.resolve(__dirname,'..'),context={window:{}};
 vm.runInNewContext(fs.readFileSync(path.join(root,'ikarus2026-portal/supabase-config.js'),'utf8'),context);
 const url=context.window.IKARUS_SUPABASE_URL,ref=new URL(url).hostname.split('.')[0];
 const result=execFileSync('npx.cmd',['--offline','--cache','.npm-cache','supabase','projects','api-keys','--project-ref',ref,'--reveal','--output-format','json'],{cwd:root,shell:true,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1048576});
 const key=JSON.parse(result).keys.find(k=>k.name==='service_role')?.api_key;
 if(!key)throw Error('No server key is available for this project');
 return {root,url,key};
};
