import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { httpConfig } from '../config/http.config';

const logger = new Logger('HttpTiming');

@Injectable()
export class HttpTimingInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (!httpConfig.slowRequestLog) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const start = Date.now();
    const method = req.method as string;
    const path =
      (req.route?.path as string | undefined) ??
      (req.url as string).split('?')[0];

    return next.handle().pipe(
      tap({
        finalize: () => {
          const duration = Date.now() - start;
          if (duration < httpConfig.slowRequestMs) return;

          const res = context.switchToHttp().getResponse();
          const statusCode = res.statusCode as number;
          logger.warn(
            `Slow request (${duration}ms): ${method} ${path} ${statusCode}`,
          );
        },
      }),
    );
  }
}
