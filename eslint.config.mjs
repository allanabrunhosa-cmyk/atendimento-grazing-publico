// Atendimento usa Vite. Mantém regras de TypeScript e React sem depender de Next.
import {defineConfig,globalIgnores} from 'eslint/config';
import nextTs from 'eslint-config-next/typescript';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import nextPlugin from '@next/eslint-plugin-next';
const files=['apps/atendimento-chat-consulta/**/*.{ts,tsx}'];
export default defineConfig([...nextTs,{...react.configs.flat.recommended,files,settings:{react:{version:'19.2.8'}}},{...react.configs.flat['jsx-runtime'],files},{files,plugins:{'react-hooks':hooks,'@next/next':nextPlugin},rules:{'react-hooks/rules-of-hooks':'error','react-hooks/exhaustive-deps':'warn'}},globalIgnores(['node_modules/**','src/generated/**','.tmp*/**','apps/atendimento/**'])]);
