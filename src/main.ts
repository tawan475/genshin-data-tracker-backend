import 'dotenv/config';
import { Logger, ValidationPipe } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { HttpTimingInterceptor } from './common/interceptors/http-timing.interceptor';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { httpConfig } from './common/config/http.config';
import { prismaConfig } from './common/config/prisma.config';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const observabilityEnabled =
    prismaConfig.slowQueryLog || httpConfig.slowRequestLog;

  const app = await NestFactory.create(AppModule, {
    logger: observabilityEnabled
      ? ['error', 'warn', 'log', 'debug']
      : ['error', 'warn', 'log'],
  });

  if (observabilityEnabled) {
    const parts: string[] = [];
    if (prismaConfig.slowQueryLog) {
      parts.push(`prisma slow queries >= ${prismaConfig.slowQueryMs}ms`);
    }
    if (httpConfig.slowRequestLog) {
      parts.push(`HTTP slow requests >= ${httpConfig.slowRequestMs}ms`);
    }
    logger.log(`Observability: ${parts.join(', ')}`);
  }

  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  app.useGlobalInterceptors(new HttpTimingInterceptor());
  app.useGlobalInterceptors(new ResponseInterceptor(app.get(Reflector)));
  app.useGlobalFilters(new HttpExceptionFilter());

  const port = process.env.PORT ?? 49000;
  await app.listen(port);
  logger.log(`Application is running on: ${await app.getUrl()}`);
}
bootstrap().catch((err) => {
  const logger = new Logger('Bootstrap');
  logger.error('Unhandled rejection in bootstrap', err);
  process.exit(1);
});
