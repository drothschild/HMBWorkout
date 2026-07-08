/**
 * Type declarations for CSS modules and global CSS files.
 * Allows TypeScript to resolve CSS imports without errors.
 */

declare module '*.css' {
  const content: Record<string, string>;
  export default content;
}

declare module '*.module.css' {
  const content: Record<string, string>;
  export default content;
}
