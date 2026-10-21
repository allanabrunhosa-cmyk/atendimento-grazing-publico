import {readFile,writeFile} from 'node:fs/promises';
const c=JSON.parse(await readFile(process.argv[2],'utf8'));
if(c.tabelas.length!==37)throw Error('ESCOPO_DIVERGENTE');
const q=s=>'"'+s.replaceAll('"','""')+'"';
const destino=s=>'donatella_'+s;
const sql=[`-- Estrutura derivada do catálogo efetivamente recuperado. Sem jobs, defaults ou triggers de negócio.
BEGIN;
DO $$ BEGIN IF current_database()<>'donatella_preparacao' THEN RAISE EXCEPTION 'Destino recusado'; END IF; END $$;
SET LOCAL search_path=donatella_public,pg_catalog;`];
for(const s of ['public','auth','storage'])sql.push(`CREATE SCHEMA ${q(destino(s))}; REVOKE ALL ON SCHEMA ${q(destino(s))} FROM PUBLIC;`);
for(const e of c.enums)sql.push(`CREATE TYPE ${q(destino(e.esquema))}.${q(e.nome)} AS ENUM (${e.valores.map(v=>"'"+v.replaceAll("'","''")+"'").join(',')});`);
for(const t of c.tabelas){
 const cols=t.colunas.map(col=>{
  let tipo=col.tipo;
  for(const e of c.enums)if(tipo===e.nome||tipo===e.esquema+'.'+e.nome)tipo=q(destino(e.esquema))+'.'+q(e.nome);
  if(!/^[a-zA-Z0-9_".,()\[\] ]+$/.test(tipo))throw Error('TIPO_RECUSADO');
  return `${q(col.nome)} ${tipo}${col.obrigatoria?' NOT NULL':''}`;
 });
 sql.push(`CREATE TABLE ${q(destino(t.esquema))}.${q(t.tabela)} (${cols.join(',')},PRIMARY KEY(${t.pk.map(q).join(',')}));`);
}
sql.push(`CREATE TABLE atendimento_migracao.materializacao (execucao uuid NOT NULL,documento_id uuid NOT NULL,aplicado_em timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(execucao,documento_id),FOREIGN KEY(execucao,documento_id) REFERENCES atendimento_migracao.carga_documento(execucao,id));
CREATE TABLE atendimento_migracao.supervisao (id boolean PRIMARY KEY DEFAULT true CHECK(id),estado jsonb NOT NULL,atualizado_em timestamptz NOT NULL DEFAULT now());
REVOKE ALL ON atendimento_migracao.materializacao,atendimento_migracao.supervisao FROM PUBLIC;
GRANT SELECT,INSERT,UPDATE ON atendimento_migracao.materializacao,atendimento_migracao.supervisao TO donatella_coletor;
CREATE ROLE donatella_consulta NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
GRANT CONNECT ON DATABASE donatella_preparacao TO donatella_consulta;
GRANT USAGE ON SCHEMA donatella_public,donatella_storage,atendimento_migracao TO donatella_consulta;
GRANT SELECT ON donatella_public.contacts,donatella_public.conversations,donatella_public.messages,donatella_public.profiles,donatella_storage.objects,atendimento_migracao.supervisao TO donatella_consulta;
CREATE INDEX consulta_conversas_contato ON donatella_public.conversations(contact_id,last_message_at DESC,id);
CREATE INDEX consulta_historico ON donatella_public.messages(conversation_id,created_at DESC,id);
CREATE INDEX consulta_anexos ON donatella_storage.objects(bucket_id,name);
`);
for(const s of ['public','auth','storage'])sql.push(`GRANT USAGE ON SCHEMA ${q(destino(s))} TO donatella_coletor; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA ${q(destino(s))} TO donatella_coletor; REVOKE ALL ON ALL TABLES IN SCHEMA ${q(destino(s))} FROM PUBLIC;`);
sql.push('COMMIT;');
await writeFile(process.argv[3],sql.join('\n')+'\n');
const fks=['BEGIN; SET LOCAL search_path=donatella_public,pg_catalog;'];
for(const r of c.relacoes){let d=r.definicao.replace(/\b(public|auth|storage)\./g,(_,s)=>q(destino(s))+'.');d=d.replace(/ DEFERRABLE.*$/,'');fks.push(`ALTER TABLE ${q(destino(r.esquema))}.${q(r.tabela)} ADD CONSTRAINT ${q(r.nome)} ${d} DEFERRABLE INITIALLY DEFERRED NOT VALID;`);}
fks.push('COMMIT;');
await writeFile(process.argv[4],fks.join('\n')+'\n');
console.log(JSON.stringify({tabelas:c.tabelas.length,relacoes:c.relacoes.length,semRotinasDeNegocio:true}));
