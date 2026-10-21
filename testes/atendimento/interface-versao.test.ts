import {expect,it} from 'vitest';
import {interfacePublicadaAtendimento} from '../../src/lib/atendimento/operacao-interface-versao';

it('identifica o mesmo arquivo público referenciado pelo HTML operacional',()=>{
 expect(interfacePublicadaAtendimento('<html><head><script type="module" crossorigin src="/operacao/assets/index-CadlYV6L.js"></script></head></html>')).toBe('/operacao/assets/index-CadlYV6L.js');
 expect(()=>interfacePublicadaAtendimento('<script src="https://outro.invalid/index-antigo.js"></script>')).toThrow('INTERFACE_PUBLICADA_INVALIDA');
 expect(()=>interfacePublicadaAtendimento('<html></html>')).toThrow('INTERFACE_PUBLICADA_INVALIDA');
});
