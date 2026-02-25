-- CreateEnum
CREATE TYPE "ProjectPurchaseStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'CANCELLED', 'FAILED', 'REFUNDED');

-- CreateTable
CREATE TABLE "ProjectPurchase" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'airwallex',
    "status" "ProjectPurchaseStatus" NOT NULL DEFAULT 'PENDING',
    "amount" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "merchantOrderId" TEXT NOT NULL,
    "paymentIntentId" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProjectPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEventLog" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEventLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPurchase_requestId_key" ON "ProjectPurchase"("requestId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPurchase_merchantOrderId_key" ON "ProjectPurchase"("merchantOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPurchase_paymentIntentId_key" ON "ProjectPurchase"("paymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "ProjectPurchase_userId_projectId_key" ON "ProjectPurchase"("userId", "projectId");

-- CreateIndex
CREATE INDEX "ProjectPurchase_paymentIntentId_idx" ON "ProjectPurchase"("paymentIntentId");

-- CreateIndex
CREATE INDEX "ProjectPurchase_status_idx" ON "ProjectPurchase"("status");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEventLog_provider_eventId_key" ON "WebhookEventLog"("provider", "eventId");

-- CreateIndex
CREATE INDEX "WebhookEventLog_provider_eventName_processedAt_idx" ON "WebhookEventLog"("provider", "eventName", "processedAt");

-- AddForeignKey
ALTER TABLE "ProjectPurchase" ADD CONSTRAINT "ProjectPurchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
