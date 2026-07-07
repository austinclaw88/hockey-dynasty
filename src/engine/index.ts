// Public engine API consumed by the UI. Re-exports the full API surface and
// wires newGame to the bundled team data.
export * from './api.ts'
// withData's newGame/loadGame re-attach bundled static data (2027 draft class);
// these override the data-free versions re-exported from api.ts above.
export { newGame, loadGame, hydrateStaticData } from './withData.ts'
