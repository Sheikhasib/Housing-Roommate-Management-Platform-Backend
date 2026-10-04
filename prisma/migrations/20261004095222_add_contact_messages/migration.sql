-- CreateTable
CREATE TABLE "contact_messages" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT NOT NULL,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contact_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_contact_message_is_read" ON "contact_messages"("isRead");

-- CreateIndex
CREATE INDEX "idx_contact_message_created_at" ON "contact_messages"("createdAt");

-- RenameIndex
ALTER INDEX "unique_membership_per_lease" RENAME TO "roommate_memberships_leaseId_tenantProfileId_key";
