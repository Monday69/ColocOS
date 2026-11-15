-- Réconciliation de l'historique de migrations avec schema.prisma.
--
-- Les Lots 1 à 4 (profil, nutrition, PIN, repas, stock, recettes,
-- notifications) avaient été appliqués en base via `prisma db push` sans
-- migration correspondante : une base vierge ne pouvait donc pas être
-- amorcée avec `prisma migrate deploy` (colonne `activity_level` manquante).
--
-- Migration strictement ADDITIVE : aucune colonne, table ni donnée existante
-- n'est supprimée ou modifiée.

-- CreateEnum
CREATE TYPE "NutritionGoal" AS ENUM ('MAINTENANCE', 'LEAN_BULK', 'CUT', 'HIGH_PROTEIN');

-- CreateEnum
CREATE TYPE "MealSlot" AS ENUM ('LUNCH', 'DINNER');

-- AlterEnum
ALTER TYPE "ActivityAction" ADD VALUE 'ITEM_CONSUMED_PARTIAL';

-- AlterTable
ALTER TABLE "items" ADD COLUMN     "calories" DOUBLE PRECISION,
ADD COLUMN     "carbohydrates" DOUBLE PRECISION,
ADD COLUMN     "consumed_at" TIMESTAMPTZ,
ADD COLUMN     "expiry_notified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fat" DOUBLE PRECISION,
ADD COLUMN     "fiber" DOUBLE PRECISION,
ADD COLUMN     "initial_quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "nova_group" INTEGER,
ADD COLUMN     "proteins" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "activity_level" DOUBLE PRECISION NOT NULL DEFAULT 1.2,
ADD COLUMN     "birth_date" DATE,
ADD COLUMN     "gender" CHAR(1),
ADD COLUMN     "height_cm" DOUBLE PRECISION,
ADD COLUMN     "nutrition_goal" "NutritionGoal" NOT NULL DEFAULT 'MAINTENANCE',
ADD COLUMN     "pin_hash" TEXT,
ADD COLUMN     "weight_kg" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_recipes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "recipe_id" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "favorite_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_plans" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "slot" "MealSlot" NOT NULL,
    "recipe_id" VARCHAR(120) NOT NULL,
    "recipe_name" VARCHAR(160) NOT NULL,
    "cook_id" UUID,
    "attendee_ids" JSONB,
    "servings" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meal_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_recipes" (
    "id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "source_url" VARCHAR(500),
    "image_url" VARCHAR(500),
    "prep_time_min" INTEGER,
    "cook_time_min" INTEGER,
    "servings" INTEGER NOT NULL DEFAULT 4,
    "instructions" JSONB NOT NULL,
    "ingredients" JSONB NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "custom_recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meals" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "date" CHAR(10) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "total_calories" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_proteins" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_carbs" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_fat" DOUBLE PRECISION NOT NULL DEFAULT 0,

    CONSTRAINT "meals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meal_items" (
    "id" UUID NOT NULL,
    "meal_id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "barcode" VARCHAR(50),
    "grams" DOUBLE PRECISION NOT NULL,
    "calories" DOUBLE PRECISION NOT NULL,
    "proteins" DOUBLE PRECISION NOT NULL,
    "carbs" DOUBLE PRECISION NOT NULL,
    "fat" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "meal_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_user_id_idx" ON "push_subscriptions"("user_id");

-- CreateIndex
CREATE INDEX "favorite_recipes_user_id_idx" ON "favorite_recipes"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_recipes_user_id_recipe_id_key" ON "favorite_recipes"("user_id", "recipe_id");

-- CreateIndex
CREATE INDEX "meal_plans_date_idx" ON "meal_plans"("date");

-- CreateIndex
CREATE UNIQUE INDEX "meal_plans_date_slot_key" ON "meal_plans"("date", "slot");

-- CreateIndex
CREATE INDEX "custom_recipes_created_by_id_idx" ON "custom_recipes"("created_by_id");

-- CreateIndex
CREATE INDEX "meals_user_id_date_idx" ON "meals"("user_id", "date");

-- CreateIndex
CREATE INDEX "meals_date_idx" ON "meals"("date");

-- CreateIndex
CREATE INDEX "meal_items_meal_id_idx" ON "meal_items"("meal_id");

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "favorite_recipes" ADD CONSTRAINT "favorite_recipes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_plans" ADD CONSTRAINT "meal_plans_cook_id_fkey" FOREIGN KEY ("cook_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_recipes" ADD CONSTRAINT "custom_recipes_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meals" ADD CONSTRAINT "meals_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meal_items" ADD CONSTRAINT "meal_items_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "meals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

