import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CurrentUser, JwtAuthGuard, AuthUser } from '../common/auth';
import { candidateHubs, HUB_CATALOG, resolveLocation } from './catalog';
import { EntryRulesService } from '../entry-rules/entry-rules.service';
import { UsersService } from '../users/users.service';
import { AppError } from '../common/errors';

/** 机场与城市目录接口：搜索前决定城市码或机场码。 */
@ApiTags('airports')
@Controller('airports')
@UseGuards(JwtAuthGuard)
export class AirportsController {
  constructor(private readonly rules: EntryRulesService) {}

  @Get('cities')
  cities(@Query('q') q?: string) {
    const all = HUB_CATALOG.map((c) => ({
      cityId: c.cityId,
      cityNameZh: c.cityNameZh,
      cityNameEn: c.cityNameEn,
      countryCode: c.countryCode,
      metroCode: c.metroCode,
      airports: c.airports,
    }));
    if (!q) return { cities: all };
    const kw = q.toLowerCase();
    return {
      cities: all.filter(
        (c) =>
          c.cityNameZh.includes(q) ||
          c.cityNameEn.toLowerCase().includes(kw) ||
          (c.metroCode || '').toLowerCase() === kw ||
          c.airports.some((a) => a.iata.toLowerCase() === kw),
      ),
    };
  }

  @Get('resolve')
  resolve(@Query('input') input?: string) {
    if (!input) throw AppError.validation(['input']);
    const loc = resolveLocation(input);
    if (!loc) {
      throw new AppError('UNSUPPORTED_AIRPORT', '当前 MVP 暂不支持这个城市或机场。', 422, false, { input });
    }
    return { location: loc };
  }
}
