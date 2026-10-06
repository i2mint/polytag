// esbuild erases this import, so only the string-literal scan (and, once built, the
// declarations pass) can see it.
import type { Fake } from '@zodal/groups-core';
export const value: Fake | undefined = undefined;
