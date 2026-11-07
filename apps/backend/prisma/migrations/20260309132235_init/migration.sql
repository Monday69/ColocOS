-- CreateEnum
CREATE TYPE "StorageType" AS ENUM ('fridge', 'freezer', 'pantry', 'cabinet');

-- CreateEnum
CREATE TYPE "Unit" AS ENUM ('g', 'kg', 'ml', 'L', 'unit');

-- CreateEnum
CREATE TYPE "ExpenseCategory" AS ENUM ('groceries', 'utilities', 'rent', 'other');

-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('ITEM_ADDED', 'ITEM_REMOVED', 'ITEM_UPDATED', 'ITEM_MOVED', 'EXPENSE_CREATED', 'EXPENSE_SETTLED', 'RECIPE_COOKED', 'SHOPPING_ITEM_ADDED', 'SHOPPING_ITEM_CHECKED', 'USER_JOINED');

-- CreateEnum
CREATE TYPE "ShoppingItemStatus" AS ENUM ('pending', 'checked', 'purchased');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password" TEXT NOT NULL,
    "avatar_url" TEXT,
    "color_hex" CHAR(7) NOT NULL DEFAULT '#6366F1',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_zones" (
    "id" UUID NOT NULL,
    "mesh_id" VARCHAR(100) NOT NULL,
    "label" VARCHAR(100) NOT NULL,
    "type" "StorageType" NOT NULL,
    "capacity_liters" DECIMAL(6,2),
    "position_x" DOUBLE PRECISION,
    "position_y" DOUBLE PRECISION,
    "position_z" DOUBLE PRECISION,
    "parent_zone_id" UUID,

    CONSTRAINT "storage_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" UUID NOT NULL,
    "barcode" VARCHAR(50),
    "name" VARCHAR(255) NOT NULL,
    "brand" VARCHAR(100),
    "quantity" DECIMAL(8,2) NOT NULL,
    "unit" "Unit" NOT NULL DEFAULT 'unit',
    "expiry_date" DATE,
    "image_url" TEXT,
    "nutriscore" CHAR(1),
    "is_shared" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "storage_zone_id" UUID NOT NULL,
    "owner_id" UUID,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "off_cache" (
    "barcode" VARCHAR(50) NOT NULL,
    "data" JSONB NOT NULL,
    "fetched_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "off_cache_pkey" PRIMARY KEY ("barcode")
);

-- CreateTable
CREATE TABLE "recipes" (
    "id" UUID NOT NULL,
    "source_url" TEXT NOT NULL,
    "title" VARCHAR(255) NOT NULL,
    "image_url" TEXT,
    "ingredients" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "prep_time_min" INTEGER,
    "scraped_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recipes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenses" (
    "id" UUID NOT NULL,
    "description" VARCHAR(255) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "category" "ExpenseCategory" NOT NULL DEFAULT 'other',
    "receipt_url" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_by" UUID NOT NULL,

    CONSTRAINT "expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_splits" (
    "id" UUID NOT NULL,
    "share_amount" DECIMAL(10,2) NOT NULL,
    "is_settled" BOOLEAN NOT NULL DEFAULT false,
    "expense_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,

    CONSTRAINT "expense_splits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" UUID NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "from_user_id" UUID NOT NULL,
    "to_user_id" UUID NOT NULL,

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_lists" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL DEFAULT 'Liste de courses',
    "is_archived" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "shopping_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shopping_items" (
    "id" UUID NOT NULL,
    "name" VARCHAR(255) NOT NULL,
    "quantity" DECIMAL(8,2) NOT NULL DEFAULT 1,
    "unit" "Unit" NOT NULL DEFAULT 'unit',
    "barcode" VARCHAR(50),
    "status" "ShoppingItemStatus" NOT NULL DEFAULT 'pending',
    "note" VARCHAR(255),
    "is_auto_suggested" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "shopping_list_id" UUID NOT NULL,
    "added_by_id" UUID,

    CONSTRAINT "shopping_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "meta" JSONB,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" UUID,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "storage_zones_mesh_id_key" ON "storage_zones"("mesh_id");

-- CreateIndex
CREATE INDEX "items_barcode_idx" ON "items"("barcode");

-- CreateIndex
CREATE INDEX "items_expiry_date_idx" ON "items"("expiry_date");

-- CreateIndex
CREATE INDEX "items_storage_zone_id_idx" ON "items"("storage_zone_id");

-- CreateIndex
CREATE UNIQUE INDEX "recipes_source_url_key" ON "recipes"("source_url");

-- CreateIndex
CREATE UNIQUE INDEX "expense_splits_expense_id_user_id_key" ON "expense_splits"("expense_id", "user_id");

-- CreateIndex
CREATE INDEX "transactions_from_user_id_idx" ON "transactions"("from_user_id");

-- CreateIndex
CREATE INDEX "transactions_to_user_id_idx" ON "transactions"("to_user_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_idx" ON "activity_logs"("user_id");

-- CreateIndex
CREATE INDEX "activity_logs_action_idx" ON "activity_logs"("action");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- AddForeignKey
ALTER TABLE "storage_zones" ADD CONSTRAINT "storage_zones_parent_zone_id_fkey" FOREIGN KEY ("parent_zone_id") REFERENCES "storage_zones"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_storage_zone_id_fkey" FOREIGN KEY ("storage_zone_id") REFERENCES "storage_zones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_paid_by_fkey" FOREIGN KEY ("paid_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_expense_id_fkey" FOREIGN KEY ("expense_id") REFERENCES "expenses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_splits" ADD CONSTRAINT "expense_splits_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_shopping_list_id_fkey" FOREIGN KEY ("shopping_list_id") REFERENCES "shopping_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shopping_items" ADD CONSTRAINT "shopping_items_added_by_id_fkey" FOREIGN KEY ("added_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
