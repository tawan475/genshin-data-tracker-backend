export interface ApiResponse<T = any> {
  status: number;
  message: string;
  data?: T;
}

export interface PaginatedResult<T = any> {
  edges?: T[];
  items?: T[];
  total?: number;
  meta?: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  };
  enum?: Record<string, any>;
}
