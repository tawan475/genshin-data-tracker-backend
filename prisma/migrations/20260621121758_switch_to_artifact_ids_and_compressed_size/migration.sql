/*
  Warnings:

  - You are about to drop the `AchievementSnapshot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `ArtifactSnapshot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `CharacterSnapshot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `MaterialSnapshot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SubstatSnapshot` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `WeaponSnapshot` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AchievementSnapshot" DROP CONSTRAINT "AchievementSnapshot_goodId_fkey";

-- DropForeignKey
ALTER TABLE "ArtifactSnapshot" DROP CONSTRAINT "ArtifactSnapshot_goodId_fkey";

-- DropForeignKey
ALTER TABLE "CharacterSnapshot" DROP CONSTRAINT "CharacterSnapshot_goodId_fkey";

-- DropForeignKey
ALTER TABLE "MaterialSnapshot" DROP CONSTRAINT "MaterialSnapshot_goodId_fkey";

-- DropForeignKey
ALTER TABLE "SubstatSnapshot" DROP CONSTRAINT "SubstatSnapshot_artifactSnapshotId_fkey";

-- DropForeignKey
ALTER TABLE "WeaponSnapshot" DROP CONSTRAINT "WeaponSnapshot_goodId_fkey";

-- AlterTable
ALTER TABLE "Good" ADD COLUMN     "achievements" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "artifactIds" INTEGER[],
ADD COLUMN     "characters" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "compressedFileSize" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "fileSize" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isDeleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "materials" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "weapons" JSONB NOT NULL DEFAULT '[]',
ALTER COLUMN "source" SET DEFAULT 'Unknown';

-- DropTable
DROP TABLE "AchievementSnapshot";

-- DropTable
DROP TABLE "ArtifactSnapshot";

-- DropTable
DROP TABLE "CharacterSnapshot";

-- DropTable
DROP TABLE "MaterialSnapshot";

-- DropTable
DROP TABLE "SubstatSnapshot";

-- DropTable
DROP TABLE "WeaponSnapshot";

-- CreateTable
CREATE TABLE "AccountArtifact" (
    "id" SERIAL NOT NULL,
    "hash" TEXT NOT NULL,
    "genshinAccountId" INTEGER NOT NULL,
    "setKey" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "rarity" INTEGER NOT NULL,
    "mainStatKey" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "lock" BOOLEAN NOT NULL,
    "totalRolls" INTEGER NOT NULL DEFAULT 0,
    "astralMark" BOOLEAN NOT NULL DEFAULT false,
    "elixerCrafted" BOOLEAN NOT NULL DEFAULT false,
    "substats" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountArtifact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountArtifact_genshinAccountId_hash_key" ON "AccountArtifact"("genshinAccountId", "hash");

-- AddForeignKey
ALTER TABLE "AccountArtifact" ADD CONSTRAINT "AccountArtifact_genshinAccountId_fkey" FOREIGN KEY ("genshinAccountId") REFERENCES "GenshinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
