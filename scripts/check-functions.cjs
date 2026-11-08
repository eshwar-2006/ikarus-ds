const ts=require('typescript'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../ikarus2026-portal/supabase/functions');
let failed=false,count=0;
for(const entry of fs.readdirSync(root,{recursive:true})){if(!entry.endsWith('.ts'))continue;count++;const result=ts.transpileModule(fs.readFileSync(path.join(root,entry),'utf8'),{fileName:entry,reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}});for(const d of result.diagnostics||[]){failed=true;console.error(entry,ts.flattenDiagnosticMessageText(d.messageText,'\n'));}}
if(failed)process.exit(1);console.log(`${count} TypeScript modules passed syntax checks.`);
