-- Inscription sur demande : demandes d'accès avec approbation administrateur.
-- Migration additive uniquement (aucune table ni colonne existante modifiée).

-- CreateEnum
CREATE TYPE "InviteRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'USED', 'EXPIRED');

-- CreateTable
CREATE TABLE "invite_requests" (
    "id" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "code" VARCHAR(40) NOT NULL,
    "approval_token" VARCHAR(64) NOT NULL,
    "status" "InviteRequestStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMPTZ,

    CONSTRAINT "invite_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invite_requests_code_key" ON "invite_requests"("code");

-- CreateIndex
CREATE UNIQUE INDEX "invite_requests_approval_token_key" ON "invite_requests"("approval_token");

-- CreateIndex
CREATE INDEX "invite_requests_email_status_idx" ON "invite_requests"("email", "status");

-- CreateIndex
CREATE INDEX "invite_requests_expires_at_idx" ON "invite_requests"("expires_at");
