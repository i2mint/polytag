declare const require: (name: string) => unknown;
export const load = (name: string) => require(name);
