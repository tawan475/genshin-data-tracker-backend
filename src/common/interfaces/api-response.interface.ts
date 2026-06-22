export interface ApiResponse<T = any> {
  status: number;
  message: string;
  data?: T;
}

export interface PaginatedResult<T = any> {
  edges: T[];
  total: number;
  enum?: Record<string, any>;
}
