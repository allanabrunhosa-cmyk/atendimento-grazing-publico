import 'server-only';
/** Retoma somente IDs que já têm arquivo externo e commit integral conferidos.
 * Resposta 0 é idempotente; nunca confirma por ausência em uma leitura pontual.
 */
export async function retomarConfirmacoes(ids:string[],operacoes:{verificar:(id:string)=>Promise<void>;confirmar:(id:string)=>Promise<unknown>;registrar:(id:string)=>Promise<void>}){
 if(ids.length>20||new Set(ids).size!==ids.length||ids.some(id=>!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)))throw Error('RETOMADA_INVALIDA');
 for(const id of ids){await operacoes.verificar(id);const resposta=await operacoes.confirmar(id);if(resposta!==0&&resposta!==1)throw Error('CONFIRMACAO_INVALIDA');await operacoes.registrar(id);}
 return{retomadas:ids.length};
}
