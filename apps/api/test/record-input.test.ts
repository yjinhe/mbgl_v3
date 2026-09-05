import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { buildApp } from '../src/app.js';
import { validateMetricInput } from '../src/services/records.js';
import { createSqliteSchema } from './setup-db.js';

let app: Awaited<ReturnType<typeof buildApp>>;
let prisma: PrismaClient;
let token = '';
let userId = '';

beforeAll(async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'tangji-record-input-'));
  process.env.DATABASE_URL = `file:${path.join(dir, 'test.db')}`;
  prisma = new PrismaClient();
  await createSqliteSchema(prisma);
  app = await buildApp({ prisma });
  const user = await prisma.user.create({ data: { openid: 'record_input_test' } });
  userId = user.id;
  token = app.jwt.sign({ aud: 'app', userId });
});

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
});

describe('record input resource limits', () => {
  test.each([
    ['a near-limit request body', { value: 6.1, unit: 'mmol', tags: ['x'.repeat(900 * 1024)] }, 413, 'REQUEST_FAILED'],
    ['non-array tags', { value: 6.1, unit: 'mmol', tags: '饭后' }, 422, 'VALIDATION_FAILED'],
    ['an invalid period', { value: 6.1, unit: 'mmol', period: 'after_midnight' }, 422, 'VALIDATION_FAILED'],
    ['an oversized note', { value: 6.1, unit: 'mmol', note: 'n'.repeat(51) }, 422, 'VALIDATION_FAILED']
  ] as const)('rejects %s without inserting a record', async (_name, body, status, code) => {
    const before = await prisma.glucoseRecord.count({ where: { userId } });
    const response = await app.inject({
      method: 'POST',
      url: '/api/app/records/glucose',
      headers: { authorization: `Bearer ${token}` },
      payload: body
    });

    expect(response.statusCode).toBe(status);
    expect(response.json().error.code).toBe(code);
    expect(await prisma.glucoseRecord.count({ where: { userId } })).toBe(before);
  });
});

describe('strict metric field validation', () => {
  test('rejects coercible numbers and unknown fields', () => {
    expect(validateMetricInput('glucose', { value: '6.1', unit: 'mmol' }).ok).toBe(false);
    expect(validateMetricInput('bp', { sbp: 120, dbp: 80, unexpected: true }).ok).toBe(false);
  });

  test('rejects malformed dates and booleans', () => {
    expect(validateMetricInput('lipid', { tc: 4.5, fasting: 'true' }).ok).toBe(false);
    expect(validateMetricInput('uric', { value: 420, measuredAt: '2026-02-30T10:00:00+08:00' }).ok).toBe(false);
    expect(validateMetricInput('uric', { value: 420, measuredAt: '2026-07-12T24:00:00+08:00' }).ok).toBe(false);
  });

  test('enforces tag count, item and aggregate limits', () => {
    const base = { value: 6.1, unit: 'mmol' as const };
    expect(validateMetricInput('glucose', { ...base, tags: Array.from({ length: 13 }, (_, index) => `tag-${index}`) }).ok).toBe(false);
    expect(validateMetricInput('glucose', { ...base, tags: ['x'.repeat(33)] }).ok).toBe(false);
    expect(validateMetricInput('glucose', { ...base, tags: Array.from({ length: 9 }, (_, index) => `${index}${'x'.repeat(29)}`) }).ok).toBe(false);
  });

  test('keeps valid inputs for all four metrics', () => {
    const measuredAt = '2026-07-12T10:00:00+08:00';
    expect(validateMetricInput('glucose', { value: 6.1, unit: 'mmol', period: 'fasting', tags: ['空腹'], note: '', measuredAt }).ok).toBe(true);
    expect(validateMetricInput('glucose', { value: 8.1, unit: 'mmol', period: 'post_meal_1h', measuredAt }).ok).toBe(true);
    expect(validateMetricInput('glucose', { value: 7.6, unit: 'mmol', period: 'post_meal_2h', measuredAt }).ok).toBe(true);
    expect(validateMetricInput('bp', { sbp: 120, dbp: 80, pulse: 70, period: 'morning', tags: [], measuredAt }).ok).toBe(true);
    expect(validateMetricInput('lipid', { tc: 4.5, fasting: true, measuredAt }).ok).toBe(true);
    expect(validateMetricInput('uric', { value: 420, fasting: true, measuredAt }).ok).toBe(true);
  });
});
