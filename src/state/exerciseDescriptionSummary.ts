/** Return the short cue shown while performing an exercise. */
export function firstExerciseDescriptionLine(
  description: string | null | undefined
): string | undefined {
  const normalized = description?.trim();
  if (!normalized) return undefined;

  const firstLine = normalized.split(/\r?\n/, 1)[0].trim();
  return firstLine || undefined;
}
