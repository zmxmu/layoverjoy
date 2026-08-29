import { Module } from '@nestjs/common';
import { AtlasService } from './atlas.service';
import { RedisService } from '../redis.service';

@Module({
  providers: [AtlasService, RedisService],
  exports: [AtlasService],
})
export class AtlasModule {}
