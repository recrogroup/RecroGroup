CREATE TABLE IF NOT EXISTS "blocked_slots" (
    "id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "time" TEXT NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "note" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "blocked_slots_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "blocked_slots_weekday_time_key" ON "blocked_slots"("weekday", "time");
CREATE INDEX IF NOT EXISTS "blocked_slots_weekday_idx" ON "blocked_slots"("weekday");

DO $$ BEGIN
  ALTER TABLE "blocked_slots"
    ADD CONSTRAINT "blocked_slots_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "user"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
