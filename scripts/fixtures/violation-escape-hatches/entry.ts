// Every runtime loader esbuild cannot follow, each on its own line (i2mint/polytag#15 item 2).
import { createRequire } from 'node:module';
declare const module: { require(n: string): unknown };
const name = ['@zodal', 'groups-core'].join('/');
export const viaCreateRequire = () => createRequire(import.meta.url);
export const aliased = () => { const r = require; return r(name); };
export const viaCall = () => require.call(null, name);
export const viaModule = () => module.require(name);
export const viaFunction = () => new Function('n', 'return require(n)')(name);
export const viaIndirectEval = () => (0, eval)('require')(name);
export const viaGlobal = () => (globalThis as any)['req' + 'uire'](name);
export const viaLiteralKey = () => (globalThis as any)['require'](name);
export const viaAlias = () => { const g = globalThis as any; return g['req' + 'uire'](name); };
export const viaDestructure = (m: any) => { const { createRequire: cr } = m; return cr(import.meta.url)(name); };
