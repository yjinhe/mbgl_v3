import type { PrismaClient } from '@prisma/client';

export const RECYCLE_RETENTION_DAYS = 7;
export const RECYCLE_RETENTION_MS = RECYCLE_RETENTION_DAYS * 86400000;

export function recycleCutoff(now = new Date()): Date {
  return new Date(now.getTime() - RECYCLE_RETENTION_MS);
}

export function recycleDaysLeft(deletedAt: Date, now = new Date()): number {
  return Math.max(1, Math.ceil((deletedAt.getTime() + RECYCLE_RETENTION_MS - now.getTime()) / 86400000));
}

export async function purgeExpiredRecords(prisma: PrismaClient, now = new Date()) {
  const cutoff = recycleCutoff(now);
  const [glucose, bp, lipid, uric] = await Promise.all([
    prisma.glucoseRecord.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } }),
    prisma.bpRecord.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } }),
    prisma.lipidRecord.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } }),
    prisma.uricRecord.findMany({ where: { deletedAt: { lt: cutoff } }, select: { id: true } })
  ]);
  const followUpRefs = [
    { metric: 'glucose', ids: glucose.map((row) => row.id) },
    { metric: 'bp', ids: bp.map((row) => row.id) },
    { metric: 'lipid', ids: lipid.map((row) => row.id) },
    { metric: 'uric', ids: uric.map((row) => row.id) }
  ].filter((item) => item.ids.length > 0);

  await prisma.$transaction([
    ...(followUpRefs.length > 0
      ? [prisma.followUp.deleteMany({
          where: { OR: followUpRefs.map((item) => ({ metric: item.metric, recordId: { in: item.ids } })) }
        })]
      : []),
    prisma.glucoseRecord.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    prisma.bpRecord.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    prisma.lipidRecord.deleteMany({ where: { deletedAt: { lt: cutoff } } }),
    prisma.uricRecord.deleteMany({ where: { deletedAt: { lt: cutoff } } })
  ]);

  return { deletedRecords: glucose.length + bp.length + lipid.length + uric.length };
}
