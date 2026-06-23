-- AlterTable
ALTER TABLE "AccountArtifact" ADD COLUMN     "cv" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "rv" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "GenshinAccount" ADD COLUMN     "isGlobalArtifactRankingOptIn" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "GenshinAccount_userId_idx" ON "GenshinAccount"("userId");

-- CreateIndex
CREATE INDEX "Good_genshinAccountId_isDeleted_createdAt_idx" ON "Good"("genshinAccountId", "isDeleted", "createdAt" DESC);
