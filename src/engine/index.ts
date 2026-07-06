// Public engine API consumed by the UI. Re-exports the full API surface and
// wires newGame to the bundled team data.
export * from './api.ts'
export { newGame } from './withData.ts'
