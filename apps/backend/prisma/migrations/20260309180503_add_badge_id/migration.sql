/*
  Warnings:

  - A unique constraint covering the columns `[badge_id]` on the table `users` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "badge_id" VARCHAR(100);

-- CreateIndex
CREATE UNIQUE INDEX "users_badge_id_key" ON "users"("badge_id");
