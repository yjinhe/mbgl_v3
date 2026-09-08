import { buildApp } from './app.js';
import { config } from './env.js';
import cron from 'node-cron';
import { purgeExpiredRecords } from './services/recycle.js';
import { remindersConfigured, runReminderTick } from './services/reminders.js';

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

const cleanupTask = cron.schedule('10 3 * * *', () => void cleanupRecycleBin(), {
  timezone: 'Asia/Shanghai',
  noOverlap: true
});
void cleanupRecycleBin();

async function sendMeasurementReminders() {
  try {
    const result = await runReminderTick(app.prisma, { now: new Date(), fetch, config, log: app.log });
    if (result.due > 0 || result.medicationDue > 0) app.log.info(result, 'Reminder tick completed');
  } catch (error) {
    app.log.error({ err: error }, 'Measurement reminder tick failed');
  }
}

// Spec §6: every 5 minutes in Asia/Shanghai. Skipped entirely (one warning) until the mini-program credentials and at
// least one subscribe-message template are configured.
let reminderTask: ReturnType<typeof cron.schedule> | null = null;
if (remindersConfigured(config)) {
  reminderTask = cron.schedule('*/5 * * * *', () => void sendMeasurementReminders(), {
    timezone: 'Asia/Shanghai',
    noOverlap: true
  });
} else {
  app.log.warn('Measurement reminders disabled: set WECHAT_APPID/WECHAT_SECRET and WECHAT_TEMPLATE_GLUCOSE_REMINDER, WECHAT_TEMPLATE_BP_REMINDER or WECHAT_TEMPLATE_MEDICATION_REMINDER');
}

async function shutdown(signal: string) {
  app.log.info({ signal }, 'Shutting down');
  cleanupTask.stop();
  reminderTask?.stop();
  await app.close();
  process.exit(0);
}

process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));
