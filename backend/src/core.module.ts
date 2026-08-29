import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaService } from './prisma.service';
import { RedisService } from './redis.service';
import { loadEnv } from './config/env';
import { FieldCrypto } from './common/crypto';

export const FIELD_CRYPTO = 'FIELD_CRYPTO';

/** 全局核心模块：Prisma、Redis、JWT、字段加密。 */
@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      useFactory: () => {
        const env = loadEnv();
        return {
          secret: env.JWT_SECRET,
          signOptions: { expiresIn: '15m', audience: 'layoverjoy-access' },
        };
      },
    }),
  ],
  providers: [
    PrismaService,
    RedisService,
    {
      provide: FIELD_CRYPTO,
      useFactory: () => new FieldCrypto(loadEnv().DATA_ENCRYPTION_KEY),
    },
  ],
  exports: [PrismaService, RedisService, JwtModule, FIELD_CRYPTO],
})
export class CoreModule {}
