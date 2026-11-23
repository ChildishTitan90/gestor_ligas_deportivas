import 'server-only';
import { Prisma } from '@prisma/client';
import { z } from 'zod';

/** Prisma 7 raw SQL preserves SQLSTATE inside DriverAdapterError.cause. */
export function isTransactionConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  if (error.code === 'P2034') return true;
  if (error.code !== 'P2010') return false;
  const driver = z.object({ cause: z.object({ originalCode: z.string().optional(), kind: z.string().optional() }) }).safeParse(error.meta?.driverAdapterError);
  return ['40001', '40P01'].includes(String(error.meta?.code)) || !!(driver.success &&
    (driver.data.cause.kind === 'TransactionWriteConflict' || ['40001', '40P01'].includes(driver.data.cause.originalCode ?? '')));
}
