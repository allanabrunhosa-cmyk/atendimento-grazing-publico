type Entrada={arquivo:string;sha256:string;bytes:number;metadata?:{eTag:string}};
export type ObjetoConsulta={id:string;bucket_id:string;name:string;metadata:{eTag?:string;size?:number}};
export function criarLeitorArquivos(inicial:Record<string,Entrada[]>,lerIncrementais:(objeto:ObjetoConsulta)=>Promise<Entrada[]>){
 return async(o:ObjetoConsulta)=>{
  if(!['whatsapp-media','audio-messages'].includes(o.bucket_id)||typeof o.metadata?.eTag!=='string'||!Number.isSafeInteger(o.metadata.size)||o.metadata.size!<0||o.metadata.size!>64*1024*1024)throw Error('ANEXO_METADATA_INVALIDA');
  function conferir(r:Entrada){if(!/^[a-f0-9]{64}$/.test(r.sha256)||r.arquivo!==r.sha256+'.bin'||r.bytes!==o.metadata.size)throw Error('ANEXO_INDICE_DIVERGENTE');return r;}
  const antigos=(inicial[o.bucket_id+'/'+o.name]??[]).filter(v=>v.metadata?.eTag===o.metadata.eTag&&v.bytes===o.metadata.size);
  if(antigos.length){const r=conferir(antigos[0]);if(antigos.some(v=>v.sha256!==r.sha256))throw Error('ANEXO_INDICE_DIVERGENTE');return {...r,raiz:'/midia'};}
  const novos=await lerIncrementais(o);if(!novos.length)return null;
  const r=conferir(novos[0]);if(novos.some(v=>v.sha256!==r.sha256||v.bytes!==r.bytes||v.arquivo!==r.arquivo))throw Error('ANEXO_INDICE_DIVERGENTE');
  return {...r,raiz:'/incrementais/arquivos/conteudos'};
 };
}
