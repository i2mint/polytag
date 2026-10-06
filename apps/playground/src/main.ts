// The playground is i2mint/polytag#5. Until then this entry only proves that every
// polytag subpath resolves from a browser bundle: a broken exports map fails the build.
import 'polytag';
export { createBackendCatalog } from 'polytag/backends';
export { createFormatRegistry } from 'polytag/formats';
export { createViewMenu } from 'polytag/views';
