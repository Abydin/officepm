// Public surface of the server package: the data layer, plus what is needed to
// embed the app (tests build it over an in-memory database).
export * from './db/index.js';
export { createApp } from './app.js';
export { loadConfig, type Config } from './config.js';
export { ProjectsRegistry, parseProjectsConfig, readProjectsConfig } from './projects-config.js';
export { EventBus } from './events.js';
export { bootstrapAdmin, seedBoards } from './bootstrap.js';
export type { AppContext } from './context.js';
