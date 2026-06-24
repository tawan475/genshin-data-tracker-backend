import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  GoneException,
  ConflictException,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import * as os from 'os';
import { randomBytes } from 'crypto';
import {
  AccountArtifact,
  ExportJobStatus,
  Good,
} from '@prisma/client';
import { ZipArchive } from 'archiver';
import * as fs from 'fs';
import * as path from 'path';
import { createReadStream, createWriteStream } from 'fs';
import { Readable, Writable } from 'stream';
import { createGzip, createGunzip } from 'zlib';
import { PrismaService } from '../prisma.service';
import { DictionaryService } from '../dictionary/dictionary.service';
import {
  DataPacker,
  CHARACTER_SCHEMA,
  WEAPON_SCHEMA,
} from '../common/utils/data-packer.util';
import { exportConfig } from '../common/config/export.config';
import {
  gdtBulkExportFilename,
  gdtExportFilename,
  uniqueEntryNames,
} from '../common/utils/gdt-export.util';
import { BulkSnapshotActionDto } from './dto/bulk-snapshot-action.dto';
import { PaginationDto } from '../common/dto/pagination.dto';

export interface GoodExportPayload {
  format: string;
  version: number;
  source: string;
  characters: unknown[];
  artifacts: unknown[];
  weapons: unknown[];
  materials: Record<string, number>;
  gi_achievements?: unknown[];
}

@Injectable()
export class SnapshotExportService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SnapshotExportService.name);
  private readonly packer: DataPacker;
  /** Unique per process — used to claim jobs across horizontally scaled instances. */
  private readonly workerId = `${os.hostname()}-${process.pid}-${randomBytes(4).toString('hex')}`;
  private sweeperTimer: ReturnType<typeof setInterval> | null = null;
  private sweeperRunning = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dictionaryService: DictionaryService,
  ) {
    this.packer = new DataPacker(dictionaryService);
  }

  async onModuleInit() {
    fs.mkdirSync(exportConfig.storageDir, { recursive: true });
    this.logger.log(
      `Export worker ${this.workerId} started (storage: ${exportConfig.storageDir})`,
    );
    await this.cleanupExpiredJobs();
    await this.recoverStaleJobs();
    await this.pickupPendingJobs();
    this.sweeperTimer = setInterval(() => {
      void this.runSweeper();
    }, exportConfig.sweeperIntervalMs);
  }

  onModuleDestroy() {
    if (this.sweeperTimer) {
      clearInterval(this.sweeperTimer);
      this.sweeperTimer = null;
    }
  }

  private async runSweeper() {
    if (this.sweeperRunning) return;
    this.sweeperRunning = true;
    try {
      await this.cleanupExpiredJobs();
      await this.recoverStaleJobs();
      await this.pickupPendingJobs();
    } catch (error) {
      this.logger.error('Export sweeper failed', error);
    } finally {
      this.sweeperRunning = false;
    }
  }

  private isStale(job: {
    status: ExportJobStatus;
    heartbeatAt: Date | null;
    lockedAt: Date | null;
  }): boolean {
    if (job.status !== ExportJobStatus.PROCESSING) return false;
    const lastSeen = job.heartbeatAt ?? job.lockedAt;
    if (!lastSeen) return true;
    return Date.now() - lastSeen.getTime() > exportConfig.staleJobMs;
  }

  /** Re-queue or fail jobs whose worker died (crash / deploy). Safe to run on every instance. */
  async recoverStaleJobs() {
    const processing = await this.prisma.exportJob.findMany({
      where: { status: ExportJobStatus.PROCESSING },
    });

    for (const job of processing) {
      if (!this.isStale(job)) continue;

      this.logger.warn(
        `Recovering stale export job ${job.id} (worker=${job.lockedBy ?? 'unknown'}, attempts=${job.attemptCount})`,
      );
      this.deleteJobFile(job.id);

      if (job.attemptCount >= exportConfig.maxAttempts) {
        await this.prisma.exportJob.update({
          where: { id: job.id },
          data: {
            status: ExportJobStatus.FAILED,
            error:
              'Export failed after repeated interruptions. Please try again.',
            lockedAt: null,
            lockedBy: null,
            heartbeatAt: null,
          },
        });
      } else {
        await this.prisma.exportJob.update({
          where: { id: job.id },
          data: {
            status: ExportJobStatus.PENDING,
            progress: 0,
            lockedAt: null,
            lockedBy: null,
            heartbeatAt: null,
            error: null,
          },
        });
      }
    }
  }

  /** Any instance may pick up PENDING jobs; atomic claim prevents duplicate work. */
  async pickupPendingJobs() {
    const pending = await this.prisma.exportJob.findMany({
      where: { status: ExportJobStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });

    for (const job of pending) {
      void this.processJob(job.id);
    }
  }

  private async tryClaimJob(jobId: string): Promise<boolean> {
    const result = await this.prisma.exportJob.updateMany({
      where: {
        id: jobId,
        status: ExportJobStatus.PENDING,
      },
      data: {
        status: ExportJobStatus.PROCESSING,
        lockedAt: new Date(),
        lockedBy: this.workerId,
        heartbeatAt: new Date(),
        attemptCount: { increment: 1 },
        progress: 0,
      },
    });
    return result.count > 0;
  }

  private async touchHeartbeat(jobId: string, progress: number) {
    await this.prisma.exportJob.update({
      where: { id: jobId },
      data: { progress, heartbeatAt: new Date() },
    });
  }

  isSelectAll(selectAll?: boolean | string): boolean {
    return selectAll === true || selectAll === 'true';
  }

  buildSnapshotWhereClause(
    accountId: number,
    snapshotIds: number[] | undefined,
    selectAll?: boolean | string,
  ) {
    const isSelectAll = this.isSelectAll(selectAll);
    if (!isSelectAll && (!snapshotIds || snapshotIds.length === 0)) {
      throw new BadRequestException('No snapshots selected');
    }

    const where: {
      genshinAccountId: number;
      isDeleted: boolean;
      id?: { in: number[] };
    } = {
      genshinAccountId: accountId,
      isDeleted: false,
    };

    if (!isSelectAll) {
      where.id = { in: snapshotIds! };
    }

    return where;
  }

  async assertAccountOwnership(userId: number, accountId: number) {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
    });
    if (!account) {
      throw new NotFoundException('Account not found');
    }
    return account;
  }

  async resolveSnapshotSelection(
    userId: number,
    accountId: number,
    dto: BulkSnapshotActionDto,
  ): Promise<{ goods: Good[] }> {
    await this.assertAccountOwnership(userId, accountId);

    const where = this.buildSnapshotWhereClause(
      accountId,
      dto.snapshotIds,
      dto.selectAll,
    );

    const goods = await this.prisma.good.findMany({
      where,
      orderBy: { createdAt: 'asc' },
    });

    if (goods.length === 0) {
      throw new NotFoundException('No snapshots found');
    }

    if (goods.length > exportConfig.maxCount) {
      throw new BadRequestException(
        `Maximum of ${exportConfig.maxCount} snapshots allowed per export.`,
      );
    }

    return { goods };
  }

  async loadArtifactMap(
    accountId: number,
    goods: Good[],
  ): Promise<Map<number, AccountArtifact>> {
    const allIds = new Set<number>();
    for (const good of goods) {
      for (const id of good.artifactIds ?? []) {
        allIds.add(id);
      }
    }

    if (allIds.size === 0) {
      return new Map();
    }

    const artifacts = await this.prisma.accountArtifact.findMany({
      where: {
        genshinAccountId: accountId,
        id: { in: Array.from(allIds) },
      },
    });

    return new Map(artifacts.map((a) => [a.id, a]));
  }

  buildGoodExport(
    good: Good,
    artifactMap: Map<number, AccountArtifact>,
  ): { payload: GoodExportPayload; createdAt: Date; entryName: string } {
    const artifacts: unknown[] = [];
    for (const artId of good.artifactIds ?? []) {
      const a = artifactMap.get(artId);
      if (!a) continue;
      artifacts.push({
        setKey: a.setKey,
        slotKey: a.slotKey,
        level: a.level,
        rarity: a.rarity,
        mainStatKey: a.mainStatKey,
        location: a.location,
        lock: a.lock,
        substats: Array.isArray(a.substats)
          ? (a.substats as { key: string; value: number }[]).map((s) => ({
              key: s.key,
              value: s.value,
            }))
          : [],
      });
    }

    const packedChars = (good.characters || {}) as Record<string, unknown[]>;
    const characters: unknown[] = [];
    for (const arr of Object.values(packedChars)) {
      characters.push(this.packer.unpack(CHARACTER_SCHEMA, arr));
    }

    const weapons: unknown[] = [];
    for (const arr of (good.weapons || []) as unknown[][]) {
      weapons.push(this.packer.unpack(WEAPON_SCHEMA, arr));
    }

    const materials: Record<string, number> = {};
    for (const [idStr, val] of Object.entries(
      (good.materials || {}) as Record<string, number>,
    )) {
      const key = this.dictionaryService.getKey(parseInt(idStr, 10));
      if (key) materials[key] = val;
    }

    const payload: GoodExportPayload = {
      format: good.format,
      version: good.version,
      source: good.source,
      characters,
      artifacts,
      weapons,
      materials,
    };

    if (good.achievements && Array.isArray(good.achievements)) {
      payload.gi_achievements = good.achievements as unknown[];
    }

    return {
      payload,
      createdAt: good.createdAt,
      entryName: gdtExportFilename(good.createdAt),
    };
  }

  async createBulkZipStream(
    goods: Good[],
    artifactMap: Map<number, AccountArtifact>,
    dest: Writable,
    onProgress?: (processed: number, total: number) => void | Promise<void>,
  ): Promise<void> {
    const entryNames = uniqueEntryNames(
      goods.map((g) => ({ createdAt: g.createdAt, id: g.id })),
    );

    const archive = new ZipArchive({
      zlib: { level: exportConfig.zlibLevel },
    });

    const done = new Promise<void>((resolve, reject) => {
      dest.on('finish', resolve);
      dest.on('error', reject);
      archive.on('error', reject);
    });

    archive.pipe(dest);

    let processed = 0;
    for (const good of goods) {
      const { payload } = this.buildGoodExport(good, artifactMap);
      const name = entryNames.get(good.id)!;
      archive.append(JSON.stringify(payload), { name });
      processed++;
      await onProgress?.(processed, goods.length);

      if (
        exportConfig.simulateProgressDelayMs > 0 &&
        processed < goods.length
      ) {
        await new Promise((resolve) =>
          setTimeout(resolve, exportConfig.simulateProgressDelayMs),
        );
      }
    }

    await archive.finalize();
    await done;
  }

  private jobStoragePath(jobId: string): string {
    const ext = exportConfig.storageGzip ? '.zip.gz' : '.zip';
    return path.join(exportConfig.storageDir, `${jobId}${ext}`);
  }

  async createExportJob(
    userId: number,
    accountId: number,
    dto: BulkSnapshotActionDto,
    goods: Good[],
  ) {
    return this.prisma.exportJob.create({
      data: {
        userId,
        genshinAccountId: accountId,
        snapshotIds: dto.snapshotIds ?? [],
        selectAll: this.isSelectAll(dto.selectAll),
        total: goods.length,
      },
    });
  }

  async processJob(jobId: string): Promise<void> {
    await this.recoverStaleJobs();

    if (!(await this.tryClaimJob(jobId))) {
      return;
    }

    const job = await this.prisma.exportJob.findUnique({ where: { id: jobId } });
    if (!job) return;

    try {
      const where = job.selectAll
        ? {
            genshinAccountId: job.genshinAccountId,
            isDeleted: false,
          }
        : {
            genshinAccountId: job.genshinAccountId,
            isDeleted: false,
            id: { in: job.snapshotIds },
          };

      const goods = await this.prisma.good.findMany({
        where,
        orderBy: { createdAt: 'asc' },
      });

      if (goods.length === 0) {
        throw new Error('No snapshots found for export');
      }

      const artifactMap = await this.loadArtifactMap(
        job.genshinAccountId,
        goods,
      );

      const storagePath = this.jobStoragePath(jobId);
      fs.mkdirSync(path.dirname(storagePath), { recursive: true });

      const fileStream = createWriteStream(storagePath);
      let zipDest: Writable = fileStream;
      if (exportConfig.storageGzip) {
        const gzip = createGzip({ level: exportConfig.zlibLevel });
        gzip.pipe(fileStream);
        zipDest = gzip;
      }

      await this.createBulkZipStream(
        goods,
        artifactMap,
        zipDest,
        async (progress) => {
          await this.touchHeartbeat(jobId, progress);
        },
      );

      await new Promise<void>((resolve, reject) => {
        fileStream.on('finish', resolve);
        fileStream.on('error', reject);
      });

      await this.prisma.exportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.COMPLETED,
          progress: goods.length,
          storagePath,
          completedAt: new Date(),
          lockedAt: null,
          lockedBy: null,
          heartbeatAt: null,
          expiresAt: new Date(
            Date.now() + exportConfig.ttlHours * 60 * 60 * 1000,
          ),
        },
      });
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Export failed';
      this.logger.error(`Export job ${jobId} failed: ${message}`);
      await this.prisma.exportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.FAILED,
          error: message,
          lockedAt: null,
          lockedBy: null,
          heartbeatAt: null,
        },
      });
      this.deleteJobFile(jobId);
    }
  }

  scheduleProcessJob(jobId: string) {
    setImmediate(() => {
      void this.processJob(jobId);
    });
  }

  private isJobExpired(job: {
    status: ExportJobStatus;
    expiresAt: Date | null;
  }): boolean {
    if (job.status === ExportJobStatus.EXPIRED) return true;
    return (
      job.status === ExportJobStatus.COMPLETED &&
      job.expiresAt != null &&
      job.expiresAt < new Date()
    );
  }

  private mapJobListItem(
    job: {
      id: string;
      status: ExportJobStatus;
      progress: number;
      total: number;
      createdAt: Date;
      completedAt: Date | null;
      expiresAt: Date | null;
      error: string | null;
    },
    accountId: number,
  ) {
    const expired = this.isJobExpired(job);
    return {
      jobId: job.id,
      status: expired ? ExportJobStatus.EXPIRED : job.status,
      progress: job.progress,
      total: job.total,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
      downloadReady:
        job.status === ExportJobStatus.COMPLETED && !expired,
      error: job.error,
      downloadUrl: `/genshin-accounts/${accountId}/export-jobs/${job.id}/download`,
    };
  }

  buildJobResponse(job: {
    id: string;
    status: ExportJobStatus;
    progress: number;
    total: number;
    genshinAccountId: number;
  }) {
    const downloadUrl = `/genshin-accounts/${job.genshinAccountId}/export-jobs/${job.id}/download`;
    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      total: job.total,
      downloadUrl,
      downloadReady: job.status === ExportJobStatus.COMPLETED,
    };
  }

  async assertNoInProgressExport(userId: number, excludeJobId?: string) {
    await this.recoverStaleJobs();

    const existing = await this.prisma.exportJob.findFirst({
      where: {
        userId,
        status: { in: [ExportJobStatus.PENDING, ExportJobStatus.PROCESSING] },
        ...(excludeJobId ? { id: { not: excludeJobId } } : {}),
      },
      select: {
        id: true,
        status: true,
        progress: true,
        total: true,
        genshinAccountId: true,
        heartbeatAt: true,
        lockedAt: true,
      },
    });

    if (existing && !this.isStale(existing)) {
      throw new ConflictException(
        'You already have an export in progress. Wait for it to finish on the Export page.',
      );
    }
  }

  async getActiveExportForUser(userId: number) {
    await this.recoverStaleJobs();

    const job = await this.prisma.exportJob.findFirst({
      where: {
        userId,
        status: { in: [ExportJobStatus.PENDING, ExportJobStatus.PROCESSING] },
      },
      select: {
        id: true,
        status: true,
        progress: true,
        total: true,
        genshinAccountId: true,
        createdAt: true,
        heartbeatAt: true,
        lockedAt: true,
      },
    });

    if (!job || this.isStale(job)) {
      return { inProgress: false as const };
    }

    return {
      inProgress: true as const,
      job: {
        jobId: job.id,
        status: job.status,
        progress: job.progress,
        total: job.total,
        genshinAccountId: job.genshinAccountId,
        createdAt: job.createdAt,
      },
    };
  }

  async bulkExport(
    userId: number,
    accountId: number,
    dto: BulkSnapshotActionDto,
  ) {
    await this.recoverStaleJobs();
    await this.assertNoInProgressExport(userId);

    const { goods } = await this.resolveSnapshotSelection(
      userId,
      accountId,
      dto,
    );

    const job = await this.createExportJob(userId, accountId, dto, goods);

    if (goods.length <= exportConfig.asyncThreshold) {
      await this.processJob(job.id);
      const updated = await this.prisma.exportJob.findUnique({
        where: { id: job.id },
      });
      if (!updated || updated.status === ExportJobStatus.FAILED) {
        throw new BadRequestException(updated?.error ?? 'Export failed');
      }
      return { httpStatus: 200, body: this.buildJobResponse(updated) };
    }

    this.scheduleProcessJob(job.id);
    return {
      httpStatus: 202,
      body: this.buildJobResponse(job),
    };
  }

  async getJob(userId: number, accountId: number, jobId: string) {
    await this.assertAccountOwnership(userId, accountId);

    const job = await this.prisma.exportJob.findFirst({
      where: { id: jobId, userId, genshinAccountId: accountId },
    });

    if (!job) {
      throw new NotFoundException('Export job not found');
    }

    if (job.status === ExportJobStatus.EXPIRED) {
      throw new GoneException('Export has expired');
    }
    if (job.expiresAt && job.expiresAt < new Date()) {
      throw new GoneException('Export has expired');
    }

    return {
      jobId: job.id,
      status: job.status,
      progress: job.progress,
      total: job.total,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
      expiresAt: job.expiresAt,
      downloadReady: job.status === ExportJobStatus.COMPLETED,
      error: job.error,
      downloadUrl: `/genshin-accounts/${accountId}/export-jobs/${job.id}/download`,
    };
  }

  async listJobs(userId: number, accountId: number, pagination: PaginationDto) {
    await this.assertAccountOwnership(userId, accountId);

    const where = { userId, genshinAccountId: accountId };

    const [items, total] = await Promise.all([
      this.prisma.exportJob.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: pagination.skip,
        take: pagination.take,
      }),
      this.prisma.exportJob.count({ where }),
    ]);

    return {
      items: items.map((job) => this.mapJobListItem(job, accountId)),
      meta: {
        total,
        page: pagination.parsedPage,
        limit: pagination.parsedLimit,
        totalPages: Math.ceil(total / pagination.parsedLimit),
      },
    };
  }

  async streamJobDownload(
    userId: number,
    accountId: number,
    jobId: string,
  ): Promise<{ stream: Readable; filename: string }> {
    await this.assertAccountOwnership(userId, accountId);

    const job = await this.prisma.exportJob.findFirst({
      where: { id: jobId, userId, genshinAccountId: accountId },
    });

    if (!job) {
      throw new NotFoundException('Export job not found');
    }

    if (job.status !== ExportJobStatus.COMPLETED || !job.storagePath) {
      throw new BadRequestException('Export is not ready for download');
    }

    if (this.isJobExpired(job)) {
      throw new GoneException('Export has expired');
    }

    if (!fs.existsSync(job.storagePath)) {
      throw new NotFoundException('Export file not found');
    }

    const filename = gdtBulkExportFilename(job.createdAt);
    let stream: Readable = createReadStream(job.storagePath);

    if (exportConfig.storageGzip && job.storagePath.endsWith('.gz')) {
      stream = stream.pipe(createGunzip()) as Readable;
    }

    return { stream, filename };
  }

  deleteJobFile(jobId: string) {
    for (const ext of ['.zip.gz', '.zip']) {
      const filePath = path.join(exportConfig.storageDir, `${jobId}${ext}`);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    }
  }

  async cleanupExpiredJobs() {
    const expired = await this.prisma.exportJob.findMany({
      where: {
        OR: [
          {
            status: ExportJobStatus.COMPLETED,
            expiresAt: { lt: new Date() },
          },
          { status: ExportJobStatus.EXPIRED },
        ],
      },
    });

    for (const job of expired) {
      if (job.storagePath && fs.existsSync(job.storagePath)) {
        fs.unlinkSync(job.storagePath);
      } else {
        this.deleteJobFile(job.id);
      }
    }

    if (expired.length > 0) {
      await this.prisma.exportJob.updateMany({
        where: { id: { in: expired.map((j) => j.id) } },
        data: { status: ExportJobStatus.EXPIRED },
      });
    }
  }

  async exportGoodJson(
    userId: number,
    accountId: number,
    snapshotId: number,
  ): Promise<{ payload: GoodExportPayload; filename: string }> {
    await this.assertAccountOwnership(userId, accountId);

    const good = await this.prisma.good.findFirst({
      where: { id: snapshotId, genshinAccountId: accountId, isDeleted: false },
    });

    if (!good) {
      throw new NotFoundException('Snapshot not found');
    }

    const artifactMap = await this.loadArtifactMap(accountId, [good]);
    const { payload, createdAt } = this.buildGoodExport(good, artifactMap);

    return {
      payload,
      filename: gdtExportFilename(createdAt),
    };
  }
}
