// `node --import ./scripts/boundary-guard.register.mjs ...`: install the runtime boundary guard
// before anything else loads (see boundary-guard.mjs).
import { installBoundaryGuard } from './boundary-guard.mjs';

installBoundaryGuard();
