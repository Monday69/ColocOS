-- CreateEnum
CREATE TYPE "StockEventType" AS ENUM ('ADDED', 'OPENED', 'CONSUMED_PARTIAL', 'FINISHED', 'WASTED');

-- CreateTable
CREATE TABLE "stock_events" (
    "id" UUID NOT NULL,
    "item_id" UUID,
    "item_name" VARCHAR(255) NOT NULL,
    "category" VARCHAR(60),
    "zone_id" UUID,
    "user_id" UUID,
    "event_type" "StockEventType" NOT NULL,
    "quantity_ratio" DOUBLE PRECISION,
    "unit_cost" DOUBLE PRECISION,
    "days_to_expiry" INTEGER,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "stock_events_item_name_event_type_created_at_idx" ON "stock_events"("item_name", "event_type", "created_at");

-- CreateIndex
CREATE INDEX "stock_events_user_id_created_at_idx" ON "stock_events"("user_id", "created_at");

-- AddForeignKey
ALTER TABLE "stock_events" ADD CONSTRAINT "stock_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

