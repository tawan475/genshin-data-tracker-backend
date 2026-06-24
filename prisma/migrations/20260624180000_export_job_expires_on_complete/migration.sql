-- AlterTable: expiry starts when export completes, not when job is created
ALTER TABLE "ExportJob" ALTER COLUMN "expiresAt" DROP NOT NULL;
