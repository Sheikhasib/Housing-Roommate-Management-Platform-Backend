/*
  Warnings:

  - You are about to drop the column `verfivationStatus` on the `doctors` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "doctors" DROP COLUMN "verfivationStatus",
ADD COLUMN     "verificationStatus" "DoctorVerificationStatus" NOT NULL DEFAULT 'PENDING';
