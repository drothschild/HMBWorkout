/**
 * Documentation gate for the exercise-detail local-photo controls (#376).
 *
 * URL-shaped sources remain meaningful to the resolver for catalog/web and
 * legacy rows, but the detail screen no longer offers an interactive URL
 * override. Keep the project reference aligned with the camera/library UI so
 * a later edit does not promise a control that users cannot reach.
 */
import { readFileSync } from 'fs';
import { join } from 'path';

const EXERCISE_IMAGES_DOC = join(__dirname, '..', '..', 'docs', 'project-context', 'exercise-images.md');

describe('exercise-images project context (#376)', () => {
  it('documents local photo selection instead of a paste-URL control', () => {
    const source = readFileSync(EXERCISE_IMAGES_DOC, 'utf8');
    const normalized = source.replace(/\s+/g, ' ');

    expect(normalized).toContain('Exercise details offer camera and photo-library controls; they do not expose a paste-URL override.');
    expect(source).not.toContain('`applyImageUrl`');
    expect(source).not.toContain('AI pick and paste-URL override remain available.');
  });
});
