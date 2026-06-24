import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  ACCOUNT_SETTINGS_DEFAULTS,
  AccountSettings,
  MATERIALS_GRAPH_DEFAULTS,
  MaterialsGraphSettings,
  USER_SETTINGS_DEFAULTS,
  UserSettings,
} from '../common/settings/settings.types';
import { deepMerge } from '../common/utils/deep-merge.util';
import { PatchAccountSettingsDto } from './dto/patch-account-settings.dto';
import { PatchUserSettingsDto } from './dto/patch-user-settings.dto';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeUserSettings(raw: unknown): Required<UserSettings> {
    const stored = (raw && typeof raw === 'object' ? raw : {}) as UserSettings;
    return {
      theme: stored.theme === 'dark' ? 'dark' : USER_SETTINGS_DEFAULTS.theme,
      use24Hour:
        typeof stored.use24Hour === 'boolean'
          ? stored.use24Hour
          : USER_SETTINGS_DEFAULTS.use24Hour,
    };
  }

  private normalizeMaterialsGraph(
    raw: Partial<MaterialsGraphSettings> | undefined,
  ): MaterialsGraphSettings {
    const groupBy = raw?.groupBy;
    const validGroupBy =
      groupBy === 'hour' ||
      groupBy === 'day' ||
      groupBy === 'month' ||
      groupBy === 'year'
        ? groupBy
        : MATERIALS_GRAPH_DEFAULTS.groupBy;

    const limit =
      typeof raw?.limit === 'number' &&
      raw.limit >= 7 &&
      raw.limit <= 3650
        ? raw.limit
        : MATERIALS_GRAPH_DEFAULTS.limit;

    const selectedKeys = Array.isArray(raw?.selectedKeys)
      ? raw.selectedKeys.filter((k) => typeof k === 'string' && k.length > 0)
      : MATERIALS_GRAPH_DEFAULTS.selectedKeys;

    return { selectedKeys, groupBy: validGroupBy, limit };
  }

  private normalizeAccountSettings(raw: unknown): {
    materialsGraph: MaterialsGraphSettings;
  } {
    const stored = (raw && typeof raw === 'object' ? raw : {}) as AccountSettings;
    return {
      materialsGraph: this.normalizeMaterialsGraph(stored.materialsGraph),
    };
  }

  async getUserSettings(userId: number): Promise<Required<UserSettings>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    if (!user) throw new NotFoundException('User not found');
    return this.normalizeUserSettings(user.settings);
  }

  async patchUserSettings(
    userId: number,
    dto: PatchUserSettingsDto,
  ): Promise<Required<UserSettings>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { settings: true },
    });
    if (!user) throw new NotFoundException('User not found');

    const current = this.normalizeUserSettings(user.settings);
    const merged = deepMerge(
      current as unknown as Record<string, unknown>,
      dto as unknown as Record<string, unknown>,
    ) as Required<UserSettings>;

    const normalized = this.normalizeUserSettings(merged);
    await this.prisma.user.update({
      where: { id: userId },
      data: { settings: normalized },
    });
    return normalized;
  }

  async getAccountSettings(
    userId: number,
    accountId: number,
  ): Promise<{ materialsGraph: MaterialsGraphSettings }> {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
      select: { settings: true },
    });
    if (!account) throw new NotFoundException('Account not found');
    return this.normalizeAccountSettings(account.settings);
  }

  async patchAccountSettings(
    userId: number,
    accountId: number,
    dto: PatchAccountSettingsDto,
  ): Promise<{ materialsGraph: MaterialsGraphSettings }> {
    const account = await this.prisma.genshinAccount.findUnique({
      where: { id: accountId, userId },
      select: { settings: true },
    });
    if (!account) throw new NotFoundException('Account not found');

    const current = this.normalizeAccountSettings(account.settings);
    const merged = deepMerge(
      current as unknown as Record<string, unknown>,
      dto as unknown as Record<string, unknown>,
    );
    const normalized = this.normalizeAccountSettings(merged);

    await this.prisma.genshinAccount.update({
      where: { id: accountId },
      data: { settings: normalized as object },
    });
    return normalized;
  }
}
