import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '@prisma/client';
import { prismaConfig } from './common/config/prisma.config';

const logger = new Logger('PrismaService');

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const adapter = new PrismaPg(pool);

    if (prismaConfig.slowQueryLog) {
      super({
        adapter,
        log: [
          { emit: 'event', level: 'query' },
          'warn',
          'error',
        ],
      });

      this.$on('query' as never, (e: Prisma.QueryEvent) => {
        if (e.duration < prismaConfig.slowQueryMs) return;
        logger.warn(
          `Slow query (${e.duration}ms): ${e.query} | params: ${e.params}`,
        );
      });
    } else {
      super({ adapter });
    }
  }

  async onModuleInit() {
    if (prismaConfig.slowQueryLog) {
      logger.log(
        `Slow query logging enabled (threshold: ${prismaConfig.slowQueryMs}ms)`,
      );
    }
    await this.$connect();
  }
}
