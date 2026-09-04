-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'PROPERTY_MANAGER';

-- CreateTable
CREATE TABLE "manager_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contactNumber" TEXT,
    "bio" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "manager_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_managers" (
    "id" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "propertyId" TEXT NOT NULL,
    "managerId" TEXT NOT NULL,

    CONSTRAINT "property_managers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "manager_profiles_email_key" ON "manager_profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "manager_profiles_userId_key" ON "manager_profiles"("userId");

-- CreateIndex
CREATE INDEX "idx_manager_email" ON "manager_profiles"("email");

-- CreateIndex
CREATE INDEX "idx_manager_is_deleted" ON "manager_profiles"("isDeleted");

-- CreateIndex
CREATE INDEX "idx_property_manager_manager" ON "property_managers"("managerId");

-- CreateIndex
CREATE UNIQUE INDEX "property_managers_propertyId_managerId_key" ON "property_managers"("propertyId", "managerId");

-- AddForeignKey
ALTER TABLE "manager_profiles" ADD CONSTRAINT "manager_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_managers" ADD CONSTRAINT "property_managers_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "property_managers" ADD CONSTRAINT "property_managers_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "manager_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
