-- CreateEnum
CREATE TYPE "GenshinServer" AS ENUM ('AMERICA', 'EUROPE', 'ASIA', 'SAR');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "refreshToken" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GenshinAccount" (
    "id" SERIAL NOT NULL,
    "accountName" TEXT,
    "uid" TEXT,
    "server" "GenshinServer",
    "userId" INTEGER NOT NULL,

    CONSTRAINT "GenshinAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Good" (
    "id" SERIAL NOT NULL,
    "format" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "genshinAccountId" INTEGER NOT NULL,

    CONSTRAINT "Good_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterSnapshot" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "constellation" INTEGER NOT NULL,
    "ascension" INTEGER NOT NULL,
    "talentAuto" INTEGER NOT NULL,
    "talentSkill" INTEGER NOT NULL,
    "talentBurst" INTEGER NOT NULL,
    "goodId" INTEGER NOT NULL,

    CONSTRAINT "CharacterSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtifactSnapshot" (
    "id" SERIAL NOT NULL,
    "setKey" TEXT NOT NULL,
    "slotKey" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "rarity" INTEGER NOT NULL,
    "mainStatKey" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "lock" BOOLEAN NOT NULL,
    "totalRolls" INTEGER NOT NULL,
    "astralMark" BOOLEAN NOT NULL,
    "elixerCrafted" BOOLEAN NOT NULL,
    "goodId" INTEGER NOT NULL,

    CONSTRAINT "ArtifactSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubstatSnapshot" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "initialValue" DOUBLE PRECISION NOT NULL,
    "activated" BOOLEAN NOT NULL,
    "artifactSnapshotId" INTEGER NOT NULL,

    CONSTRAINT "SubstatSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeaponSnapshot" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "level" INTEGER NOT NULL,
    "ascension" INTEGER NOT NULL,
    "refinement" INTEGER NOT NULL,
    "location" TEXT NOT NULL,
    "lock" BOOLEAN NOT NULL,
    "goodId" INTEGER NOT NULL,

    CONSTRAINT "WeaponSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaterialSnapshot" (
    "id" SERIAL NOT NULL,
    "key" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "goodId" INTEGER NOT NULL,

    CONSTRAINT "MaterialSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AchievementSnapshot" (
    "id" SERIAL NOT NULL,
    "achievementId" INTEGER NOT NULL,
    "goodId" INTEGER NOT NULL,

    CONSTRAINT "AchievementSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- AddForeignKey
ALTER TABLE "GenshinAccount" ADD CONSTRAINT "GenshinAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Good" ADD CONSTRAINT "Good_genshinAccountId_fkey" FOREIGN KEY ("genshinAccountId") REFERENCES "GenshinAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterSnapshot" ADD CONSTRAINT "CharacterSnapshot_goodId_fkey" FOREIGN KEY ("goodId") REFERENCES "Good"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtifactSnapshot" ADD CONSTRAINT "ArtifactSnapshot_goodId_fkey" FOREIGN KEY ("goodId") REFERENCES "Good"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubstatSnapshot" ADD CONSTRAINT "SubstatSnapshot_artifactSnapshotId_fkey" FOREIGN KEY ("artifactSnapshotId") REFERENCES "ArtifactSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeaponSnapshot" ADD CONSTRAINT "WeaponSnapshot_goodId_fkey" FOREIGN KEY ("goodId") REFERENCES "Good"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaterialSnapshot" ADD CONSTRAINT "MaterialSnapshot_goodId_fkey" FOREIGN KEY ("goodId") REFERENCES "Good"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AchievementSnapshot" ADD CONSTRAINT "AchievementSnapshot_goodId_fkey" FOREIGN KEY ("goodId") REFERENCES "Good"("id") ON DELETE CASCADE ON UPDATE CASCADE;
