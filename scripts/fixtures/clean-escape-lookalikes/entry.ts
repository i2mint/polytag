// Look like escapes, never load code at runtime: none of these may be flagged.
export const options = { eval: true, require: false };
export class Plugin { require() { return 1; } }
export type Loader = Function | typeof eval;
export const takes = (f: Function) => f;
export const ok = (globalThis as any)['location'];
export const lookup = (o: Record<string, unknown>, k: string) => o[k];
// boundary-check: allow-dynamic (a documented, reviewed escape)
export const allowed = () => new Function('return 1');
export const hasWindow = typeof window !== 'undefined';
export const fetcher = globalThis.fetch;
export const named = (o: { self: unknown }) => o.self;
// Locals that share a global's name (review finding 4).
export function rolling(xs: number[], window: number) { return xs.slice(-window); }
export const pick = ({ window }: { window: number }) => window;
export class Box { me() { const self = this; return self; } }
export const unpack = (o: { global: number }) => { const { global } = o; return global; };
export const isFn = (x: unknown) => x instanceof Function;
export const run = (expr: { eval(): number }) => expr.eval();
// Browser feature detection and plain reads (re-review findings 2, 3).
export const hasStorage = 'localStorage' in globalThis;
export const isBrowser = typeof window === 'object' && window !== null;
export const storage = () => { const { localStorage } = window; return localStorage; };
export const headless = () => !window;
export const install = (x: object) => Object.assign(globalThis, x);
export const root = typeof globalThis !== 'undefined' ? globalThis : window;
export const isPlain = (C: unknown) => Function.prototype.toString.call(C);
export const isFnCtor = (x: { constructor: unknown }) => x.constructor === Function;
export const canRequire = typeof require !== 'undefined';
