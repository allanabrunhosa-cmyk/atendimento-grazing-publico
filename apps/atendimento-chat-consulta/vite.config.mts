import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
const local=(s:string)=>fileURLToPath(new URL(s,import.meta.url));
type ApiFicticia={atender:(req:IncomingMessage,res:ServerResponse)=>Promise<boolean>};
/** Modo ficticio: o painel conversa com uma API em memória dentro do próprio
 * servidor de desenvolvimento. Sem banco, IA, WhatsApp ou WooCommerce. */
function apiFicticia():Plugin{
 return {name:'atendimento-api-ficticia',apply:'serve',
  configureServer(server){
   let api:Promise<ApiFicticia>|undefined;
   server.middlewares.use((req,res,next)=>{
    if(!req.url?.startsWith('/api/atendimento/operacao/')){next();return;}
    api??=server.ssrLoadModule(local('../../scripts/atendimento/ficticio/api-ficticia.ts')).then(m=>(m as {criarApiFicticia:()=>Promise<ApiFicticia>}).criarApiFicticia());
    api.then(a=>a.atender(req,res)).then(atendido=>{if(!atendido)next();},next);
   });
  }};
}
export default defineConfig(({mode})=>({root:local('./'),base:mode==='operacao'||mode==='ficticio'?'/operacao/':'/consulta/',plugins:mode==='ficticio'?[apiFicticia()]:[],envDir:false,resolve:{alias:{'@':local('../../src'),...(mode==='ficticio'?{'server-only':local('../../node_modules/server-only/empty.js')}:{})},dedupe:['react','react-dom']},css:{postcss:{plugins:[]}},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:4192,strictPort:true,...(mode==='ficticio'?{open:'/operacao/chat?ambiente=ensaio'}:{})},build:{outDir:local(mode==='operacao'?'../../.tmp-homologacao/operacao-release/web':'../../.tmp-homologacao/chat-consulta-release/web'),emptyOutDir:true}}));
