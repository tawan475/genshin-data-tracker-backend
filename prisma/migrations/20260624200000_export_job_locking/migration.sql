-- Export job locking + recovery for horizontal scaling
ALTER TABLE "ExportJob" ADD COLUMN "lockedAt" TIMESTAMP(3);
ALTER TABLE "ExportJob" ADD COLUMN "lockedBy" TEXT;
ALTER TABLE "ExportJob" ADD COLUMN "heartbeatAt" TIMESTAMP(3);
ALTER TABLE "ExportJob" ADD COLUMN "attemptCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "ExportJob_status_heartbeatAt_idx" ON "ExportJob"("status", "heartbeatAt");
