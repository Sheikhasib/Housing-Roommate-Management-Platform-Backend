-- RenameEnum: shared by OwnerProfile and TenantProfile
ALTER TYPE "OwnerVerificationStatus" RENAME TO "VerificationStatus";

-- AlterTable: tenant identity verification fields
ALTER TABLE "tenant_profiles" ADD COLUMN     "verificationDocUrl" TEXT,
ADD COLUMN     "verificationDocPublicId" TEXT,
ADD COLUMN     "verificationStatus" "VerificationStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "rejectionReason" TEXT,
ADD COLUMN     "reviewedBy" TEXT,
ADD COLUMN     "reviewedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "idx_tenant_verification_status" ON "tenant_profiles"("verificationStatus");
