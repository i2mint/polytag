/**
 * A view in a URL: a `SavedView` wrapped in holdall's versioned envelope and encoded into the
 * URL fragment, which is never sent to a server (the query string is not offered).
 *
 * The schemas are strict, so a value carrying anything beyond the view (a token, a local
 * id) is refused before it is encoded, and refused again when a link is read; the one
 * opaque part is the saved view's `filter`.
 */

import { makeShareLink, readShareLink, unwrap, wrap, type ShareLink, type ShareLinkOptions } from 'holdall';
import { SavedViewSchema, type SavedView } from './config.js';

/** The envelope polytag writes: app `polytag`, kind `view`, schema version 1. */
export const VIEW_ENVELOPE = Object.freeze({ app: 'polytag', kind: 'view', version: 1 });

/** The URL parameter that carries a view, namespaced so an app's own `#view=grid` is not read as one. */
export const VIEW_LINK_KEY = 'ptview';

/** Options of {@link viewToLink}: holdall's share-link options, always in the fragment. */
export type ViewLinkOptions = Omit<ShareLinkOptions, 'part'>;

/**
 * A share link for `view`, on `baseUrl`. Check the returned `tier` before offering it:
 * `too-long` means the link exceeds every length budget.
 */
export function viewToLink(view: SavedView, baseUrl: string | URL, options: ViewLinkOptions = {}): ShareLink {
  const data = SavedViewSchema.parse(view);
  const { savedAt: _omit, ...envelope } = wrap(data, VIEW_ENVELOPE);
  return makeShareLink(envelope, baseUrl, { key: VIEW_LINK_KEY, ...options, part: 'hash' });
}

/** The view a link carries, validated; `null` when the link carries none. Throws on a damaged or foreign payload. */
export function viewFromLink(
  url: string | URL,
  { key = VIEW_LINK_KEY, maxBytes }: { key?: string; maxBytes?: number } = {},
): SavedView | null {
  const raw = readShareLink(url, { key, maxBytes, part: 'hash' });
  return raw === null ? null : unwrap(raw, { ...VIEW_ENVELOPE, schema: SavedViewSchema });
}
