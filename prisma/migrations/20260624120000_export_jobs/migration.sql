-- CreateEnum
CREATE TYPE "ExportJobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "ExportJob" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "genshinAccountId" INTEGER NOT NULL,
    "snapshotIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "selectAll" BOOLEAN NOT NULL DEFAULT false,
    "status" "ExportJobStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "storagePath" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ExportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExportJob_userId_genshinAccountId_status_idx" ON "ExportJob"("userId", "genshinAccountId", "status");

-- CreateIndex
CREATE INDEX "ExportJob_expiresAt_idx" ON "ExportJob"("expiresAt");

-- AddForeignKey
ALTER TABLE "ExportJob" ADD CONSTRAINT "ExportJob_genshinAccountId_fkey" FOREIGN KEY ("genshinAccountId") REFERENCES "GenshinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
