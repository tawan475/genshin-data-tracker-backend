-- CreateEnum
CREATE TYPE "DictionaryType" AS ENUM ('CHARACTER', 'WEAPON', 'MATERIAL');

-- AlterTable
ALTER TABLE "Good" ALTER COLUMN "characters" SET DEFAULT '{}';

-- CreateTable
CREATE TABLE "Dictionary" (
    "id" SERIAL NOT NULL,
    "type" "DictionaryType" NOT NULL,
    "key" TEXT NOT NULL,

    CONSTRAINT "Dictionary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dictionary_type_key_key" ON "Dictionary"("type", "key");
