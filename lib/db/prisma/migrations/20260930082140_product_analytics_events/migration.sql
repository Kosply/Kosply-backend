-- CreateEnum
CREATE TYPE "ProductEventType" AS ENUM ('IMPRESSION', 'CLICK');

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "soldAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "product_events" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "type" "ProductEventType" NOT NULL,
    "viewerId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'unknown',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_events_productId_type_createdAt_idx" ON "product_events"("productId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "product_events_productId_createdAt_idx" ON "product_events"("productId", "createdAt");

-- CreateIndex
CREATE INDEX "product_events_type_createdAt_idx" ON "product_events"("type", "createdAt");

-- CreateIndex
CREATE INDEX "products_sellerId_status_idx" ON "products"("sellerId", "status");

-- CreateIndex
CREATE INDEX "products_sellerId_soldAt_idx" ON "products"("sellerId", "soldAt");

-- CreateIndex
CREATE INDEX "products_status_createdAt_idx" ON "products"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "product_events" ADD CONSTRAINT "product_events_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
