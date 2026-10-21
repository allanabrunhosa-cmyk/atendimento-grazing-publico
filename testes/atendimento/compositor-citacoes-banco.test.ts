import {it,expect,vi} from 'vitest';
import {Pool,type PoolClient} from 'pg';
import {randomUUID,createHash} from 'node:crypto';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {RepositorioOperacaoPg,materializarEventoOperacao} from '../../src/lib/atendimento/operacao-repositorio-pg';
import type {AcaoOperacao,IdentidadeOperacao} from '../../src/lib/atendimento/operacao-tipos';
import {pngFicticio,pdfFicticio} from './fixtures-midia';
vi.mock('server-only',()=>({}));

it.skipIf(process.env.ATENDIMENTO_COMPOSITOR_BANCO_TESTE!=='1')('PostgreSQL local: citação paginada, ordem invertida, escopo, emojis e anexos de 4 MB',async()=>{
 const endereco=process.env.OPERACAO_BANCO_TESTE??'',url=new URL(endereco);
 if(url.protocol!=='postgresql:'||url.hostname!=='127.0.0.1'||url.port!=='56423'||url.pathname!=='/donatella_ensaio_operacao')throw Error('COMPOSITOR_ENSAIO_LOCAL_EXIGIDO');
 const pool=new Pool({connectionString:endereco,max:1}),tx=await pool.connect();let indice=0;
 try{
  expect((await tx.query('SELECT current_database() banco')).rows[0].banco).toBe('donatella_ensaio_operacao');await tx.query('BEGIN');
  for(const nome of ['025-operacao-destino.sql','033-woocommerce-automacoes-operacionais.sql','034-woocommerce-crm-baseline.sql','036-operacao-mensagem-sticker.sql','037-operacao-leitura-mensagem.sql','038-operacao-contatos-templates.sql','039-operacao-atividades-nomes.sql']){
   const sql=(await readFile('scripts/atendimento/sql/'+nome,'utf8')).replace(/^\s*(?:BEGIN|COMMIT);\s*$/gm,'').replace(/^GRANT[^\r\n]+;\s*$/gm,'');await tx.query(sql);
  }
  const isolado={connect:async()=>{const savepoint='citacoes_'+(++indice);return new Proxy(tx,{get(alvo,p){if(p==='release')return()=>undefined;if(p==='query')return async(sql:string,parametros?:unknown[])=>{if(sql==='BEGIN')return alvo.query('SAVEPOINT '+savepoint);if(sql==='COMMIT')return alvo.query('RELEASE SAVEPOINT '+savepoint);if(sql==='ROLLBACK')return alvo.query('ROLLBACK TO SAVEPOINT '+savepoint);return alvo.query(sql,parametros);};return Reflect.get(alvo,p);}}) as PoolClient;}} as unknown as Pool;
  const direitos=new Set<AcaoOperacao>(['consultar','atender','mensagens.visualizar','mensagens.adicionar','contatos.visualizar','etiquetas.visualizar']);
  const ator:IdentidadeOperacao={id:'fixture-compositor-'+randomUUID(),nome:'Ana Fictícia',perfilId:'perfil-ficticio',sessaoVersao:1,permissoes:[]};const midia=resolve('.tmp-homologacao/compositor-pg/midia');await mkdir(midia,{recursive:true});
  const repo=new RepositorioOperacaoPg(isolado,async(i,a)=>i.id===ator.id&&direitos.has(a),()=> 'operacao',midia,undefined,undefined,'humano',{numeroId:'123456789',ficticio:true});
  const contato=randomUUID(),contatoOutro=randomUUID(),conversa=randomUUID(),outro=randomUUID(),original=randomUUID(),texto='Olá 💜👍🏽👨‍👩‍👧‍👦';
  await tx.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal) VALUES($1,'Cliente fictício','5511000000011','whatsapp:123456789:5511000000011')",[contato]);
  await tx.query("INSERT INTO atendimento_operacao.contato(id,nome,telefone,identidade_canal) VALUES($1,'Outro contato fictício','5511000000022','whatsapp:123456789:5511000000022')",[contatoOutro]);
  await tx.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia,responsavel_id,ultima_cliente_em) VALUES($1,$3,'humano',true,$5,now()),($2,$4,'humano',true,$5,now())",[conversa,outro,contato,contatoOutro,ator.id]);
  await tx.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,wamid,autor,conteudo,tipo,estado,criada_em) VALUES($1,$2,'wamid.original-ficticio','cliente',$3,'text','recebido','2026-10-12T12:00:00Z')",[original,conversa,texto]);
  for(let n=1;n<=55;n++)await tx.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo,estado,criada_em) VALUES($1,$2,'cliente',$3,'text','recebido','2026-10-12T12:00:00Z'::timestamptz+($4::integer*interval '1 second'))",[randomUUID(),conversa,'Mensagem fictícia '+n,n]);
  const envio=await repo.enfileirar(ator,{conversaId:conversa,versao:1,idempotencia:randomUUID(),tipo:'text',texto:'Resposta humana 💜',citadaId:original});
  const pagina=await repo.historico(ator,{conversaId:conversa});expect(pagina.registros).toHaveLength(50);expect(pagina.proxima).not.toBeNull();expect(pagina.registros.some(m=>m.id===original)).toBe(false);
  expect(pagina.registros.find(m=>m.id===envio.mensagemId)).toMatchObject({conteudo:'Resposta humana 💜',autorNome:ator.nome,citadaId:original,citada:{id:original,autor:'cliente',conteudo:texto,tipo:'text'}});
  expect((await repo.historico(ator,{conversaId:conversa,antes:pagina.proxima!.antes,id:pagina.proxima!.id})).registros.find(m=>m.id===original)?.conteudo).toBe(texto);
  const estrangeira=randomUUID();await tx.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,wamid,autor,conteudo,tipo,estado) VALUES($1,$2,'wamid.outra-ficticia','cliente','Não pode aparecer na outra conversa','text','recebido')",[estrangeira,outro]);
  await expect(repo.enfileirar(ator,{conversaId:conversa,versao:1,idempotencia:randomUUID(),tipo:'text',texto:'Resposta fictícia',citadaId:estrangeira})).rejects.toThrow('CITACAO_RECUSADA');
  const semWamid=randomUUID();await tx.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo,estado) VALUES($1,$2,'humano','Pendente fictícia','text','pendente')",[semWamid,conversa]);
  await expect(repo.enfileirar(ator,{conversaId:conversa,versao:1,idempotencia:randomUUID(),tipo:'text',texto:'Não enviar sem citação',citadaId:semWamid})).rejects.toThrow('CITACAO_INDISPONIVEL');
  const evento=(wamid:string,ref:string)=>({chave:wamid,tipo:'mensagem',waba:'123456789',numero:'123456789',conteudo:{item:{id:wamid,from:'5511000000011',timestamp:String(Math.floor(Date.now()/1000)),type:'text',text:{body:'Resposta do cliente 🙂'},context:{id:ref}}}} as Parameters<typeof materializarEventoOperacao>[1]);
  // A origem citada chega depois do evento de resposta. Não depende de nova importação.
  const recebida=await materializarEventoOperacao(repo,evento('wamid.resposta-atrasada','wamid.original-atrasada')) as {mensagemId:string;conversaId:string};
  let antes=await repo.historico(ator,{conversaId:recebida.conversaId});expect(antes.registros.find(m=>m.id===recebida.mensagemId)).toMatchObject({citada:null,citadaReferenciaAusente:true});
  const tardia=randomUUID();await tx.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,wamid,autor,autor_id,conteudo,tipo,estado,metadados) VALUES($1,$2,'wamid.original-atrasada','humano',$3,'Texto humano preservado 👋','text','aceito',$4)",[tardia,recebida.conversaId,ator.id,{autorNome:ator.nome}]);
  antes=await repo.historico(ator,{conversaId:recebida.conversaId});expect(antes.registros.find(m=>m.id===recebida.mensagemId)).toMatchObject({citadaId:tardia,citada:{id:tardia,autorNome:ator.nome,conteudo:'Texto humano preservado 👋'},citadaReferenciaAusente:false});
  expect(await materializarEventoOperacao(repo,evento('wamid.resposta-atrasada','wamid.original-atrasada'))).toEqual({duplicada:true});
  expect((await tx.query("SELECT count(*)::int n FROM atendimento_operacao.mensagem WHERE wamid='wamid.resposta-atrasada'")).rows[0].n).toBe(1);
  const encerrada=randomUUID(),anterior=randomUUID();
  await tx.query("INSERT INTO atendimento_operacao.conversa(id,contato_id,estado,ficticia) VALUES($1,$2,'encerrada',true)",[encerrada,contato]);
  await tx.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,wamid,autor,autor_id,conteudo,tipo,estado,metadados) VALUES($1,$2,'wamid.atendimento-anterior','humano',$3,'Texto do atendimento anterior 💜','text','aceito',$4)",[anterior,encerrada,ator.id,{autorNome:ator.nome}]);
  const novaResposta=await materializarEventoOperacao(repo,evento('wamid.resposta-historica','wamid.atendimento-anterior')) as {mensagemId:string};
  expect((await repo.historico(ator,{conversaId:conversa})).registros.find(m=>m.id===novaResposta.mensagemId)?.citada).toMatchObject({id:anterior,autorNome:ator.nome,conteudo:'Texto do atendimento anterior 💜'});
  const referenciaEstrangeira=await materializarEventoOperacao(repo,evento('wamid.resposta-estrangeira','wamid.outra-ficticia')) as {mensagemId:string};
  expect((await repo.historico(ator,{conversaId:conversa})).registros.find(m=>m.id===referenciaEstrangeira.mensagemId)).toMatchObject({citada:null,citadaReferenciaAusente:true});
  const template=randomUUID(),respostaTemplate=randomUUID();
  await tx.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,wamid,autor,autor_id,conteudo,tipo,estado,metadados) VALUES($1,$2,'wamid.template-ficticio','humano',$3,'','template','aceito',$4)",[template,conversa,ator.id,{autorNome:ator.nome,template:{nome:'template_ficticio',componentes:[{type:'BODY',text:'Pedido de {{1}} confirmado 💜'}],variaveis:['Marina']}}]);
  await tx.query("INSERT INTO atendimento_operacao.mensagem(id,conversa_id,autor,conteudo,tipo,estado,citada_id) VALUES($1,$2,'cliente','Obrigada 🙂','text','recebido',$3)",[respostaTemplate,conversa,template]);
  const comTemplate=await repo.historico(ator,{conversaId:conversa});expect(comTemplate.registros.find(m=>m.id===template)?.conteudo).toBe('Pedido de Marina confirmado 💜');expect(comTemplate.registros.find(m=>m.id===respostaTemplate)?.citada).toMatchObject({conteudo:'Pedido de Marina confirmado 💜',autorNome:ator.nome,tipo:'template'});
  direitos.delete('mensagens.visualizar');expect((await repo.historico(ator,{conversaId:conversa})).registros).toEqual([]);direitos.add('mensagens.visualizar');
  for(const [mime,semente,nome] of [['image/png',pngFicticio,'imagem-ficticia.png'],['application/pdf',pdfFicticio,'documento-ficticio.pdf']] as const){
   const bytes=Buffer.alloc(4*1024*1024);semente.copy(bytes);const chave=randomUUID(),anexo=await repo.salvarAnexo(ator,{conversaId:conversa,nome,mime,base64:bytes.toString('base64'),idempotencia:chave});
   expect(anexo.tamanho).toBe(bytes.length);const recuperado=await repo.obterAnexo(ator,anexo.id);expect(recuperado.bytes.equals(bytes)).toBe(true);expect(createHash('sha256').update(recuperado.bytes).digest('hex')).toBe(createHash('sha256').update(bytes).digest('hex'));
   expect(await repo.salvarAnexo(ator,{conversaId:conversa,nome,mime,base64:bytes.toString('base64'),idempotencia:chave})).toEqual(anexo);
  }
  direitos.delete('mensagens.adicionar');await expect(repo.salvarAnexo(ator,{conversaId:conversa,nome:'recusado.pdf',mime:'application/pdf',base64:pdfFicticio.toString('base64'),idempotencia:randomUUID()})).rejects.toThrow('ACESSO_NEGADO');
 }finally{try{await tx.query('ROLLBACK');}finally{tx.release();await pool.end();}}
},30000);
