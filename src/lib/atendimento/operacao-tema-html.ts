import {randomBytes} from 'node:crypto';
export const nonceTemaAtendimento=()=>randomBytes(18).toString('base64');
function validarNonce(nonce:string){if(!/^[A-Za-z0-9+/]{24}$/.test(nonce))throw Error('TEMA_NONCE_INVALIDO');}
/** Permite apenas o bootstrap da aparência, sem liberar scripts arbitrários. */
export function politicaHtmlAtendimento(nonce:string){validarNonce(nonce);return `default-src 'self'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://grazingtable.com.br https://www.grazingtable.com.br; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;}
export function htmlTemaAtendimento(html:string,nonce:string){validarNonce(nonce);if(!html.includes('</head>'))throw Error('TEMA_HTML_INVALIDO');return html.replace('</head>',`<meta name="csp-nonce" content="${nonce}"></head>`);}
