-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'OWNER', 'TENANT');

-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'BLOCKED', 'DELETED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('GOOGLE', 'CREDENTIAL');

-- CreateEnum
CREATE TYPE "OwnerVerificationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "PropertyType" AS ENUM ('APARTMENT', 'HOSTEL', 'DORMITORY', 'VILLA', 'SHARED_HOUSE', 'OTHER');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('PRIVATE_ROOM', 'SHARED_ROOM', 'ENTIRE_FLAT', 'BED');

-- CreateEnum
CREATE TYPE "RoomStatus" AS ENUM ('AVAILABLE', 'RESERVED', 'OCCUPIED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ViewingStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ViewingTimeSlot" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "RoommateRequestStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED');

-- CreateEnum
CREATE TYPE "LeaseStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentPurpose" AS ENUM ('DEPOSIT', 'RENT', 'UTILITY');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('RENT', 'UTILITY');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('UNPAID', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "MaintenanceStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED');

-- CreateEnum
CREATE TYPE "MaintenancePriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "MaintenanceCategory" AS ENUM ('PLUMBING', 'ELECTRICAL', 'APPLIANCE', 'FURNITURE', 'PAINTING', 'CLEANING', 'OTHER');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPLICATION', 'VIEWING', 'PAYMENT', 'LEASE', 'MAINTENANCE', 'INVOICE', 'SYSTEM');

-- CreateTable
CREATE TABLE "applications" (
    "id" TEXT NOT NULL,
    "moveInDate" TIMESTAMP(3) NOT NULL,
    "leaseMonths" INTEGER NOT NULL DEFAULT 12,
    "message" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantProfileId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "roommatePairId" TEXT,

    CONSTRAINT "applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "actorRole" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "type" "InvoiceType" NOT NULL DEFAULT 'RENT',
    "amount" DECIMAL(10,2) NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'UNPAID',
    "description" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leaseId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leases" (
    "id" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "monthlyRent" DECIMAL(10,2) NOT NULL,
    "depositAmount" DECIMAL(10,2) NOT NULL,
    "status" "LeaseStatus" NOT NULL DEFAULT 'ACTIVE',
    "terminationReason" TEXT,
    "terminatedBy" TEXT,
    "terminatedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT NOT NULL,
    "tenantProfileId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "leases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lease_documents" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "publicId" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "leaseId" TEXT NOT NULL,

    CONSTRAINT "lease_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "maintenance_requests" (
    "id" TEXT NOT NULL,
    "category" "MaintenanceCategory" NOT NULL DEFAULT 'OTHER',
    "priority" "MaintenancePriority" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT,
    "imagePublicId" TEXT,
    "status" "MaintenanceStatus" NOT NULL DEFAULT 'OPEN',
    "assignedTo" TEXT,
    "assignedAt" TIMESTAMP(3),
    "resolutionNotes" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantProfileId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "leaseId" TEXT,

    CONSTRAINT "maintenance_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL DEFAULT 'SYSTEM',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "owner_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contactNumber" TEXT,
    "companyName" TEXT,
    "address" TEXT,
    "verificationStatus" "OwnerVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "documents" JSONB,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "owner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "purpose" "PaymentPurpose" NOT NULL DEFAULT 'DEPOSIT',
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BDT',
    "paymentGateway" TEXT NOT NULL DEFAULT 'bKash',
    "merchantInvoiceNumber" TEXT NOT NULL,
    "bKashPaymentId" TEXT,
    "bKashTrxId" TEXT,
    "payerReference" TEXT,
    "paidAt" TEXT,
    "gatwayResponse" JSONB,
    "refundTrxId" TEXT,
    "refundAmount" DECIMAL(10,2),
    "refundReason" TEXT,
    "refundAt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "applicationId" TEXT,
    "invoiceId" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "properties" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" "PropertyType" NOT NULL DEFAULT 'APARTMENT',
    "city" TEXT NOT NULL,
    "area" TEXT,
    "address" TEXT,
    "googleMapUrl" TEXT,
    "amenities" JSONB,
    "images" JSONB,
    "houseRules" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ownerId" TEXT NOT NULL,

    CONSTRAINT "properties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "units" (
    "id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "floor" INTEGER,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyId" TEXT NOT NULL,

    CONSTRAINT "units_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "RoomType" NOT NULL DEFAULT 'PRIVATE_ROOM',
    "bedCount" INTEGER NOT NULL DEFAULT 1,
    "occupiedBeds" INTEGER NOT NULL DEFAULT 0,
    "monthlyRent" DECIMAL(10,2) NOT NULL,
    "bookingDeposit" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "minLeaseMonths" INTEGER NOT NULL DEFAULT 1,
    "sizeSqft" INTEGER,
    "isFurnished" BOOLEAN NOT NULL DEFAULT false,
    "amenities" JSONB,
    "images" JSONB,
    "availableFrom" TIMESTAMP(3),
    "status" "RoomStatus" NOT NULL DEFAULT 'AVAILABLE',
    "isPublished" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roommate_requests" (
    "id" TEXT NOT NULL,
    "message" TEXT,
    "status" "RoommateRequestStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "senderId" TEXT NOT NULL,
    "receiverId" TEXT NOT NULL,

    CONSTRAINT "roommate_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roommate_pairs" (
    "id" TEXT NOT NULL,
    "tenantAId" TEXT NOT NULL,
    "tenantBId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roommate_pairs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_profiles" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "contactNumber" TEXT,
    "gender" "Gender",
    "dateOfBirth" TIMESTAMP(3),
    "occupation" TEXT,
    "bio" TEXT,
    "preferredCity" TEXT,
    "monthlyBudgetMax" INTEGER,
    "moveInDate" TIMESTAMP(3),
    "smoker" BOOLEAN NOT NULL DEFAULT false,
    "petFriendly" BOOLEAN NOT NULL DEFAULT false,
    "hasPets" BOOLEAN NOT NULL DEFAULT false,
    "lookingForRoommate" BOOLEAN NOT NULL DEFAULT false,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "tenant_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password" TEXT,
    "googleId" TEXT,
    "authProvider" "AuthProvider" NOT NULL DEFAULT 'CREDENTIAL',
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "role" "Role" NOT NULL DEFAULT 'TENANT',
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "needPasswordChange" BOOLEAN NOT NULL DEFAULT false,
    "imageUrl" TEXT DEFAULT '',
    "imagePublicId" TEXT DEFAULT '',
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "viewing_requests" (
    "id" TEXT NOT NULL,
    "preferredDate" TIMESTAMP(3) NOT NULL,
    "timeSlot" "ViewingTimeSlot" NOT NULL DEFAULT 'MORNING',
    "message" TEXT,
    "scheduledDateTime" TIMESTAMP(3),
    "status" "ViewingStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tenantProfileId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,

    CONSTRAINT "viewing_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_application_tenant" ON "applications"("tenantProfileId");

-- CreateIndex
CREATE INDEX "idx_application_room" ON "applications"("roomId");

-- CreateIndex
CREATE INDEX "idx_application_status" ON "applications"("status");

-- CreateIndex
CREATE INDEX "idx_audit_entity" ON "audit_logs"("entity");

-- CreateIndex
CREATE INDEX "idx_audit_actor" ON "audit_logs"("actorId");

-- CreateIndex
CREATE INDEX "idx_audit_created_at" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "idx_invoice_lease" ON "invoices"("leaseId");

-- CreateIndex
CREATE INDEX "idx_invoice_room" ON "invoices"("roomId");

-- CreateIndex
CREATE INDEX "idx_invoice_status" ON "invoices"("status");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_leaseId_type_periodStart_key" ON "invoices"("leaseId", "type", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "leases_applicationId_key" ON "leases"("applicationId");

-- CreateIndex
CREATE INDEX "idx_lease_tenant" ON "leases"("tenantProfileId");

-- CreateIndex
CREATE INDEX "idx_lease_room" ON "leases"("roomId");

-- CreateIndex
CREATE INDEX "idx_lease_status" ON "leases"("status");

-- CreateIndex
CREATE INDEX "idx_lease_doc_lease" ON "lease_documents"("leaseId");

-- CreateIndex
CREATE INDEX "idx_maintenance_tenant" ON "maintenance_requests"("tenantProfileId");

-- CreateIndex
CREATE INDEX "idx_maintenance_room" ON "maintenance_requests"("roomId");

-- CreateIndex
CREATE INDEX "idx_maintenance_status" ON "maintenance_requests"("status");

-- CreateIndex
CREATE INDEX "idx_notification_user_read" ON "notifications"("userId", "isRead");

-- CreateIndex
CREATE UNIQUE INDEX "owner_profiles_email_key" ON "owner_profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "owner_profiles_userId_key" ON "owner_profiles"("userId");

-- CreateIndex
CREATE INDEX "idx_owner_email" ON "owner_profiles"("email");

-- CreateIndex
CREATE INDEX "idx_owner_verification_status" ON "owner_profiles"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "payments_merchantInvoiceNumber_key" ON "payments"("merchantInvoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "payments_applicationId_key" ON "payments"("applicationId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_invoiceId_key" ON "payments"("invoiceId");

-- CreateIndex
CREATE INDEX "idx_payment_status" ON "payments"("status");

-- CreateIndex
CREATE INDEX "idx_payment_purpose" ON "payments"("purpose");

-- CreateIndex
CREATE UNIQUE INDEX "properties_ownerId_key" ON "properties"("ownerId");

-- CreateIndex
CREATE INDEX "idx_property_city" ON "properties"("city");

-- CreateIndex
CREATE INDEX "idx_property_is_deleted" ON "properties"("isDeleted");

-- CreateIndex
CREATE INDEX "idx_unit_property" ON "units"("propertyId");

-- CreateIndex
CREATE INDEX "idx_room_property" ON "rooms"("propertyId");

-- CreateIndex
CREATE INDEX "idx_room_status" ON "rooms"("status");

-- CreateIndex
CREATE INDEX "idx_room_published" ON "rooms"("isPublished");

-- CreateIndex
CREATE INDEX "idx_room_rent" ON "rooms"("monthlyRent");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_propertyId_unitId_name_key" ON "rooms"("propertyId", "unitId", "name");

-- CreateIndex
CREATE INDEX "idx_roommate_req_sender" ON "roommate_requests"("senderId");

-- CreateIndex
CREATE INDEX "idx_roommate_req_receiver" ON "roommate_requests"("receiverId");

-- CreateIndex
CREATE UNIQUE INDEX "roommate_pairs_tenantAId_tenantBId_key" ON "roommate_pairs"("tenantAId", "tenantBId");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_profiles_email_key" ON "tenant_profiles"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_profiles_userId_key" ON "tenant_profiles"("userId");

-- CreateIndex
CREATE INDEX "idx_tenant_city" ON "tenant_profiles"("preferredCity");

-- CreateIndex
CREATE INDEX "idx_tenant_looking_roommate" ON "tenant_profiles"("lookingForRoommate");

-- CreateIndex
CREATE UNIQUE INDEX "users_googleId_key" ON "users"("googleId");

-- CreateIndex
CREATE INDEX "idx_user_role_status" ON "users"("role", "status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "idx_viewing_tenant" ON "viewing_requests"("tenantProfileId");

-- CreateIndex
CREATE INDEX "idx_viewing_room" ON "viewing_requests"("roomId");

-- CreateIndex
CREATE INDEX "idx_viewing_status" ON "viewing_requests"("status");

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_tenantProfileId_fkey" FOREIGN KEY ("tenantProfileId") REFERENCES "tenant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "applications" ADD CONSTRAINT "applications_roommatePairId_fkey" FOREIGN KEY ("roommatePairId") REFERENCES "roommate_pairs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_tenantProfileId_fkey" FOREIGN KEY ("tenantProfileId") REFERENCES "tenant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leases" ADD CONSTRAINT "leases_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lease_documents" ADD CONSTRAINT "lease_documents_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_tenantProfileId_fkey" FOREIGN KEY ("tenantProfileId") REFERENCES "tenant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "maintenance_requests" ADD CONSTRAINT "maintenance_requests_leaseId_fkey" FOREIGN KEY ("leaseId") REFERENCES "leases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "owner_profiles" ADD CONSTRAINT "owner_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_applicationId_fkey" FOREIGN KEY ("applicationId") REFERENCES "applications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "properties" ADD CONSTRAINT "properties_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "owner_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "units" ADD CONSTRAINT "units_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "properties"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roommate_requests" ADD CONSTRAINT "roommate_requests_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "tenant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roommate_requests" ADD CONSTRAINT "roommate_requests_receiverId_fkey" FOREIGN KEY ("receiverId") REFERENCES "tenant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roommate_pairs" ADD CONSTRAINT "roommate_pairs_tenantAId_fkey" FOREIGN KEY ("tenantAId") REFERENCES "tenant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roommate_pairs" ADD CONSTRAINT "roommate_pairs_tenantBId_fkey" FOREIGN KEY ("tenantBId") REFERENCES "tenant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_profiles" ADD CONSTRAINT "tenant_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_tenantProfileId_fkey" FOREIGN KEY ("tenantProfileId") REFERENCES "tenant_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "viewing_requests" ADD CONSTRAINT "viewing_requests_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
