import { PrismaClient } from '@prisma/client';

export function createPrisma() {
  process.env.DATABASE_URL ??= 'file:./dev.db';
  return new PrismaClient();
}
