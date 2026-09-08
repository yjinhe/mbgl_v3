import type { Prisma, PrismaClient } from '@prisma/client';
import { addDaysToKey, localDayKey } from '@tangji/shared';
import { REMINDER_TIME_PATTERN, parseStoredTimes, shanghaiDayRange } from './reminders.js';

export const MEDICATION_LIMIT = 8;
export const MEDICATION_NAME_MAX = 20;
export const MEDICATION_TIMES_MAX = 4;

/** Thrown by createMedication when the user already keeps MEDICATION_LIMIT unarchived medications. */
export class MedicationLimitError extends Error {
  readonly code = 'MEDICATION_LIMIT';
  constructor() {
    super(`常用药最多 ${MEDICATION_LIMIT} 种`);
    this.name = 'MedicationLimitError';
  }
}

export interface MedicationRow {
  id: string;
  name: string;
  times: string;
}

export interface MedicationView {
  id: string;
  name: string;
  times: string[];
}

export function serializeMedication(row: MedicationRow): MedicationView {
  return { id: row.id, name: row.name, times: parseStoredTimes(row.times) };
}

/**
 * Validates 1–MEDICATION_TIMES_MAX 'HH:mm' entries, drops duplicates and sorts ascending (medication spec §5).
 * Returns null when the input is invalid.
 */
export function normalizeTimes(times: readonly string[]): string[] | null {
  if (times.length < 1 || times.length > MEDICATION_TIMES_MAX) return null;
  if (!times.every((time) => REMINDER_TIME_PATTERN.test(time))) return null;
  return [...new Set(times)].sort();
}

const activeMedicationOrder = [{ createdAt: 'asc' }, { id: 'asc' }] satisfies Prisma.MedicationOrderByWithRelationInput[];

export async function listMedications(prisma: PrismaClient, userId: string): Promise<MedicationView[]> {
  const rows = await prisma.medication.findMany({ where: { userId, archivedAt: null }, orderBy: activeMedicationOrder });
  return rows.map(serializeMedication);
}

export interface MedicationInput {
  /** Already trimmed and length-checked by the route. */
  name: string;
  /** Already normalized (see normalizeTimes). */
  times: string[];
}

export async function createMedication(prisma: PrismaClient, userId: string, input: MedicationInput): Promise<MedicationView> {
  const row = await prisma.$transaction(async (tx) => {
    const active = await tx.medication.count({ where: { userId, archivedAt: null } });
    if (active >= MEDICATION_LIMIT) throw new MedicationLimitError();
    return tx.medication.create({ data: { userId, name: input.name, times: JSON.stringify(input.times) } });
  });
  return serializeMedication(row);
}

/** Returns null when the medication does not exist, belongs to someone else or is archived. */
export async function updateMedication(
  prisma: PrismaClient,
  userId: string,
  id: string,
  input: Partial<MedicationInput>
): Promise<MedicationView | null> {
  const existing = await prisma.medication.findFirst({ where: { id, userId, archivedAt: null } });
  if (!existing) return null;
  const row = await prisma.medication.update({
    where: { id: existing.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.times !== undefined ? { times: JSON.stringify(input.times) } : {})
    }
  });
  return serializeMedication(row);
}

/** Deleting archives (medication spec §3.1): check-in history stays for the weekly report. Returns false when not found. */
export async function archiveMedication(prisma: PrismaClient, userId: string, id: string, now = new Date()): Promise<boolean> {
  const updated = await prisma.medication.updateMany({ where: { id, userId, archivedAt: null }, data: { archivedAt: now } });
  return updated.count > 0;
}

export interface TodaySlotItem {
  medicationId: string;
  name: string;
  taken: boolean;
}

export interface TodayView {
  day: string;
  slots: Array<{ time: string; items: TodaySlotItem[] }>;
}

/** Medication spec §5 `today`: slots ascending, items in medication creation order, `taken` from MedicationLog. */
export async function todayView(prisma: PrismaClient, userId: string, day: string): Promise<TodayView> {
  const [medications, logs] = await Promise.all([
    prisma.medication.findMany({ where: { userId, archivedAt: null }, orderBy: activeMedicationOrder }),
    prisma.medicationLog.findMany({ where: { userId, day }, select: { medicationId: true, slot: true } })
  ]);
  const takenKeys = new Set(logs.map((log) => `${log.medicationId}\n${log.slot}`));
  const slots = new Map<string, TodaySlotItem[]>();
  for (const medication of medications) {
    for (const time of parseStoredTimes(medication.times)) {
      let items = slots.get(time);
      if (!items) {
        items = [];
        slots.set(time, items);
      }
      items.push({ medicationId: medication.id, name: medication.name, taken: takenKeys.has(`${medication.id}\n${time}`) });
    }
  }
  return {
    day,
    slots: [...slots.keys()].sort().map((time) => ({ time, items: slots.get(time) ?? [] }))
  };
}

export interface CheckinInput {
  day: string;
  slot: string;
  medicationId: string;
  taken: boolean;
}

export type CheckinResult =
  | { status: 'ok'; today: TodayView }
  /** `day` is not today in Asia/Shanghai: past days cannot be back-filled (medication spec §3.2). */
  | { status: 'not_today'; today: string }
  | { status: 'not_found' }
  /** `slot` is not one of the medication's times. */
  | { status: 'invalid_slot' };

export async function checkin(prisma: PrismaClient, userId: string, input: CheckinInput, now = new Date()): Promise<CheckinResult> {
  const today = localDayKey(now);
  if (input.day !== today) return { status: 'not_today', today };
  const medication = await prisma.medication.findFirst({ where: { id: input.medicationId, userId, archivedAt: null } });
  if (!medication) return { status: 'not_found' };
  if (!parseStoredTimes(medication.times).includes(input.slot)) return { status: 'invalid_slot' };
  const key = { medicationId: medication.id, day: today, slot: input.slot };
  if (input.taken) {
    // Idempotent: a repeated check-in keeps the original takenAt.
    await prisma.medicationLog.upsert({
      where: { medicationId_day_slot: key },
      create: { userId, ...key, takenAt: now },
      update: {}
    });
  } else {
    await prisma.medicationLog.deleteMany({ where: key });
  }
  return { status: 'ok', today: await todayView(prisma, userId, today) };
}

export interface WeeklyMedicationSection {
  /** Sum over each day in the range of the times of every medication that existed on that day (archived ones included). */
  planned: number;
  /** Check-ins recorded on days in the range. */
  taken: number;
}

/** Medication spec §3.6: planned versus taken doses between `from` and `to` (inclusive Asia/Shanghai days). */
export async function weeklyMedicationSection(prisma: PrismaClient, userId: string, from: Date, to: Date): Promise<WeeklyMedicationSection> {
  const fromKey = localDayKey(from);
  const toKey = localDayKey(to);
  if (fromKey > toKey) return { planned: 0, taken: 0 };
  const [medications, taken] = await Promise.all([
    prisma.medication.findMany({
      where: { userId, createdAt: { lt: shanghaiDayRange(toKey).end } },
      select: { times: true, createdAt: true, archivedAt: true }
    }),
    prisma.medicationLog.count({ where: { userId, day: { gte: fromKey, lte: toKey } } })
  ]);
  const doses = medications.map((item) => ({ ...item, doses: parseStoredTimes(item.times).length }));
  let planned = 0;
  for (let day = fromKey; day <= toKey; day = addDaysToKey(day, 1)) {
    const { start, end } = shanghaiDayRange(day);
    for (const item of doses) {
      const existed = item.createdAt < end && (item.archivedAt === null || item.archivedAt > start);
      if (existed) planned += item.doses;
    }
  }
  return { planned, taken };
}

export async function deleteUserMedications(prisma: Pick<Prisma.TransactionClient, 'medication' | 'medicationLog'>, userId: string) {
  await prisma.medicationLog.deleteMany({ where: { userId } });
  await prisma.medication.deleteMany({ where: { userId } });
}
