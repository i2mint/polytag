/**
 * A view in a URL: a `SavedView` (or a bare `ViewConfig`) wrapped in holdall's versioned
 * envelope and encoded into the URL fragment, which is never sent to a server.
 *
 * The schemas are strict, so a value carrying anything beyond the view (a token, a local
 * id) is refused before it is encoded, and refused again when a link is read.
 */

import { makeShareLink, readShareLink, unwrap, wrap, type ShareLink, type ShareLinkOptions } from 'holdall';
import { SavedViewSchema, type SavedView } from './config.js';

/** The envelope polytag writes: app `polytag`, kind `view`, schema version 1. */
export const VIEW_ENVELOPE = Object.freeze({ app: 'polytag', kind: 'view', version: 1 });

/** The URL parameter that carries a view. */
export const VIEW_LINK_KEY = 'view';

/**
 * A share link for `view`, on `baseUrl`. Check the returned `tier` before offering it:
 * `too-long` means the link exceeds every length budget.
 */
export function viewToLink(view: SavedView, baseUrl: string | URL, options: ShareLinkOptions = {}): ShareLink {
  const data = SavedViewSchema.parse(view);
  const { savedAt: _omit, ...envelope } = wrap(data, VIEW_ENVELOPE);
  return makeShareLink(envelope, baseUrl, { key: VIEW_LINK_KEY, ...options });
}

/** The view a link carries, validated; `null` when the link carries none. Throws on a damaged or foreign payload. */
export function viewFromLink(url: string | URL, { key = VIEW_LINK_KEY }: { key?: string } = {}): SavedView | null {
  const raw = readShareLink(url, { key });
  return raw === null ? null : unwrap(raw, { ...VIEW_ENVELOPE, schema: SavedViewSchema });
}
