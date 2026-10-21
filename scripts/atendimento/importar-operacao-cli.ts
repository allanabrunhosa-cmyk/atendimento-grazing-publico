import {readFile} from 'node:fs/promises';
import {importarOperacao,type ConfiguracaoImportacaoOperacao} from './importar-operacao';
try{
 const caminho=process.argv[2];if(!caminho||caminho.startsWith('--'))throw Error('ARQUIVO_PRIVADO_EXIGIDO');
 const c=JSON.parse(await readFile(caminho,'utf8')) as ConfiguracaoImportacaoOperacao;
 console.log(JSON.stringify(await importarOperacao(c)));
}catch(e){
 console.error(JSON.stringify({erro:e instanceof Error&&/^[A-Z0-9_]{1,80}$/.test(e.message)?e.message:'IMPORTACAO_FALHOU',enviosExternos:0}));
 process.exitCode=1;
}
