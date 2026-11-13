-- AlterTable
ALTER TABLE "items" ADD COLUMN     "unit_cost" DECIMAL(10,2);

-- CreateTable
CREATE TABLE "workout_syncs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "external_id" VARCHAR(120),
    "sport_type" VARCHAR(16) NOT NULL,
    "title" VARCHAR(160),
    "duration_min" INTEGER NOT NULL,
    "active_kcal" INTEGER NOT NULL,
    "tri_score" DOUBLE PRECISION,
    "intensity_type" VARCHAR(16),
    "performed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workout_syncs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workout_syncs_external_id_key" ON "workout_syncs"("external_id");

-- CreateIndex
CREATE INDEX "workout_syncs_user_id_performed_at_idx" ON "workout_syncs"("user_id", "performed_at");

-- AddForeignKey
ALTER TABLE "workout_syncs" ADD CONSTRAINT "workout_syncs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

