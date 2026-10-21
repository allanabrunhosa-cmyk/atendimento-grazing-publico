import 'server-only';
import {randomUUID} from 'node:crypto';
import type {PoolClient} from 'pg';
import type {RepositorioOperacaoPg} from './operacao-repositorio-pg';
import {objetoOperacao,validarIdOperacao,validarTextoOperacao,validarVersaoOperacao,type AcaoOperacao,type IdentidadeOperacao} from './operacao-tipos';

export type AtalhoTextoOperacao={id:string;nome:string;texto:string};
export type ListaAtalhosTextoOperacao={versao:number;registros:AtalhoTextoOperacao[]};
export type PedidoSalvarAtalhoOperacao={id?:string;nome:string;texto:string;versao:number;idempotencia:string};
export type PedidoExcluirAtalhoOperacao={id:string;versao:number;idempotencia:string};
export const limitesAtalhosOperacao={nome:50,texto:4096,registros:200,bytes:900*1024} as const;
const chave='atalhos_texto';

/** A mesma forma do nome é usada no cadastro, na unicidade e no comando /nome. */
export function normalizarNomeAtalhoOperacao(valor:unknown):string{
 validarTextoOperacao(valor,limitesAtalhosOperacao.nome);
 const nome=valor.normalize('NFD').replace(/\p{M}/gu,'').trim().toLowerCase().replace(/ +/g,'-');
 if(!/^[a-z0-9][a-z0-9_-]{0,49}$/.test(nome))throw Error('OPERACAO_ATALHO_NOME_INVALIDO');
 return nome;
}
function textoAtalho(valor:unknown){validarTextoOperacao(valor,limitesAtalhosOperacao.texto);if(!valor.isWellFormed()||/\x7f/.test(valor))throw Error('OPERACAO_ENTRADA_INVALIDA');return valor.replace(/\r\n?/g,'\n');}
function idAtalho(valor:unknown){validarIdOperacao(valor);return valor.toLowerCase();}
function lerConteudo(valor:unknown,versao:unknown):ListaAtalhosTextoOperacao{
 try{
  if(!objetoOperacao(valor)||Object.keys(valor).some(k=>k!=='registros')||!Array.isArray(valor.registros)||valor.registros.length>limitesAtalhosOperacao.registros)throw Error();
  const v=Number(versao);validarVersaoOperacao(v);if(v<1)throw Error();
  const ids=new Set<string>(),nomes=new Set<string>(),registros=valor.registros.map(v=>{
   if(!objetoOperacao(v)||Object.keys(v).some(k=>!['id','nome','texto'].includes(k)))throw Error();
   const id=idAtalho(v.id),nome=normalizarNomeAtalhoOperacao(v.nome),texto=textoAtalho(v.texto);
   if(v.nome!==nome||ids.has(id)||nomes.has(nome))throw Error();ids.add(id);nomes.add(nome);return {id,nome,texto};
  });
  return {versao:v,registros};
 }catch{throw Error('OPERACAO_ATALHOS_INDISPONIVEIS');}
}

/** Atalhos são textos da equipe. Este serviço não conhece transporte nem fila de mensagens. */
export class ServicoAtalhosOperacao{
 constructor(private readonly repo:RepositorioOperacaoPg){}
 private async exigir(tx:PoolClient,i:IdentidadeOperacao,acao?:AcaoOperacao){
  if(i.tipo!==undefined&&i.tipo!=='usuario')throw Error('OPERACAO_AUTOR_RECUSADO');
  await this.repo.exigir(tx,i,'consultar');
  await this.repo.exigir(tx,i,'atalhos.visualizar');
  if(acao){await this.repo.exigir(tx,i,acao);if(!['operacao','homologacao'].includes(this.repo.modo()))throw Error('OPERACAO_SOMENTE_LEITURA');}
 }
 private async lista(tx:PoolClient,bloquear=false):Promise<ListaAtalhosTextoOperacao>{
  const r=await tx.query<{conteudo:unknown;versao:string}>(`SELECT conteudo,versao FROM atendimento_operacao.configuracao WHERE chave='atalhos_texto'${bloquear?' FOR UPDATE':''}`);
  return r.rows.length?lerConteudo(r.rows[0].conteudo,r.rows[0].versao):{versao:0,registros:[]};
 }
 async listar(i:IdentidadeOperacao):Promise<ListaAtalhosTextoOperacao>{return this.repo.transacao(async tx=>{await this.exigir(tx,i);return this.lista(tx);});}
 private async gravar(tx:PoolClient,registros:AtalhoTextoOperacao[]){
  const conteudo={registros:registros.toSorted((a,b)=>a.nome.localeCompare(b.nome,'pt-BR'))};
  // O envelope continua abaixo do limite de leitura do cliente (1 MiB),
  // inclusive para textos com Unicode ou caracteres escapados no JSON.
  if(Buffer.byteLength(JSON.stringify({versao:Number.MAX_SAFE_INTEGER,...conteudo}),'utf8')>limitesAtalhosOperacao.bytes)throw Error('OPERACAO_ATALHOS_TAMANHO_INVALIDO');
  const r=await tx.query("INSERT INTO atendimento_operacao.configuracao(chave,conteudo) VALUES('atalhos_texto',$1::jsonb) ON CONFLICT(chave) DO UPDATE SET conteudo=excluded.conteudo,versao=atendimento_operacao.configuracao.versao+1,atualizada_em=now() RETURNING versao",[JSON.stringify(conteudo)]);
  return Number(r.rows[0].versao);
 }
 async salvar(i:IdentidadeOperacao,p:PedidoSalvarAtalhoOperacao):Promise<{versao:number;atalho:AtalhoTextoOperacao}>{
  const id=p.id===undefined?undefined:idAtalho(p.id),nome=normalizarNomeAtalhoOperacao(p.nome),texto=textoAtalho(p.texto),idempotencia=idAtalho(p.idempotencia);validarVersaoOperacao(p.versao);
  return this.repo.transacao(async tx=>{
   const autorizar=()=>this.exigir(tx,i,id?'atalhos.editar':'atalhos.adicionar');await autorizar();
   return this.repo.comando(tx,i,idempotencia,{acao:'atalho_salvar',id,nome,texto,versao:p.versao},async()=>{
    // A trava também protege a primeira gravação, quando ainda não existe linha.
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`config:${chave}`]);
    const atual=await this.lista(tx,true);if(atual.versao!==p.versao)throw Error('OPERACAO_CONFLITO');
    if(id&&!atual.registros.some(v=>v.id===id))throw Error('OPERACAO_ATALHO_AUSENTE');
    if(atual.registros.some(v=>v.nome===nome&&v.id!==id))throw Error('OPERACAO_ATALHO_NOME_CONFLITO');
    if(!id&&atual.registros.length>=limitesAtalhosOperacao.registros)throw Error('OPERACAO_ATALHOS_LIMITE_INVALIDO');
    const atalho={id:id??randomUUID(),nome,texto},registros=[...atual.registros.filter(v=>v.id!==id),atalho];
    await autorizar();const versao=await this.gravar(tx,registros);
    await this.repo.auditar(tx,i,atalho.id,id?'atalho_editar':'atalho_criar',versao);
    return {versao,atalho};
   },autorizar);
  });
 }
 async excluir(i:IdentidadeOperacao,p:PedidoExcluirAtalhoOperacao):Promise<{versao:number;id:string}>{
  const id=idAtalho(p.id),idempotencia=idAtalho(p.idempotencia);validarVersaoOperacao(p.versao);
  return this.repo.transacao(async tx=>{
   const autorizar=()=>this.exigir(tx,i,'atalhos.excluir');await autorizar();
   return this.repo.comando(tx,i,idempotencia,{acao:'atalho_excluir',id,versao:p.versao},async()=>{
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[`config:${chave}`]);
    const atual=await this.lista(tx,true);if(atual.versao!==p.versao)throw Error('OPERACAO_CONFLITO');
    if(!atual.registros.some(v=>v.id===id))throw Error('OPERACAO_ATALHO_AUSENTE');
    await autorizar();const versao=await this.gravar(tx,atual.registros.filter(v=>v.id!==id));
    await this.repo.auditar(tx,i,id,'atalho_excluir',versao);return {versao,id};
   },autorizar);
  });
 }
}
