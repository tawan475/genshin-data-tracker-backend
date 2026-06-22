/*
  Warnings:

  - Made the column `importKeyHash` on table `GenshinAccount` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "GenshinAccount" ALTER COLUMN "importKeyHash" SET NOT NULL;
