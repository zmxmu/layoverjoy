import { Controller, Get, Header, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CATALOG_VERSION, CONTINENTS, COUNTRIES, resolveLocation, resolveSelection, searchCities } from './catalog';
import { AppError } from '../common/errors';

/**
 * 城市目录接口（12 号方案 §9.2）：地点浏览不涉及个人数据，允许匿名访问并设公共缓存；
 * 搜索/证件/预订接口继续要求登录。
 */
@ApiTags('airports')
@Controller('airports')
export class AirportsController {
  @Get('catalog/version')
  @Header('Cache-Control', 'public, max-age=3600')
  version() {
    return CATALOG_VERSION;
  }

  /** 洲/国家层级浏览数据（离线友好的匿名只读接口）。 */
  @Get('catalog/browse')
  @Header('Cache-Control', 'public, max-age=3600')
  browse() {
    return {
      ...CATALOG_VERSION,
      continents: CONTINENTS.map((c) => ({
        ...c,
        countries: c.countryCodes
          .map((code) => COUNTRIES.find((x) => x.countryCode === code))
          .filter(Boolean)
          .map((k) => ({ countryCode: k!.countryCode, nameZh: k!.nameZh, nameEn: k!.nameEn, cityCount: k!.cityIds.length })),
      })),
    };
  }

  @Get('cities')
  @Header('Cache-Control', 'public, max-age=300')
  cities(
    @Query('q') q?: string,
    @Query('continent') continent?: string,
    @Query('country') country?: string,
    @Query('limit') limit?: string,
  ) {
    if (!q) {
      // 无查询词：返回全量精简列表（兼容旧调用）
      return {
        query: '',
        results: searchCities('', { continent, country, limit: 200 }),
      };
    }
    return {
      query: q,
      results: searchCities(q, { continent, country, limit: Number(limit) || 20 }),
    };
  }

  /** 旧精确解析（迁移期保留）。 */
  @Get('resolve')
  resolve(@Query('input') input?: string) {
    if (!input) throw AppError.validation(['input']);
    const loc = resolveLocation(input);
    if (!loc) {
      throw new AppError('UNSUPPORTED_AIRPORT', '当前 MVP 暂不支持这个城市或机场。', 422, false, { input });
    }
    return { location: loc };
  }

  /** V2 选择校验预览：cityId + mode + airportIata 的权威解析结果。 */
  @Get('selection')
  selection(@Query('cityId') cityId?: string, @Query('mode') mode?: string, @Query('airportIata') airportIata?: string) {
    const r = resolveSelection({ cityId: cityId ?? '', mode: (mode as any) ?? 'ALL_AIRPORTS', airportIata: airportIata || null });
    if (!r.ok) throw new AppError('INVALID_LOCATION_SELECTION', '地点选择不合法。', 422, false, { reason: r.error });
    const { city, ...rest } = r.value;
    return {
      cityId: city.cityId,
      cityNameZh: city.nameZh,
      cityNameEn: city.nameEn,
      countryCode: city.countryCode,
      ...rest,
    };
  }
}
