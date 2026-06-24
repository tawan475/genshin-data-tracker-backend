import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  ParseIntPipe,
  UseGuards,
  Patch,
  Delete,
  UseInterceptors,
  UploadedFile,
  UploadedFiles,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { GenshinAccountsService } from './genshin-accounts.service';
import { SnapshotExportService } from './snapshot-export.service';
import { CreateGenshinAccountDto } from './dto/create-genshin-account.dto';
import { UpdateGenshinAccountDto } from './dto/update-genshin-account.dto';
import { DeleteGenshinAccountDto } from './dto/delete-genshin-account.dto';
import { BulkSnapshotActionDto } from './dto/bulk-snapshot-action.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { User } from '../auth/decorators/user.decorator';
import { SkipResponseWrap } from '../common/decorators/skip-response-wrap.decorator';
import { SettingsService } from '../settings/settings.service';
import { PatchAccountSettingsDto } from '../settings/dto/patch-account-settings.dto';

@Controller('genshin-accounts')
@UseGuards(JwtAuthGuard)
export class GenshinAccountsController {
  constructor(
    private readonly genshinAccountsService: GenshinAccountsService,
    private readonly snapshotExportService: SnapshotExportService,
    private readonly settingsService: SettingsService,
  ) {}

  @Post(':id/import-key')
  generateImportKey(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    // Service handles verifying if the user actually owns the account
    return this.genshinAccountsService.generateImportKey(userId, id);
  }

  @Post()
  create(
    @User('id') userId: number,
    @Body() dto: CreateGenshinAccountDto,
  ) {
    return this.genshinAccountsService.create(userId, dto);
  }

  @Get()
  findAll(
    @User('id') userId: number,
    @Query() pagination: PaginationDto,
  ) {
    return this.genshinAccountsService.findAllByUser(userId, pagination);
  }



  @Get('active-export')
  getActiveExport(@User('id') userId: number) {
    return this.snapshotExportService.getActiveExportForUser(userId);
  }

  @Get('dashboard-summary')
  getDashboardSummary(@User('id') userId: number) {
    return this.genshinAccountsService.getDashboardSummary(userId);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.genshinAccountsService.findOne(id);
  }

  @Patch(':id')
  update(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateGenshinAccountDto,
  ) {
    return this.genshinAccountsService.update(userId, id, dto);
  }

  @Delete(':id')
  remove(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: DeleteGenshinAccountDto,
  ) {
    return this.genshinAccountsService.remove(userId, id, dto);
  }

  @Post(':id/import')
  @UseInterceptors(FileInterceptor('file'))
  importData(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() file: any,
    @Body('timestamp') timestamp?: string,
  ) {
    return this.genshinAccountsService.importData(userId, id, file, timestamp);
  }

  @Post(':id/import-bulk')
  @UseInterceptors(FilesInterceptor('files'))
  importBulk(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: any[],
    @Body('timestamps') timestampsStr?: string,
  ) {
    let timestamps: (string | undefined)[] = [];
    if (timestampsStr) {
      try {
        timestamps = JSON.parse(timestampsStr);
      } catch (e) {
        timestamps = [];
      }
    }
    return this.genshinAccountsService.importBulkData(userId, id, files, timestamps);
  }

  @Post(':id/import-bulk-stream')
  @UseInterceptors(FilesInterceptor('files'))
  async importBulkStream(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @UploadedFiles() files: any[],
    @Res() res: any,
    @Body('timestamps') timestampsStr?: string,
  ) {
    let timestamps: (string | undefined)[] = [];
    if (timestampsStr) {
      try {
        timestamps = JSON.parse(timestampsStr);
      } catch (e) {
        timestamps = [];
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const results = await this.genshinAccountsService.importBulkData(
      userId, 
      id, 
      files, 
      timestamps,
      (progressData) => {
        // Write each progress update as NDJSON
        res.write(JSON.stringify({ type: 'progress', ...progressData }) + '\n');
      }
    );

    // Write final results
    res.write(JSON.stringify({ type: 'complete', results }) + '\n');
    res.end();
  }


  @Get(':id/overview')
  getOverview(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('groupBy') groupBy?: 'hour' | 'day' | 'month' | 'year',
    @Query('limit') limit?: string,
  ) {
    return this.genshinAccountsService.getOverviewStats(
      userId,
      id,
      groupBy || 'day',
      limit ? parseInt(limit, 10) : 90,
    );
  }

  @Get(':id/storage-stats')
  getStorageStats(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.genshinAccountsService.getStorageStats(userId, id);
  }

  @Get(':id/snapshots')
  getSnapshots(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() pagination: PaginationDto,
  ) {
    return this.genshinAccountsService.getSnapshots(userId, id, pagination);
  }

  @Get(':id/artifacts')
  getArtifacts(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() pagination: PaginationDto,
    @Query('sortBy') sortBy?: string,
    @Query('search') search?: string,
  ) {
    return this.genshinAccountsService.getArtifacts(userId, id, sortBy || 'cv', search, pagination);
  }

  @Get(':id/settings')
  getAccountSettings(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.settingsService.getAccountSettings(userId, id);
  }

  @Patch(':id/settings')
  patchAccountSettings(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: PatchAccountSettingsDto,
  ) {
    return this.settingsService.patchAccountSettings(userId, id, dto);
  }

  @Get(':id/materials/catalog')
  getMaterialsCatalog(
    @Query('search') search?: string,
    @Query('limit') limit?: string,
  ) {
    return this.genshinAccountsService.getMaterialsCatalog(
      search,
      limit ? parseInt(limit, 10) : 30,
    );
  }

  @Get(':id/materials/history')
  getMaterialsHistory(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('keys') keys?: string,
    @Query('groupBy') groupBy?: 'hour' | 'day' | 'month' | 'year',
    @Query('limit') limit?: string,
  ) {
    const keyList = keys
      ? keys.split(',').map((k) => k.trim()).filter(Boolean)
      : [];
    return this.genshinAccountsService.getMaterialsHistory(
      userId,
      id,
      keyList,
      groupBy || 'day',
      limit ? parseInt(limit, 10) : 365,
    );
  }

  @Get(':id/materials')
  getCurrentMaterials(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() pagination: PaginationDto,
    @Query('sortBy') sortBy?: string,
    @Query('search') search?: string,
  ) {
    return this.genshinAccountsService.getCurrentMaterials(
      userId,
      id,
      search,
      sortBy || 'count',
      pagination,
    );
  }

  @Get(':id/export/latest')
  exportLatestSnapshot(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.genshinAccountsService.exportLatestSnapshot(userId, id);
  }

  @Get(':id/snapshots/:snapshotId/export')
  async exportSnapshot(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('snapshotId', ParseIntPipe) snapshotId: number,
    @Query('attachment') attachment?: string,
  ) {
    const wantsFile =
      attachment === '1' || attachment === 'true' || attachment === 'attachment';

    if (wantsFile) {
      const { payload, filename } =
        await this.genshinAccountsService.exportSnapshotFile(
          userId,
          id,
          snapshotId,
        );
      const buffer = Buffer.from(JSON.stringify(payload), 'utf-8');
      return new StreamableFile(buffer, {
        type: 'application/json',
        disposition: `attachment; filename="${filename}"`,
      });
    }

    return this.genshinAccountsService.exportSnapshot(userId, id, snapshotId);
  }

  @Post(':id/snapshots/bulk-export')
  async bulkExport(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BulkSnapshotActionDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.snapshotExportService.bulkExport(userId, id, dto);
    res.status(result.httpStatus);
    return result.body;
  }

  @Get(':id/export-jobs')
  listExportJobs(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query() pagination: PaginationDto,
  ) {
    return this.snapshotExportService.listJobs(userId, id, pagination);
  }

  @Get(':id/export-jobs/:jobId')
  getExportJob(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('jobId') jobId: string,
  ) {
    return this.snapshotExportService.getJob(userId, id, jobId);
  }

  @Get(':id/export-jobs/:jobId/download')
  @SkipResponseWrap()
  async downloadExportJob(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('jobId') jobId: string,
  ) {
    const { stream, filename } =
      await this.snapshotExportService.streamJobDownload(userId, id, jobId);
    return new StreamableFile(stream, {
      type: 'application/zip',
      disposition: `attachment; filename="${filename}"`,
    });
  }

  @Get(':id/analysis/monthly')
  getMonthlyAnalysis(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Query('month') month: string,
    @Query('year') year: string,
  ) {
    return this.genshinAccountsService.getMonthlyAnalysis(
      userId, 
      id, 
      month ? parseInt(month, 10) : new Date().getUTCMonth() + 1,
      year ? parseInt(year, 10) : new Date().getUTCFullYear()
    );
  }

  @Post(':id/snapshots/bulk-delete')
  deleteSnapshots(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: BulkSnapshotActionDto,
  ) {
    return this.genshinAccountsService.deleteSnapshots(
      userId,
      id,
      dto.snapshotIds ?? [],
      dto.selectAll,
    );
  }

  @Delete(':id/snapshots/:snapshotId')
  deleteSnapshot(
    @User('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('snapshotId', ParseIntPipe) snapshotId: number,
  ) {
    return this.genshinAccountsService.deleteSnapshot(userId, id, snapshotId);
  }
}
