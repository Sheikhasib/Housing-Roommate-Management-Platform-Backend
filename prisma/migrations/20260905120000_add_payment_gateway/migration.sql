-- CreateEnum
CREATE TYPE "PaymentGateway" AS ENUM ('BKASH', 'SSLCOMMERZ', 'STRIPE');

-- AddColumn + backfill: every existing payment row is a bKash payment
ALTER TABLE "payments" ADD COLUMN "gateway" "PaymentGateway" NOT NULL DEFAULT 'BKASH';

-- DropColumn: legacy free-text column; verified zero code reads (schema-only
-- field, all writes relied on the DB default)
ALTER TABLE "payments" DROP COLUMN "paymentGateway";

-- AddColumns: minor-units snapshot of the charged amount (I-G2 amount
-- verification at settle)
ALTER TABLE "payments" ADD COLUMN "providerChargeAmount" INTEGER,
ADD COLUMN "providerChargeCurrency" TEXT;

-- CreateIndex: provider-ref lookups are gateway-scoped pairs
CREATE INDEX "idx_payment_gateway_provider" ON "payments"("gateway", "bKashPaymentId");
