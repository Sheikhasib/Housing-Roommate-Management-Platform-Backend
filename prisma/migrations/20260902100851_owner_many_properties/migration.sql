-- DropIndex
DROP INDEX "properties_ownerId_key";

-- CreateIndex
CREATE INDEX "idx_property_owner" ON "properties"("ownerId");
