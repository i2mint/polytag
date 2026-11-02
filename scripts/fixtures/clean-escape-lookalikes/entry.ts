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
