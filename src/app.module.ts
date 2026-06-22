import { DictionaryModule } from './dictionary/dictionary.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { GenshinAccountsModule } from './genshin-accounts/genshin-accounts.module';
import { GoodsModule } from './goods/goods.module';
import { ImportModule } from './import/import.module';

@Module({
  imports: [
    PrismaModule,
    DictionaryModule,AuthModule, UsersModule, GenshinAccountsModule, GoodsModule, ImportModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

