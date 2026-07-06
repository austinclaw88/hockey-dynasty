// Minimal ambient declarations for the Node builtins used by sim-test.ts, so it
// type-checks in environments without @types/node installed. Runtime is
// unaffected (executed under `node --experimental-strip-types`).
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: string): string
  export function existsSync(path: string): boolean
}
declare module 'node:url' {
  export function fileURLToPath(url: string): string
}
declare module 'node:path' {
  export function dirname(path: string): string
  export function join(...parts: string[]): string
}
declare const process: { exit(code?: number): never; env: Record<string, string | undefined> }
