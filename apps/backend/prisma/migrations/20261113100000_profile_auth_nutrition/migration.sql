-- CreateEnum
CREATE TYPE "AuthMode" AS ENUM ('AUTO_DEVICE', 'PIN_ONLY', 'USERNAME_PIN');

-- CreateEnum
CREATE TYPE "ProfileGoal" AS ENUM ('MAINTAIN', 'BULK', 'CUT', 'CARB_LOAD');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "auth_mode" "AuthMode" NOT NULL DEFAULT 'AUTO_DEVICE',
ADD COLUMN     "nfc_token" VARCHAR(64),
ADD COLUMN     "username" VARCHAR(40);

-- CreateTable
CREATE TABLE "user_profiles" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "height_cm" INTEGER NOT NULL,
    "weight_kg" DOUBLE PRECISION NOT NULL,
    "birth_date" DATE NOT NULL,
    "sex" CHAR(1) NOT NULL,
    "activity_factor" DOUBLE PRECISION NOT NULL DEFAULT 1.55,
    "goal" "ProfileGoal" NOT NULL DEFAULT 'MAINTAIN',
    "target_kcal" INTEGER NOT NULL,
    "target_protein" INTEGER NOT NULL,
    "target_carbs" INTEGER NOT NULL,
    "target_fat" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nutrition_logs" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "label" VARCHAR(160) NOT NULL,
    "kcal" DOUBLE PRECISION NOT NULL,
    "protein_g" DOUBLE PRECISION NOT NULL,
    "carbs_g" DOUBLE PRECISION NOT NULL,
    "fat_g" DOUBLE PRECISION NOT NULL,
    "source" VARCHAR(24) NOT NULL,
    "consumed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nutrition_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "weigh_ins" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "weight_kg" DOUBLE PRECISION NOT NULL,
    "impedance_ohm" DOUBLE PRECISION,
    "body_fat_pct" DOUBLE PRECISION,
    "muscle_mass_kg" DOUBLE PRECISION,
    "source" VARCHAR(24) NOT NULL,
    "measured_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "weigh_ins_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_user_id_key" ON "user_profiles"("user_id");

-- CreateIndex
CREATE INDEX "nutrition_logs_user_id_consumed_at_idx" ON "nutrition_logs"("user_id", "consumed_at");

-- CreateIndex
CREATE INDEX "weigh_ins_user_id_measured_at_idx" ON "weigh_ins"("user_id", "measured_at");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- CreateIndex
CREATE UNIQUE INDEX "users_nfc_token_key" ON "users"("nfc_token");

-- AddForeignKey
ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nutrition_logs" ADD CONSTRAINT "nutrition_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weigh_ins" ADD CONSTRAINT "weigh_ins_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

