const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../ikarus2026-portal');
const sql=['base-schema.sql','quiz-engine-migration.sql','competition-engine-migration.sql','portal-fixes-migration.sql','storage-access-migration.sql','ticket-login-migration.sql','round3-qualification-migration.sql','section-grading-migration.sql'].map(name=>`-- SOURCE: ${name}\n${fs.readFileSync(path.join(root,name),'utf8')}\n`).join('\n');
const dir=path.join(root,'supabase/migrations');fs.mkdirSync(dir,{recursive:true});
const file=path.join(dir,'20261029000100_portal_setup.sql');fs.writeFileSync(file,`begin;\n${sql}\ncommit;\n`);
console.log(`Prepared ${file}`);
