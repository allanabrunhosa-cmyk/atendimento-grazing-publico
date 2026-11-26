import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
const local=(s:string)=>fileURLToPath(new URL(s,import.meta.url));
type ApiFicticia={atender:(req:IncomingMessage,res:ServerResponse)=>Promise<boolean>};
type IaFicticia={chave:string;tetoUsd:number};
type CatalogoLocal={site:string;produtos:unknown[]};
/** Conversa de teste com IA real: só com a chave no ambiente do próprio computador.
 * A variável sai do processo depois de lida e nunca vai para o navegador. */
function iaFicticia():IaFicticia|undefined{
 const chave=process.env.DONATELLA_FICTICIA_CHAVE?.trim(),teto=Number(process.env.DONATELLA_FICTICIA_TETO_USD??'1');delete process.env.DONATELLA_FICTICIA_CHAVE;
 if(!chave||!Number.isFinite(teto)||teto<=0||teto>20)return undefined;
 process.env.ATENDIMENTO_IA_HABILITADA='true';return {chave,tetoUsd:teto};
}
/** Modo ficticio: o painel conversa com uma API em memória dentro do próprio
 * servidor de desenvolvimento. Sem banco, WhatsApp ou WooCommerce. IA, só na
 * conversa de teste e só com a chave de quem testa. */
function apiFicticia():Plugin{
 return {name:'atendimento-api-ficticia',apply:'serve',
  configureServer(server){
   const ia=iaFicticia();let api:Promise<ApiFicticia>|undefined;
   server.middlewares.use((req,res,next)=>{
    if(req.method==='GET'&&/^\/operacao\/conversa-teste(?:\?|$)/.test(req.url??'')){
     readFile(local('../../scripts/atendimento/ficticio/conversa-teste.html')).then(html=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(html);},next);return;
    }
    if(!req.url?.startsWith('/api/atendimento/operacao/')){next();return;}
    api??=server.ssrLoadModule(local('../../scripts/atendimento/ficticio/api-ficticia.ts')).then(async m=>{const catalogo=await catalogoFicticio();return (m as {criarApiFicticia:(o:{ia?:IaFicticia;catalogo?:CatalogoLocal})=>Promise<ApiFicticia>}).criarApiFicticia({...(ia?{ia}:{}),...(catalogo?{catalogo}:{})});});
    api.then(a=>a.atender(req,res)).then(atendido=>{if(!atendido)next();},next);
   });
  }};
}
/** Catálogo local de quem testa, lido do arquivo indicado, fora do projeto. */
async function catalogoFicticio():Promise<CatalogoLocal|undefined>{
 const arquivo=process.env.DONATELLA_FICTICIA_CATALOGO;
 return arquivo?JSON.parse(await readFile(arquivo,'utf8')) as CatalogoLocal:undefined;
}
export default defineConfig(({mode})=>({root:local('./'),base:mode==='operacao'||mode==='ficticio'?'/operacao/':'/consulta/',plugins:mode==='ficticio'?[apiFicticia()]:[],envDir:false,resolve:{alias:{'@':local('../../src'),...(mode==='ficticio'?{'server-only':local('../../node_modules/server-only/empty.js')}:{})},dedupe:['react','react-dom']},css:{postcss:{plugins:[]}},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:4192,strictPort:true,...(mode==='ficticio'?{open:'/operacao/chat?ambiente=ensaio'}:{})},build:{outDir:local(mode==='operacao'?'../../.tmp-homologacao/operacao-release/web':'../../.tmp-homologacao/chat-consulta-release/web'),emptyOutDir:true}}));
