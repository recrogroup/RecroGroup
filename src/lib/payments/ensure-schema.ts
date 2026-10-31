import "server-only";

import { prisma } from "@/lib/prisma";

const STATEMENTS = [
  `DO $$ BEGIN
  CREATE TYPE "PaymentProvider" AS ENUM ('MPESA_DARAJA', 'PAYSTACK', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$`,
  `DO $$ BEGIN
  CREATE TYPE "PaymentPurpose" AS ENUM (
    'BOOKING_DEPOSIT',
    'BOOKING_BALANCE',
    'BOOKING_FULL',
    'GRIEF_CAMP_FEE',
    'DONATION',
    'MERCHANDISE',
    'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$`,
  `DO $$ BEGIN
  CREATE TYPE "Currency" AS ENUM ('KES', 'USD');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$`,
  `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PROCESSING'`,
  `ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CANCELLED'`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "reference" TEXT`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "provider" "PaymentProvider"`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "purpose" "PaymentPurpose" NOT NULL DEFAULT 'OTHER'`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "currency" "Currency" NOT NULL DEFAULT 'KES'`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "settledAmountKes" INTEGER`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "providerRef" TEXT`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "providerMeta" JSONB`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "failureReason" TEXT`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "griefApplicationId" TEXT`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "donationId" TEXT`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "paidAt" TIMESTAMP(3)`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP(3)`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "bankReference" TEXT`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "proofUrl" TEXT`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "phone" TEXT`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "mpesaCheckoutId" TEXT`,
  `ALTER TABLE "payments" ADD COLUMN IF NOT EXISTS "mpesaReceipt" TEXT`,
  `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "durationMin" INTEGER`,
  `ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "rescheduleReason" TEXT`,
  `UPDATE "payments"
SET "provider" = CASE
  WHEN "method" = 'MPESA' THEN 'MPESA_DARAJA'::"PaymentProvider"
  WHEN "method" = 'CARD' THEN 'PAYSTACK'::"PaymentProvider"
  ELSE 'MANUAL'::"PaymentProvider"
END
WHERE "provider" IS NULL`,
  `UPDATE "payments"
SET "reference" = 'RP-' || upper(substr(md5(random()::text || "id"), 1, 8))
WHERE "reference" IS NULL OR "reference" = ''`,
  `CREATE TABLE IF NOT EXISTS "payment_events" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "provider" "PaymentProvider" NOT NULL,
    "eventType" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "payments_reference_key" ON "payments"("reference")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "payments_mpesaReceipt_key" ON "payments"("mpesaReceipt")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "payments_idempotencyKey_key" ON "payments"("idempotencyKey")`,
  `CREATE INDEX IF NOT EXISTS "payments_bankReference_idx" ON "payments"("bankReference")`,
  `CREATE INDEX IF NOT EXISTS "payments_provider_providerRef_idx" ON "payments"("provider", "providerRef")`,
  `CREATE INDEX IF NOT EXISTS "payments_bookingId_idx" ON "payments"("bookingId")`,
  `CREATE INDEX IF NOT EXISTS "payments_createdAt_idx" ON "payments"("createdAt")`,
  `CREATE INDEX IF NOT EXISTS "payments_status_idx" ON "payments"("status")`,
  `CREATE INDEX IF NOT EXISTS "payments_userId_idx" ON "payments"("userId")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "payment_events_dedupeKey_key" ON "payment_events"("dedupeKey")`,
  `CREATE INDEX IF NOT EXISTS "payment_events_provider_eventType_idx" ON "payment_events"("provider", "eventType")`,
  `CREATE INDEX IF NOT EXISTS "payment_events_processed_idx" ON "payment_events"("processed")`,
  `CREATE INDEX IF NOT EXISTS "payment_events_createdAt_idx" ON "payment_events"("createdAt")`,
  `DO $$ BEGIN
  ALTER TABLE "payment_events"
    ADD CONSTRAINT "payment_events_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$`,
  `CREATE TABLE IF NOT EXISTS "blocked_slots" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "blocked_slots_pkey" PRIMARY KEY ("id")
)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "blocked_slots_weekday_time_key" ON "blocked_slots"("weekday", "time")`,
  `CREATE INDEX IF NOT EXISTS "blocked_slots_weekday_idx" ON "blocked_slots"("weekday")`,
  `DO $$ BEGIN
  ALTER TABLE "blocked_slots"
    ADD CONSTRAINT "blocked_slots_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$`,
];

let pending: Promise<void> | null = null;

export async function ensurePaymentsSchema() {
  pending ??= (async () => {
    for (const statement of STATEMENTS) {
      await prisma.$executeRawUnsafe(statement);
    }
  })().catch((error) => {
    pending = null;
    throw error;
  });

  await pending;
}
