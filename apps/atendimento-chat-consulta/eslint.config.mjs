import { defineConfig } from 'eslint/config';
import nextTypeScript from 'eslint-config-next/typescript';
import react from 'eslint-plugin-react';
import hooks from 'eslint-plugin-react-hooks';
import acessibilidade from 'eslint-plugin-jsx-a11y';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const basePath=dirname(fileURLToPath(import.meta.url)),files=['**/*.{ts,tsx,mts}'];
export default defineConfig([...nextTypeScript.filter(c=>!c.ignores).map(c=>({...c,basePath,files})),{...react.configs.flat.recommended,basePath,files,settings:{react:{version:'18.3.1'}}},{...react.configs.flat['jsx-runtime'],basePath,files},{...acessibilidade.flatConfigs.recommended,basePath,files},{basePath,files,plugins:{'react-hooks':hooks},rules:{'react-hooks/rules-of-hooks':'error','react-hooks/exhaustive-deps':'warn'}}]);
