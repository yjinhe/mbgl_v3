import { buildApp } from './app.js';
import { config } from './env.js';
import cron from 'node-cron';
import { purgeExpiredRecords } from './services/recycle.js';

const app = await buildApp();
await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info({ port: config.port }, 'Tangji API listening');

async function cleanupRecycleBin() {
  try {
    const result = await purgeExpiredRecords(app.prisma);
    app.log.info(result, 'Recycle bin cleanup completed');
  } catch (error) {
    app.log.error({ err: error }, 'Recycle bin cleanup failed');
  }
}

const cleanupTask = cron.schedule('10 3 * * *', () => void cleanupRecycleBin(), { timezone: 'Asia/Shanghai' });
void cleanupRecycleBin();

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Shutting down');
  cleanupTask.stop();
  await app.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
