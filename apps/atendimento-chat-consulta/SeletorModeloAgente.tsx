import { useState } from 'react';
import { Aperture, Check, ChevronDown, Plus, Search, Sparkle } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '../../src/components/ui/popover';
import type { OpcoesAgenteOperacao, ProvedorOperacao } from './operacao-api';
import { ESFORCOS_IA, NOME_ESFORCO, perfilModeloIA, type EsforcoIA } from '../../src/lib/atendimento/ia-modelos';
import './SeletorModeloAgente.css';

type Provedor = OpcoesAgenteOperacao['provedores'][number];
type Props = {
 opcoes: OpcoesAgenteOperacao|null;
 provedor: ProvedorOperacao;
 modelo: string;
 /** O que está salvo no servidor, marcado como "em uso" na lista. */
 salvo: { provedor: ProvedorOperacao; modelo: string };
 /** Sem valor, vale o padrão do modelo. */
 esforco?: EsforcoIA;
 disabled?: boolean;
 onChange: (provedor: ProvedorOperacao, modelo: string) => void;
 onEsforco: (esforco: EsforcoIA) => void;
};

const FAMILIA: Record<ProvedorOperacao, { nome: string; empresa: string }> = {
 anthropic: { nome: 'Claude', empresa: 'Anthropic' },
 google: { nome: 'Gemini', empresa: 'Google' },
 openai: { nome: 'OpenAI', empresa: 'OpenAI' },
};
/** Datas anunciadas pelo provedor para desligar o modelo. */
export const DESLIGAMENTO_MODELOS: Readonly<Record<string, string>> = { 'claude-sonnet-4-5': '30/11/2026', 'claude-sonnet-4-5-20250929': '30/11/2026' };

/** Nome legível quando o servidor só informa o identificador do modelo. */
export function nomeModelo(id: string, nome = id) {
 if (nome && nome !== id) return nome;
 const m = /^claude-(opus|sonnet|haiku|fable|mythos)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
 return m ? `Claude ${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}` : id;
}
const normalizar = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('pt-BR');
const situacao = (p?: Provedor) => !p ? 'não conferido' : !p.configurado ? 'não configurado' : !p.disponivel ? 'indisponível' : 'configurado';

const RAIOS = Array.from({ length: 12 }, (_, i) => {
 const a = (i * 30 - 90) * Math.PI / 180, r = i % 2 ? 7.5 : 10;
 return [12 + Math.cos(a) * 2.6, 12 + Math.sin(a) * 2.6, 12 + Math.cos(a) * r, 12 + Math.sin(a) * r].map(v => Math.round(v * 100) / 100);
});
function IconeProvedor({ id }: { id: ProvedorOperacao }) {
 if (id === 'google') return <Sparkle size={18} aria-hidden="true"/>;
 if (id === 'openai') return <Aperture size={18} aria-hidden="true"/>;
 return <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">{RAIOS.map(([x1, y1, x2, y2], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}/>)}</svg>;
}

/** Escolha de provedor e modelo: provedores na barra lateral, busca e lista de modelos. */
export default function SeletorModeloAgente({ opcoes, provedor, modelo, salvo, esforco, disabled = false, onChange, onEsforco }: Props) {
 const [aberto, setAberto] = useState(false), [vendo, setVendo] = useState<ProvedorOperacao|'adicionar'>(provedor), [busca, setBusca] = useState('');
 const provedores = opcoes?.provedores ?? [], atual = provedores.find(p => p.id === provedor), atualModelo = atual?.modelos.find(m => m.id === modelo);
 const exibido = vendo === 'adicionar' ? null : provedores.find(p => p.id === vendo) ?? null, termo = normalizar(busca.trim());
 const modelos = (exibido?.modelos ?? []).filter(m => !termo || normalizar(`${nomeModelo(m.id, m.nome)} ${m.id}`).includes(termo));
 const perfil = perfilModeloIA(provedor, modelo), esforcoAtual = perfil ? esforco ?? perfil.esforcoPadrao : undefined;
 const abrir = (v: boolean) => { setAberto(v); if (v) { setVendo(provedor); setBusca(''); } };
 return <Popover open={aberto} onOpenChange={abrir}>
  <PopoverTrigger className="field seletor-modelo-gatilho" aria-label="Provedor e modelo da agente" disabled={disabled}>
   <span className="seletor-modelo-icone"><IconeProvedor id={provedor}/></span>
   <span className="seletor-modelo-resumo"><strong>{modelo ? nomeModelo(modelo, atualModelo?.nome) : 'Nenhum modelo escolhido'}</strong><small>{FAMILIA[provedor].empresa} · {situacao(atual)}{esforcoAtual ? ` · esforço ${NOME_ESFORCO[esforcoAtual].toLocaleLowerCase('pt-BR')}` : ''}</small></span>
   <ChevronDown size={18} aria-hidden="true"/>
  </PopoverTrigger>
  <PopoverContent className="seletor-modelo" align="start" aria-label="Escolher provedor e modelo">
   <nav className="seletor-modelo-trilho" aria-label="Provedores">
    {provedores.map(p => <button key={p.id} type="button" className="seletor-modelo-provedor" aria-pressed={vendo === p.id} aria-label={FAMILIA[p.id].nome} title={`${FAMILIA[p.id].nome} · ${situacao(p)}`} data-inativo={!(p.configurado && p.disponivel) || undefined} onClick={() => { setVendo(p.id); setBusca(''); }}><IconeProvedor id={p.id}/></button>)}
    <button type="button" className="seletor-modelo-provedor" aria-pressed={vendo === 'adicionar'} aria-label="Adicionar provedor" title="Adicionar provedor" onClick={() => setVendo('adicionar')}><Plus size={18} aria-hidden="true"/></button>
   </nav>
   <div className="seletor-modelo-corpo">
    {exibido ? <>
     <header><strong>{FAMILIA[exibido.id].nome}</strong><small>{FAMILIA[exibido.id].empresa} · {situacao(exibido)}</small></header>
     {exibido.modelos.length > 0 && <label className="seletor-modelo-busca"><Search size={16} aria-hidden="true"/><input type="search" placeholder="Buscar modelos" aria-label="Buscar modelos" maxLength={80} value={busca} onChange={e => setBusca(e.target.value)}/></label>}
     {modelos.length ? <div className="seletor-modelo-lista" role="radiogroup" aria-label={`Modelos ${FAMILIA[exibido.id].nome}`}>
      {modelos.map(m => {
       const escolhivel = exibido.configurado && exibido.disponivel && m.disponivel, marcado = exibido.id === provedor && m.id === modelo;
       const emUso = exibido.id === salvo.provedor && m.id === salvo.modelo, desliga = DESLIGAMENTO_MODELOS[m.id], nome = nomeModelo(m.id, m.nome);
       return <button key={m.id} type="button" role="radio" aria-checked={marcado} disabled={!escolhivel} className="seletor-modelo-item" title={m.id}
        aria-label={nome + (emUso ? ', em uso' : '') + (desliga ? `, desligado pelo provedor em ${desliga}` : '')}
        onClick={() => { if (!escolhivel) return; onChange(exibido.id, m.id); setAberto(false); }}>
        <span className="seletor-modelo-marca" aria-hidden="true">{marcado && <Check size={12} strokeWidth={3.2}/>}</span>
        <span className="seletor-modelo-nome">{nome}</span>
        {emUso && <span className="seletor-modelo-selo">em uso</span>}
        {desliga && <span className="seletor-modelo-selo aviso">sai {desliga.slice(0, 5)}</span>}
        {exibido.configurado && !m.disponivel && <span className="seletor-modelo-selo">indisponível</span>}
       </button>;
      })}
     </div> : <p className="seletor-modelo-vazio">{termo ? 'Nenhum modelo com esse nome.' : exibido.configurado ? 'Nenhum modelo liberado para este provedor.' : 'Nenhum modelo registrado. A chave deste provedor é cadastrada no servidor por quem administra o sistema.'}</p>}
     {!exibido.configurado && modelos.length > 0 && <p className="seletor-modelo-nota">Sem chave no servidor, os modelos aparecem mas não podem ser escolhidos.</p>}
    </> : vendo === 'adicionar' ? <>
     <header><strong>Adicionar provedor</strong><small>Credenciais ficam só no servidor</small></header>
     <p className="seletor-modelo-vazio">Quem administra o servidor cadastra a chave e os modelos liberados. Depois disso o provedor aparece nesta barra. Nenhuma chave passa por esta tela.</p>
    </> : <p className="seletor-modelo-vazio" role="status">{opcoes ? 'Este provedor não foi listado pelo servidor.' : 'Conferindo os modelos disponíveis…'}</p>}
   </div>
   <footer className="seletor-modelo-rodape">
    <span id="seletor-modelo-esforco">Esforço</span>
    {esforcoAtual ? <div className="seletor-modelo-esforco" role="radiogroup" aria-labelledby="seletor-modelo-esforco">
     {ESFORCOS_IA.map(e => <button key={e} type="button" role="radio" aria-checked={esforcoAtual === e} disabled={disabled} title={e === perfil?.esforcoPadrao ? 'Padrão do modelo' : undefined} onClick={() => onEsforco(e)}>{NOME_ESFORCO[e]}</button>)}
    </div> : <small>{modelo ? `Sem ajuste no ${nomeModelo(modelo, atualModelo?.nome)}` : 'Escolha um modelo'}</small>}
   </footer>
  </PopoverContent>
 </Popover>;
}
