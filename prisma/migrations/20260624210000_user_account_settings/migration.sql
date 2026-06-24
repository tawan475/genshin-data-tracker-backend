-- AlterTable
ALTER TABLE "User" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "GenshinAccount" ADD COLUMN "settings" JSONB NOT NULL DEFAULT '{}';
