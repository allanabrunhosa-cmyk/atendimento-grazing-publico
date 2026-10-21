import {defineConfig} from 'vite';
import {fileURLToPath} from 'node:url';
const local=(p:string)=>fileURLToPath(new URL(p,import.meta.url));
export default defineConfig({root:local('./'),envDir:false,cacheDir:local('../../../.tmp/vite-audio'),resolve:{alias:{'@':local('../../../src')},dedupe:['react','react-dom']},css:{postcss:{plugins:[]}},server:{host:'127.0.0.1',port:4254,strictPort:true},esbuild:{jsx:'automatic'}});
