type VariaveisCss = Readonly<Record<`--${string}`, string>>;
type IdentidadePrevia = {
  id: 'atendimento-preview';
  situacao: 'Em revisão';
  referencia: string;
  componenteMarca: 'src/components/logo.tsx#LogoMark';
  monograma: 'GA';
  fonteGeometria: readonly string[];
  papeis: VariaveisCss;
  dimensoes: VariaveisCss;
};

// Registro fechado exclusivamente da prévia. A direção visual foi aprovada;
// a implementação permanece em revisão, sem publicar tema na Central do HUB.
export const IDENTIDADE_PREVIEW = {
  id: 'atendimento-preview',
  situacao: 'Em revisão',
  referencia: 'Dashboard de Atendimento Grazing Hub.png',
  componenteMarca: 'src/components/logo.tsx#LogoMark',
  monograma: 'GA',
  fonteGeometria: ['src/components/layout/menu-pedidos.tsx', 'src/components/layout/sidebar.tsx', 'src/components/logo-etiquetas.tsx', 'src/app/globals.css'],
  papeis: {
    '--primary': '#6200d6',
    '--primary-hover': '#5100b8',
    '--foreground': '#17134d',
    '--muted': '#65649a',
    '--muted-foreground': '#65649a',
    '--border': '#e7e4fa',
    '--card': '#fff',
    '--surface': '#f8f7ff',
    '--danger': '#dc2626',
    '--editar': 'oklch(0.5 0.14 78)',
    '--editar-bg': 'oklch(0.95 0.1 90)',
    // Mesma semântica de confirmação do HUB (globals.css).
    '--success': 'oklch(0.5 0.13 152)',
    '--success-foreground': 'var(--brand-white)',
    '--contato-lead-bg': '#dbeafe',
    '--contato-lead-texto': '#1e40af',
    '--contato-cliente-bg': '#1d4ed8',
    '--contato-cliente-texto': 'var(--brand-white)',
    '--brand-navy': '#210954',
    '--brand-blue': '#a378ff',
    '--brand-white': '#fff',
    '--font-heading': '"Segoe UI"',
    '--font-sans': '"Segoe UI"',
  },
  dimensoes: {
    '--radius': '16px',
    '--preview-menu-largura': '256px',
    '--preview-menu-raio': '24px',
    '--preview-estrutura-espaco': '16px',
    '--preview-menu-desfoque': '32px',
  },
} as const satisfies IdentidadePrevia;

export function aplicarIdentidadePreview(documentoIsolado: HTMLElement) {
  documentoIsolado.dataset.identidadePreview = IDENTIDADE_PREVIEW.id;
  documentoIsolado.dataset.revisaoVisual = IDENTIDADE_PREVIEW.situacao;
  for (const [nome, valor] of Object.entries({ ...IDENTIDADE_PREVIEW.papeis, ...IDENTIDADE_PREVIEW.dimensoes })) {
    documentoIsolado.style.setProperty(nome, valor);
  }
}
