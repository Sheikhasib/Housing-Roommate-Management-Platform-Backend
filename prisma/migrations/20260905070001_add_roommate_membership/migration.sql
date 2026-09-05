-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('PENDING', 'ACTIVE', 'REJECTED', 'REMOVED');

-- CreateTable
CREATE TABLE "roommate_memberships" (
    "id" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT,
    "respondedAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "removedBy" TEXT,
    "removalReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leaseId" TEXT NOT NULL,
    "tenantProfileId" TEXT NOT NULL,

    CONSTRAINT "roommate_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unique_membership_per_lease" ON "roommate_memberships"("leaseId", "tenantProfileId");

-- CreateIndex
CREATE INDEX "idx_membership_tenant" ON "roommate_memberships"("tenantProfileId");

-- CreateIndex
CREATE INDEX "idx_membership_status" ON "roommate_memberships"("status");

-- AddForeignKey
ALTER TABLE "roommate_memberships" ADD CONSTRAINT "roommate_memberships_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roommate_memberships" ADD CONSTRAINT "roommate_memberships_tenantProfileId_fkey" FOREIGN KEY ("tenantProfileId") REFERENCES "tenant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
