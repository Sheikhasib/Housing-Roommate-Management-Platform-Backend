/*
  Warnings:

  - A unique constraint covering the columns `[bKashPaymentId]` on the table `payments` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "payments_bKashPaymentId_key" ON "payments"("bKashPaymentId");
