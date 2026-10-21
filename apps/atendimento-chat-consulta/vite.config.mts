import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
const local=(s:string)=>fileURLToPath(new URL(s,import.meta.url));
export default defineConfig(({mode})=>({root:local('./'),base:mode==='operacao'?'/operacao/':'/consulta/',envDir:false,resolve:{alias:{'@':local('../../src')},dedupe:['react','react-dom']},css:{postcss:{plugins:[]}},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:4192,strictPort:true},build:{outDir:local(mode==='operacao'?'../../.tmp-homologacao/operacao-release/web':'../../.tmp-homologacao/chat-consulta-release/web'),emptyOutDir:true}}));
