/**
 * User free text (titles, notes, personality, directives) is dropped into
 * markdown-shaped prompts, so a line starting with '#' would read as a section
 * heading and could masquerade as prompt structure. Strips leading '#'s per
 * line. The ONE shared copy (#335 hoisted the three private duplicates that
 * lived in alternatesPrompt, exerciseQuestionPrompt and restCommentaryPrompt).
 * contextBuilder's neutralizeNotesForPrompt is a separate function and is not
 * touched here.
 */
export function neutralizeForPrompt(text: string): string {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*#+\s*/, ''))
    .join('\n');
}
