// esbuild's shim, verbatim, as a built ESM file carries it when its source calls require('literal').
var __require = /* @__PURE__ */ ((x: any) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
  get: (a: any, b: any) => (typeof require !== "undefined" ? require : a)[b]
}) : x)(function(this: unknown, x: any) {
  if (typeof require !== "undefined") return require.apply(this, arguments as any);
  throw Error('Dynamic require of "' + x + '" is not supported');
});
export const fs = __require('node:fs');
