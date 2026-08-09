// Vitest (via Vite) resolves any import path ending in "?raw" to the target file's literal
// text content as a string at test-run time. TypeScript has no built-in knowledge of this
// convention, so without this declaration `tsc --noEmit` fails on every such import even
// though the import works correctly under vitest run.
declare module "*?raw" {
  const content: string;
  export default content;
}
