/**
 * Read a checked-in Hevy payload fixture (#267 Phase 3).
 *
 * `fs.readFileSync` rather than `import fixture from './x.json'` on purpose:
 * the node jest project's `transform` table covers `.ts` and `.lv` only, so a
 * JSON import's behaviour depends on `resolveJsonModule` and on which
 * transformer claims the extension. Reading the bytes has neither dependency,
 * and it is also the honest thing to do for a fixture whose whole value is that
 * it is the API's own output, byte for byte.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import type { HevyRoutine } from '../types';

/** The `{ routine: ... }` envelope `GET /v1/routines/{id}` actually returns. */
interface RoutineEnvelope {
  routine: HevyRoutine;
}

export function loadRoutineFixture(name: string): HevyRoutine {
  const raw = readFileSync(join(__dirname, 'fixtures', `${name}.json`), 'utf8');
  return (JSON.parse(raw) as RoutineEnvelope).routine;
}
