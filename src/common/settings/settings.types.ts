export type TimelineGroupBy = 'hour' | 'day' | 'month' | 'year';

export interface MaterialsGraphSettings {
  selectedKeys: string[];
  groupBy: TimelineGroupBy;
  limit: number;
}

export interface AccountSettings {
  materialsGraph?: Partial<MaterialsGraphSettings>;
}

export interface UserSettings {
  theme?: 'light' | 'dark';
  use24Hour?: boolean;
}

export const USER_SETTINGS_DEFAULTS: Required<UserSettings> = {
  theme: 'light',
  use24Hour: false,
};

export const MATERIALS_GRAPH_DEFAULTS: MaterialsGraphSettings = {
  selectedKeys: [],
  groupBy: 'day',
  limit: 365,
};

export const ACCOUNT_SETTINGS_DEFAULTS: {
  materialsGraph: MaterialsGraphSettings;
} = {
  materialsGraph: MATERIALS_GRAPH_DEFAULTS,
};
