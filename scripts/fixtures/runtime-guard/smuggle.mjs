// Loads the fake @zodal/groups-core (found through NODE_PATH) the way argv[2] says, then prints
// LOADED. Under the boundary guard every way must fail (i2mint/polytag#21).
import nodeModule, { createRequire } from 'node:module';

const name = ['@zodal', 'groups-core'].join('/');
const parent = { filename: import.meta.filename, paths: nodeModule._nodeModulePaths(process.cwd()).concat(process.env.NODE_PATH ?? []) };
const ways = {
  moduleLoad: () => nodeModule._load(name, parent),
  createRequire: () => createRequire(import.meta.url)(name),
  builtin: () => process.getBuiltinModule('module').createRequire(import.meta.url)(name),
  byPath: () => createRequire(import.meta.url)(nodeModule._resolveFilename(name, parent)),
  functionCtor: () => new Function('r', 'n', 'return r(n)')(createRequire(import.meta.url), name),
};
const loaded = ways[process.argv[2]]();
console.log(loaded.fake ? 'LOADED' : 'nothing');
