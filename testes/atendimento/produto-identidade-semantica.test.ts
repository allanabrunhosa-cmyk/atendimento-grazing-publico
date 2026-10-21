import {describe,expect,it} from 'vitest';
import {identidadeProdutoSemantica,produtosSemanticamenteEquivalentes} from '../../src/lib/atendimento/produto-identidade-semantica';

describe('Identidade semântica de produtos HUB e loja',()=>{
 it.each([
  ['Grazing para 1','Grazing para 1 - tábua de frios'],
  ['Grazing para 1','Tábua de frios Grazing individual'],
  ['Grazing para 2','Grazing para duas pessoas — Tábua de queijos e frios'],
  ['Brie Folhado com Mel','<b>Brie</b> folhado com mel'],
  ['Brie Folhado com Mel','Mel e Brie Folhado'],
  ['Grazing Vegetariano para 1','Grazing vegetariana individual - tábua de frios'],
  ['Grazing pequena para 2','Grazing pequeno para duas pessoas'],
  ['Brie Folhado 500 g','Brie Folhado 0,5 kg'],
  ['Brie Folhado 500 g','Brie Folhado .5 kg'],
  ['Suco 1 litro','Suco 1000 ml'],
  ['Grazing para 1 — tábua de frios','Grazing para 1 &ndash; t&aacute;bua de frios'],
 ])('reconhece equivalência comercial clara: %s / %s',(hub,woo)=>expect(produtosSemanticamenteEquivalentes(hub,woo)).toBe(true));

 it.each([
  ['Grazing para 1','Grazing para 2 - tábua de frios'],
  ['Grazing para 1','Grazing para 10'],
  ['Grazing para 1','Grazing para 1 e 2'],
  ['Grazing para 1','Kit Grazing para 1'],
  ['Grazing para 1','Grazing para 1 - versão especial'],
  ['Grazing para 1','Grazing para 1 com vinho'],
  ['Grazing para 1','Grazing vegetariano para 1'],
  ['Grazing vegano para 1','Grazing vegetariano para 1'],
  ['Grazing sem glúten para 1','Grazing para 1'],
  ['Grazing sem leite para 1','Grazing com leite para 1'],
  ['Grazing pequeno para 1','Grazing grande para 1'],
  ['Brie Folhado com Mel','Brie Folhado com Damasco'],
  ['Brie Folhado 500 g','Brie Folhado 1 kg'],
  ['Brie Folhado 5 kg','Brie Folhado .5 kg'],
  ['Brie Folhado 1 g','Brie Folhado 1.000 g'],
  ['Grazing 1,5','Grazing 1 e 5'],
  ['Suco 1 litro','Suco 1 ml'],
  ['Grazing para 1','Grazing para 1 Natal'],
  ['Grazing para 1','Grazing para 1 e 1'],
  ['Tábua de frios','Grazing para 1 - tábua de frios'],
 ])('mantém diferença importante: %s / %s',(hub,woo)=>expect(produtosSemanticamenteEquivalentes(hub,woo)).toBe(false));

 it('recusa texto sem núcleo comercial e restringe tamanho',()=>{
  for(const nome of ['', '1 pessoa','sem', 'kit para 1','x'.repeat(501)])expect(identidadeProdutoSemantica(nome)).toBeNull();
  expect(identidadeProdutoSemantica('Grazing para 1 - tábua de frios')).toEqual({chave:'1|grazing',ancora:'grazing'});
 });
});
