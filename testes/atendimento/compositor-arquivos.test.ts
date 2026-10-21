import {it,expect} from 'vitest';
import {conferirArquivoCompositor,limitarTextoCompositor} from '../../apps/atendimento-chat-consulta/compositor-arquivos';

it.each([['imagem.png','image/png',5],['documento.pdf','application/pdf',20],['audio.amr','audio/amr',16]] as const)('aceita o limite de %s e recusa um byte extra antes do upload',(nome,mime,mb)=>{
 const arquivo={name:nome,type:mime,size:mb*1024*1024} as File;
 expect(conferirArquivoCompositor(arquivo)).toMatchObject({mime,limite:arquivo.size});
 expect(()=>conferirArquivoCompositor({...arquivo,size:arquivo.size+1} as File)).toThrow('excede');
});
it('aceita imagem de 4 MB e MIME omitido, mas não contorna formato explícito divergente',()=>{
 expect(conferirArquivoCompositor({name:'imagem.png',type:'',size:4*1024*1024} as File)).toMatchObject({mime:'image/png',tipo:'image'});
 expect(()=>conferirArquivoCompositor({name:'foto.svg',type:'image/svg+xml',size:100} as File)).toThrow('Formato não suportado');
 expect(()=>conferirArquivoCompositor({name:'imagem.png',type:'application/x-executable',size:100} as File)).toThrow('Formato não suportado');
 expect(()=>conferirArquivoCompositor({name:'vazio.pdf',type:'application/pdf',size:0} as File)).toThrow('vazio');
});
it('preserva emojis recebidos, acentos, modificadores e sequências familiares sem corte parcial',()=>{
 const emoji='👨‍👩‍👧‍👦',texto='Olá 💜👍🏽 '+emoji;expect(limitarTextoCompositor(texto,100)).toBe(texto);
 expect(limitarTextoCompositor('123'+emoji,4)).toBe('123');
 expect(limitarTextoCompositor('123👍🏽',6)).toBe('123');
 expect(limitarTextoCompositor('123🙂',5)).toBe('123🙂');
 expect(limitarTextoCompositor('Olá\u0000🙂\n',20)).toBe('Olá🙂\n');
});
