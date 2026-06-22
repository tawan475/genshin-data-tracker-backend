import { Global, Module } from '@nestjs/common';
import { DictionaryService } from './dictionary.service';
import { } from '../prisma.service'; // Adjust if prisma module is used

@Global()
@Module({
  providers: [DictionaryService],
  exports: [DictionaryService],
})
export class DictionaryModule {}
