const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),src=path.join(root,'ikarus2026-portal'),out=path.join(root,'dist');
if(path.dirname(out)!==root || path.basename(out)!=='dist')throw new Error('Invalid build destination');
fs.rmSync(out,{recursive:true,force:true});
fs.mkdirSync(out,{recursive:true});
// Explicit allowlist: SQL, Edge Function source, and private PDFs never ship.
for(const name of ['index.html','app.js','styles.css','supabase-config.js'])fs.copyFileSync(path.join(src,name),path.join(out,name));
fs.cpSync(path.join(src,'assets'),path.join(out,'assets'),{recursive:true});
console.log(`Static website ready at ${out}`);
