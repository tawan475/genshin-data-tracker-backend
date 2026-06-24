import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { StreamableFile } from '@nestjs/common';
import { ApiResponse } from '../interfaces/api-response.interface';
import { SKIP_RESPONSE_WRAP_KEY } from '../decorators/skip-response-wrap.decorator';

@Injectable()
export class ResponseInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T> | StreamableFile>
{
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Observable<ApiResponse<T> | StreamableFile> {
    const skipWrap = this.reflector.get<boolean>(
      SKIP_RESPONSE_WRAP_KEY,
      context.getHandler(),
    );

    return next.handle().pipe(
      map((data) => {
        if (skipWrap || data instanceof StreamableFile) {
          return data;
        }
        const response = context.switchToHttp().getResponse();
        return {
          status: response.statusCode,
          message: 'success',
          data,
        };
      }),
    );
  }
}
