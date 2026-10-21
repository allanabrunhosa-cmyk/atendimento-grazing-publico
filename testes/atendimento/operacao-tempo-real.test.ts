import {EventEmitter} from 'node:events';
import {expect,it,vi} from 'vitest';
import type {Pool} from 'pg';
import {SinalChatOperacao} from '../../src/lib/atendimento/operacao-tempo-real';
it('compartilha um LISTEN, retoma após desconexão e libera a conexão ao fechar a última sessão',async()=>{
 vi.useFakeTimers();const conexoes:EventEmitter[]=[];
 const pool={connect:vi.fn(async()=>{const c=Object.assign(new EventEmitter(),{query:vi.fn(async()=>undefined),release:vi.fn()});conexoes.push(c);return c;})} as unknown as Pool;
 const sinal=new SinalChatOperacao(pool),a=vi.fn(),b=vi.fn(),fecharA=sinal.observar(a),fecharB=sinal.observar(b);
 try{await vi.waitFor(()=>expect(a).toHaveBeenCalledOnce());expect(pool.connect).toHaveBeenCalledOnce();conexoes[0].emit('notification',{channel:'donatella_chat_alterado',payload:'1'});expect(a).toHaveBeenCalledTimes(2);expect(b).toHaveBeenCalledTimes(2);fecharA();conexoes[0].emit('notification');expect(a).toHaveBeenCalledTimes(2);expect(b).toHaveBeenCalledTimes(3);conexoes[0].emit('error',Error('FALHA_FICTICIA'));await vi.advanceTimersByTimeAsync(3000);expect(pool.connect).toHaveBeenCalledTimes(2);expect(b).toHaveBeenCalledTimes(4);fecharB();expect(conexoes[1].listenerCount('notification')).toBe(0);await vi.advanceTimersByTimeAsync(10000);expect(pool.connect).toHaveBeenCalledTimes(2);}finally{fecharA();fecharB();vi.useRealTimers();}
});
it('sinaliza apenas a chegada de cliente; conexão e alterações comuns não são mensagem nova',async()=>{
 const c=Object.assign(new EventEmitter(),{query:vi.fn(async()=>undefined),release:vi.fn()});
 const pool={connect:vi.fn(async()=>c)} as unknown as Pool,avisar=vi.fn(),fechar=new SinalChatOperacao(pool).observar(avisar);
 try{await vi.waitFor(()=>expect(avisar).toHaveBeenLastCalledWith(false));c.emit('notification',{channel:'donatella_chat_alterado',payload:'mensagem_cliente'});expect(avisar).toHaveBeenLastCalledWith(true);c.emit('notification',{channel:'donatella_chat_alterado',payload:'1'});expect(avisar).toHaveBeenLastCalledWith(false);}finally{fechar();}
});
