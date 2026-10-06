/**
 * Library-free comment scanners, used to warn before a full rewrite drops comments
 * (zodal-dials synthesis §L: never parse, mutate and overwrite a commented file silently).
 *
 * Heuristic by design: they track quotes on one line and do not parse the format, so text
 * inside a YAML block scalar or a TOML multi-line string can be reported as a comment. That
 * errs towards warning, which is the safe side for a pre-write check.
 *
 * extraction candidate: a zodal format package (second consumer: zodal-dials TOML/YAML stores)
 */

import type { FoundComment } from './types.js';

/** `#` comments (YAML, TOML): a `#` at line start or after whitespace, outside quotes. */
export function hashComments(text: string): FoundComment[] {
  const found: FoundComment[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    let quote: string | undefined;
    for (let i = 0; i < line.length; i++) {
      const c = line[i]!;
      if (quote) {
        if (c === '\\' && quote === '"') i += 1;
        else if (c === quote) quote = undefined;
      } else if (c === '"' || c === "'") {
        quote = c;
      } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1]!))) {
        found.push({ line: index + 1, text: line.slice(i).trim() });
        return;
      }
    }
  });
  return found;
}

/** `//` and `/* *\/` comments (JSONC), outside strings. */
export function slashComments(text: string): FoundComment[] {
  const found: FoundComment[] = [];
  let line = 1;
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\n') line += 1;
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      found.push({ line, text: text.slice(i, end === -1 ? undefined : end).trim() });
      i = end === -1 ? text.length : end - 1;
    } else if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      const body = text.slice(i, end === -1 ? undefined : end + 2);
      found.push({ line, text: body.trim() });
      line += body.split('\n').length - 1;
      i = end === -1 ? text.length : end + 1;
    }
  }
  return found;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;
const BLOCK_SCALAR = /(^|[\s:-])[|>][+-]?\d?[+-]?\s*$/;

/** YAML comments: as {@link hashComments}, but lines inside a block scalar (`|`, `>`) are content. */
export function yamlComments(text: string): FoundComment[] {
  const found: FoundComment[] = [];
  let block: number | undefined;
  text.split(/\r?\n/).forEach((line, index) => {
    if (block !== undefined) {
      if (line.trim() === '' || indentOf(line) > block) return;
      block = undefined;
    }
    const [comment] = hashComments(line);
    if (comment) found.push({ line: index + 1, text: comment.text });
    const code = comment ? line.slice(0, line.lastIndexOf(comment.text)) : line;
    if (BLOCK_SCALAR.test(code)) block = indentOf(line);
  });
  return found;
}

/** TOML comments: `#` outside basic, literal and multi-line strings. */
export function tomlComments(text: string): FoundComment[] {
  const found: FoundComment[] = [];
  let line = 1;
  let state: 'code' | '"' | "'" | '"""' | "'''" = 'code';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '\n') {
      line += 1;
      if (state === '"' || state === "'") state = 'code';
      continue;
    }
    if (state === 'code') {
      if (text.startsWith('"""', i) || text.startsWith("'''", i)) {
        state = text.slice(i, i + 3) as '"""' | "'''";
        i += 2;
      } else if (c === '"' || c === "'") state = c;
      else if (c === '#') {
        const end = text.indexOf('\n', i);
        found.push({ line, text: text.slice(i, end === -1 ? undefined : end).trim() });
        i = (end === -1 ? text.length : end) - 1;
      }
    } else if (state === '"' || state === '"""') {
      if (c === '\\') i += 1;
      else if (state === '"' && c === '"') state = 'code';
      else if (state === '"""' && text.startsWith('"""', i)) {
        state = 'code';
        i += 2;
      }
    } else if (state === "'" && c === "'") state = 'code';
    else if (state === "'''" && text.startsWith("'''", i)) {
      state = 'code';
      i += 2;
    }
  }
  return found;
}
