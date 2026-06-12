import { buildApp } from './app.js';
import { config } from './env.js';

const app = await buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`Tangji API listening on ${config.port}`);
