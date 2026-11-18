import "server-only";
import dotenv from "dotenv";
import { cleanCancelledVenueLoanFiles } from "../src/features/venues/server/loan-cleanup";
import { getPrisma } from "../src/server/db/prisma";

dotenv.config({ quiet: true });

try {
  const result = await cleanCancelledVenueLoanFiles();
  console.log(JSON.stringify(result));
  if (result.failed) process.exitCode = 1;
} finally {
  await getPrisma().$disconnect();
}
