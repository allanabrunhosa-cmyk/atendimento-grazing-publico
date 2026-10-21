import {randomUUID} from 'node:crypto';
import {RepositorioOperacaoPg,hashOperacao} from './operacao-repositorio-pg';
import {objetoOperacao,validarIdOperacao,validarTextoOperacao,validarVersaoOperacao,type IdentidadeOperacao} from './operacao-tipos';
import {modeloTextoSuportadoOperacao,variaveisModeloOperacao} from './operacao-modelos';

type Template={id:string;nome:string;idioma:string;estado:string;categoria:string|null;componentes:unknown;versao:number};
type Pedido={id?:string;nome:string;idioma:string;categoria:'UTILITY'|'MARKETING';componentes:unknown[];versao:number;idempotencia:string};
type Meta={token:string;wabaId:string;versao:string;ensaio:boolean};
type Resposta={id?:string;status?:string;category?:string;success?:boolean;data?:Record<string,unknown>[];paging?:{next?:string;cursors?:{after?:string}}};

export function validarTemplateOperacao(p:Record<string,unknown>,anterior?:Template):asserts p is Record<string,unknown>&Pedido {
 if(Object.keys(p).some(k=>!['id','nome','idioma','categoria','componentes','versao','idempotencia'].includes(k)))throw Error('OPERACAO_TEMPLATE_INVALIDO');
 validarIdOperacao(p.idempotencia);validarVersaoOperacao(p.versao);
 if(typeof p.nome!=='string'||! /^[a-z][a-z0-9_]{0,511}$/.test(p.nome)||typeof p.idioma!=='string'||! /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(p.idioma)||!['UTILITY','MARKETING'].includes(String(p.categoria)))throw Error('OPERACAO_TEMPLATE_INVALIDO');
 if(anterior&&(p.nome!==anterior.nome||p.idioma!==anterior.idioma||anterior.estado==='APPROVED'&&anterior.categoria&&p.categoria!==anterior.categoria))throw Error('OPERACAO_TEMPLATE_IDENTIDADE_INVALIDA');
 if(!Array.isArray(p.componentes)||!p.componentes.length||p.componentes.length>4||JSON.stringify(p.componentes).length>32768||p.componentes.some(c=>!objetoOperacao(c)))throw Error('OPERACAO_TEMPLATE_INVALIDO');
 const partes=p.componentes as Record<string,unknown>[];
 if(new Set(partes.map(c=>c.type)).size!==partes.length||partes.filter(c=>c.type==='BODY').length!==1)throw Error('OPERACAO_TEMPLATE_INVALIDO');
 for(const c of partes){
  if(c.type==='BODY'||c.type==='FOOTER'||c.type==='HEADER'&&c.format==='TEXT'){
   validarTextoOperacao(c.text,c.type==='BODY'?1024:60);
   if(c.type==='FOOTER'&&/\{\{|\}\}/.test(c.text))throw Error('OPERACAO_TEMPLATE_INVALIDO');
  }else if(!anterior||!(anterior.componentes as unknown[]).some(a=>hashOperacao(a)===hashOperacao(c)))throw Error('OPERACAO_TEMPLATE_COMPONENTE_INVALIDO');
 }
 // Componentes legados de mídia/botões ficam preservados. Novos são textuais.
 const textuais=partes.filter(c=>c.type==='BODY'||c.type==='FOOTER'||c.type==='HEADER'&&c.format==='TEXT');
 if(!modeloTextoSuportadoOperacao(textuais))throw Error('OPERACAO_TEMPLATE_VARIAVEIS_INVALIDAS');
 for(const c of textuais){
  const vars=variaveisModeloOperacao(c.type==='HEADER'?[c,{type:'BODY',text:'Corpo'}]:[c.type==='BODY'?c:{type:'BODY',text:'Corpo'}]);
  if(vars.length){const e=objetoOperacao(c.example)?c.example:{},v=c.type==='HEADER'?e.header_text:Array.isArray(e.body_text)?e.body_text[0]:null;
   if(!Array.isArray(v)||v.length!==vars.length)throw Error('OPERACAO_TEMPLATE_EXEMPLOS_INVALIDOS');
   v.forEach(s=>validarTextoOperacao(s,c.type==='HEADER'?60:1024));
  }
 }
}

/** Reserva durável antes da API. Resposta incerta nunca repete uma escrita Meta. */
export class ServicoTemplatesOperacao {
 constructor(private repo:RepositorioOperacaoPg,private meta:Meta,private buscar:typeof fetch=fetch){}
 private async requisitar(path:string,method='GET',body?:unknown):Promise<Resposta>{
  if(!/^v\d{1,3}\.0$/.test(this.meta.versao)||! /^\d{5,25}$/.test(this.meta.wabaId)||!this.meta.token)throw Error('OPERACAO_TEMPLATE_CONFIGURACAO_RECUSADA');
  const r=await this.buscar('https://graph.facebook.com/'+this.meta.versao+'/'+path,{method,headers:{Authorization:'Bearer '+this.meta.token,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!r.ok){await r.body?.cancel();throw Error(r.status>=500?'OPERACAO_TEMPLATE_RESULTADO_INCERTO':'OPERACAO_TEMPLATE_META_INVALIDO');}
  const raw=await r.text();if(raw.length>1024*1024)throw Error('OPERACAO_TEMPLATE_RESULTADO_INCERTO');
  let p:unknown;try{p=JSON.parse(raw);}catch{throw Error('OPERACAO_TEMPLATE_RESULTADO_INCERTO');}
  if(!objetoOperacao(p))throw Error('OPERACAO_TEMPLATE_RESULTADO_INCERTO');return p as Resposta;
 }
 async alterar(i:IdentidadeOperacao,p:Record<string,unknown>,excluir=false){
  validarIdOperacao(p.idempotencia);validarVersaoOperacao(p.versao);
  const capacidade=excluir?'modelos.excluir':p.id!==undefined?'modelos.editar':'modelos.adicionar';
  const hash=hashOperacao([i.id,p,excluir]);
  const reserva=await this.repo.transacao(async tx=>{
   await this.repo.exigir(tx,i,'modelos.visualizar');await this.repo.exigir(tx,i,capacidade);if(i.tipo&&i.tipo!=='usuario')throw Error('OPERACAO_AUTOR_RECUSADO');
   if(!this.meta.ensaio&&this.repo.modo()!=='operacao')throw Error('OPERACAO_SOMENTE_LEITURA');
   await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['template-comando:'+p.idempotencia]);
   const antes=await tx.query('SELECT * FROM atendimento_operacao.template_comando WHERE id=$1',[p.idempotencia]);
   if(antes.rowCount){const a=antes.rows[0];if(a.autor_id!==i.id||a.hash!==hash)throw Error('OPERACAO_IDEMPOTENCIA_DIVERGENTE');if(a.estado==='concluido')return {resultado:a.resultado};throw Error(a.estado==='recusado'?'OPERACAO_TEMPLATE_META_INVALIDO':'OPERACAO_TEMPLATE_RESULTADO_INCERTO');}
   if(p.id!==undefined&&(typeof p.id!=='string'||!/^[A-Za-z0-9_.:-]{1,180}$/.test(p.id)))throw Error('OPERACAO_TEMPLATE_INVALIDO');
   if(excluir&&p.escopo==='biblioteca'){
    const feito=await tx.query('SELECT autor_id,hash,resultado FROM atendimento_operacao.comando WHERE id=$1',[p.idempotencia]);
    if(feito.rowCount){if(feito.rows[0].autor_id!==i.id||feito.rows[0].hash!==hashOperacao([i.id,[p,excluir]]))throw Error('OPERACAO_IDEMPOTENCIA_DIVERGENTE');return {resultado:feito.rows[0].resultado};}
   }
   const atual=p.id?(await tx.query('SELECT * FROM atendimento_operacao.modelo WHERE id=$1 FOR UPDATE',[p.id])).rows[0] as Template|undefined:undefined;
   if(p.id&&!atual)throw Error('OPERACAO_TEMPLATE_AUSENTE');
   if(atual&&(Number(atual.versao)!==p.versao||atual.estado==='DELETED'))throw Error('OPERACAO_CONFLITO');
   if(excluir){if(Object.keys(p).some(k=>!['id','versao','idempotencia','escopo'].includes(k))||!atual)throw Error('OPERACAO_TEMPLATE_INVALIDO');}
   else validarTemplateOperacao(p,atual);
   if(excluir&&p.escopo!==undefined&&!['biblioteca','meta'].includes(String(p.escopo)))throw Error('OPERACAO_TEMPLATE_INVALIDO');
   if(excluir&&p.escopo==='biblioteca'){
    return {resultado:await this.repo.comando(tx,i,p.idempotencia as string,[p,excluir],async()=>{
     await this.repo.exigir(tx,i,'modelos.visualizar');await this.repo.exigir(tx,i,capacidade);
     if((await tx.query("SELECT 1 FROM atendimento_operacao.template_comando WHERE alvo=$1 AND estado IN ('processando','incerto')",[atual!.id])).rowCount)throw Error('OPERACAO_TEMPLATE_RESULTADO_INCERTO');
     await tx.query("UPDATE atendimento_operacao.modelo SET estado='DELETED',versao=versao+1,sincronizado_em=now() WHERE id=$1",[atual!.id]);
     await this.repo.auditar(tx,i,atual!.id,'template_excluir_concluido',Number(atual!.versao)+1);await this.repo.notificarChat(tx);
     return {id:atual!.id,estado:'DELETED',escopo:'biblioteca',simulado:this.meta.ensaio};
    })};
   }
   if(atual&&!this.meta.ensaio&&!/^\d{5,25}$/.test(atual.id))throw Error('OPERACAO_TEMPLATE_ID_INVALIDO');
   if(atual&&!excluir&&!['APPROVED','REJECTED','PAUSED'].includes(atual.estado))throw Error('OPERACAO_TEMPLATE_ESTADO_INVALIDO');
   const alvo=atual?.id??String(p.nome)+':'+String(p.idioma),acao=excluir?'excluir':atual?'editar':'criar';
   await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['template:'+alvo]);
   if((await tx.query("SELECT 1 FROM atendimento_operacao.template_comando WHERE alvo=$1 AND estado IN ('processando','incerto')",[alvo])).rowCount)throw Error('OPERACAO_TEMPLATE_RESULTADO_INCERTO');
   if(!atual&&(await tx.query("SELECT 1 FROM atendimento_operacao.modelo WHERE nome=$1 AND idioma=$2 AND estado<>'DELETED'",[p.nome,p.idioma])).rowCount)throw Error('OPERACAO_CONFLITO');
   await tx.query("INSERT INTO atendimento_operacao.template_comando(id,autor_id,hash,alvo,acao,pedido,anterior,estado) VALUES($1,$2,$3,$4,$5,$6,$7,'processando')",[p.idempotencia,i.id,hash,alvo,acao,JSON.stringify(p),atual?JSON.stringify(atual):null]);
   if(atual)await tx.query("UPDATE atendimento_operacao.modelo SET estado='PROCESSING',versao=versao+1 WHERE id=$1",[atual.id]);
   await this.repo.auditar(tx,i,alvo,'template_'+acao+'_solicitado',Number(atual?.versao??0)+1);
   return {atual,acao,alvo};
  });
  if('resultado' in reserva)return reserva.resultado;
  let remoto:Resposta;
  try{
   // Acesso revogado antes da chamada recusa a ação sem tocar a Meta.
   await this.repo.transacao(async tx=>{await this.repo.exigir(tx,i,'modelos.visualizar');await this.repo.exigir(tx,i,capacidade);});
   if(this.meta.ensaio)remoto={id:reserva.atual?.id??'fixture-'+randomUUID(),status:'PENDING',success:true};
   else if(excluir)remoto=await this.requisitar(this.meta.wabaId+'/message_templates?'+new URLSearchParams({hsm_id:reserva.atual!.id,name:reserva.atual!.nome}),'DELETE');
   else remoto=await this.requisitar(reserva.atual?.id??this.meta.wabaId+'/message_templates','POST',reserva.atual?{components:p.componentes,...reserva.atual.estado!=='APPROVED'?{category:p.categoria}:{}}:{name:p.nome,language:p.idioma,category:p.categoria,components:p.componentes});
   if(excluir&&remoto.success!==true||!excluir&&!reserva.atual&&(!remoto.id||!/^\d{5,25}$/.test(remoto.id)&&!this.meta.ensaio)||!excluir&&reserva.atual&&remoto.success!==true)throw Error('OPERACAO_TEMPLATE_RESULTADO_INCERTO');
  }catch(e){
   const recusado=e instanceof Error&&['OPERACAO_TEMPLATE_META_INVALIDO','OPERACAO_ACESSO_NEGADO','OPERACAO_TEMPLATE_CONFIGURACAO_RECUSADA'].includes(e.message);
   await this.repo.transacao(async tx=>{
    await tx.query('UPDATE atendimento_operacao.template_comando SET estado=$2,atualizada_em=now() WHERE id=$1',[p.idempotencia,recusado?'recusado':'incerto']);
    if(reserva.atual&&recusado)await tx.query('UPDATE atendimento_operacao.modelo SET estado=$2 WHERE id=$1',[reserva.atual.id,reserva.atual.estado]);
    await this.repo.auditar(tx,i,reserva.alvo,'template_'+(recusado?'recusado':'incerto'),Number(reserva.atual?.versao??0)+1);
   });
   throw Error(recusado?'OPERACAO_TEMPLATE_META_INVALIDO':'OPERACAO_TEMPLATE_RESULTADO_INCERTO');
  }
  return this.repo.transacao(async tx=>{
   const id=reserva.atual?.id??remoto.id!,estado=excluir?'DELETED':remoto.status==='APPROVED'?'APPROVED':'PENDING';
   if(excluir)await tx.query("UPDATE atendimento_operacao.modelo SET estado='DELETED',sincronizado_em=now() WHERE id=$1",[id]);
   else await tx.query('INSERT INTO atendimento_operacao.modelo(id,nome,idioma,estado,componentes,categoria,versao) VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT(id) DO UPDATE SET estado=$4,componentes=$5,categoria=$6,sincronizado_em=now()',[id,p.nome,p.idioma,estado,JSON.stringify(p.componentes),remoto.category??p.categoria]);
   const resultado={id,estado,simulado:this.meta.ensaio};
   await tx.query("UPDATE atendimento_operacao.template_comando SET estado='concluido',resultado=$2,atualizada_em=now() WHERE id=$1",[p.idempotencia,JSON.stringify(resultado)]);
   await this.repo.auditar(tx,i,id,'template_'+reserva.acao+'_concluido',Number(reserva.atual?.versao??0)+1);await this.repo.notificarChat(tx);return resultado;
  });
 }
 async sincronizar(i:IdentidadeOperacao){
  const autorizar=async(tx:Parameters<RepositorioOperacaoPg['exigir']>[0])=>{await this.repo.exigir(tx,i,'modelos.visualizar');await this.repo.exigir(tx,i,'modelos.sincronizacao.visualizar');await this.repo.exigir(tx,i,'modelos.sincronizar');if(i.tipo&&i.tipo!=='usuario')throw Error('OPERACAO_AUTOR_RECUSADO');};
  await this.repo.transacao(autorizar);
  if(this.meta.ensaio)return {sincronizados:0,simulado:true};
  const registros:Record<string,unknown>[]=[];let after:string|undefined;
  do{const p=await this.requisitar(this.meta.wabaId+'/message_templates?'+new URLSearchParams({fields:'id,name,language,status,category,components',limit:'100',...(after?{after}:{})}));
   if(!Array.isArray(p.data)||registros.length+p.data.length>1000)throw Error('OPERACAO_TEMPLATE_RESPOSTA_INVALIDA');registros.push(...p.data);after=p.paging?.next?p.paging.cursors?.after:undefined;if(!p.data.length)after=undefined;
  }while(after);
  for(const m of registros)if(!/^\d{5,25}$/.test(String(m.id))||typeof m.name!=='string'||typeof m.language!=='string'||typeof m.status!=='string'||!Array.isArray(m.components))throw Error('OPERACAO_TEMPLATE_RESPOSTA_INVALIDA');
  return this.repo.transacao(async tx=>{await autorizar(tx);for(const m of registros){
   await tx.query('SELECT id FROM atendimento_operacao.modelo WHERE id=$1 FOR UPDATE',[m.id]);
   // Resultado incerto permanece bloqueado até conciliação explícita. Não o reenvia.
   if((await tx.query("SELECT 1 FROM atendimento_operacao.template_comando WHERE alvo IN ($1,$2) AND estado IN ('processando','incerto')",[m.id,m.name+':'+m.language])).rowCount)continue;
   await tx.query("INSERT INTO atendimento_operacao.modelo(id,nome,idioma,estado,componentes,categoria) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET estado=$4,componentes=$5,categoria=$6,versao=CASE WHEN (atendimento_operacao.modelo.estado,atendimento_operacao.modelo.componentes,atendimento_operacao.modelo.categoria) IS DISTINCT FROM ($4,$5::jsonb,$6) THEN atendimento_operacao.modelo.versao+1 ELSE atendimento_operacao.modelo.versao END,sincronizado_em=now() WHERE atendimento_operacao.modelo.estado<>'DELETED'",[m.id,m.name,m.language,m.status,JSON.stringify(m.components),m.category??null]);
  }await this.repo.auditar(tx,i,'templates','template_sincronizar',registros.length);return {sincronizados:registros.length,simulado:false};});
 }
}
