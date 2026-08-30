/**
 * 城市与机场目录（v2）。单一事实源：shared/catalog/city-airport-catalog.zh-en.json
 * （经 scripts/sync-catalog.sh 同步到本目录，禁止手改副本）。
 *
 * 产品边界（12 号方案 §2.3）：目录只用于地点选择；航班以 Atlas 实时返回为准；
 * 入境资格以证件规则引擎为准。不得把无库存/超时显示成“城市不支持”。
 */

import catalogJson from './city-airport-catalog.zh-en.json';

export interface AirportEntry {
  iata: string;
  nameZh: string;
  nameEn: string;
}

export interface CatalogCity {
  cityId: string;
  continentCode: string;
  countryCode: string;
  nameZh: string;
  nameEn: string;
  searchAliases: string[];
  timezone: string;
  metroCode: string | null;
  defaultAirportIata: string;
  latitude: number | null;
  longitude: number | null;
  airports: AirportEntry[];
}

export interface CatalogCountry {
  countryCode: string;
  continentCode: string;
  nameZh: string;
  nameEn: string;
  popularCityIds: string[];
  cityIds: string[];
}

export interface CatalogContinent {
  continentCode: string;
  nameZh: string;
  nameEn: string;
  sortOrder: number;
  popularCityIds: string[];
  countryCodes: string[];
}

export const CATALOG_VERSION: { schemaVersion: string; catalogType: string } = {
  schemaVersion: (catalogJson as any).schemaVersion,
  catalogType: (catalogJson as any).catalogType,
};

export const POPULAR_CITY_IDS: string[] = (catalogJson as any).popularCityIds ?? [];

const rawContinents: any[] = (catalogJson as any).continents ?? [];

export const CONTINENTS: CatalogContinent[] = [];
export const COUNTRIES: CatalogCountry[] = [];
export const CITIES: CatalogCity[] = [];

const cityById = new Map<string, CatalogCity>();
const iataToCity = new Map<string, CatalogCity>();
const countryByCode = new Map<string, CatalogCountry>();

// ---------- 启动校验：schemaVersion / 重复 cityId / 重复 IATA / 空机场 ----------
{
  if (!CATALOG_VERSION.schemaVersion?.startsWith('2.')) {
    throw new Error(`catalog schemaVersion unsupported: ${CATALOG_VERSION.schemaVersion}`);
  }
  for (const cont of [...rawContinents].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))) {
    const continent: CatalogContinent = {
      continentCode: cont.continentCode,
      nameZh: cont.nameZh,
      nameEn: cont.nameEn,
      sortOrder: cont.sortOrder ?? 0,
      popularCityIds: cont.popularCityIds ?? [],
      countryCodes: [],
    };
    for (const ctry of cont.countries ?? []) {
      const country: CatalogCountry = {
        countryCode: ctry.countryCode,
        continentCode: cont.continentCode,
        nameZh: ctry.nameZh,
        nameEn: ctry.nameEn,
        popularCityIds: ctry.popularCityIds ?? [],
        cityIds: [],
      };
      for (const c of ctry.cities ?? []) {
        if (cityById.has(c.cityId)) throw new Error(`duplicate cityId: ${c.cityId}`);
        if (!Array.isArray(c.airports) || c.airports.length === 0) throw new Error(`empty airports: ${c.cityId}`);
        const city: CatalogCity = {
          cityId: c.cityId,
          continentCode: cont.continentCode,
          countryCode: c.countryCode,
          nameZh: c.nameZh,
          nameEn: c.nameEn,
          searchAliases: c.searchAliases ?? [],
          timezone: c.timezone,
          metroCode: c.metroCode ?? null,
          defaultAirportIata: c.defaultAirportIata,
          latitude: typeof c.latitude === 'number' ? c.latitude : null,
          longitude: typeof c.longitude === 'number' ? c.longitude : null,
          airports: c.airports,
        };
        for (const a of city.airports) {
          if (iataToCity.has(a.iata)) throw new Error(`duplicate IATA: ${a.iata}`);
          iataToCity.set(a.iata, city);
        }
        cityById.set(city.cityId, city);
        CITIES.push(city);
        country.cityIds.push(city.cityId);
      }
      countryByCode.set(country.countryCode, country);
      COUNTRIES.push(country);
      continent.countryCodes.push(country.countryCode);
    }
    CONTINENTS.push(continent);
  }
}

export function cityOf(cityId: string | null | undefined): CatalogCity | null {
  return cityId ? (cityById.get(cityId) ?? null) : null;
}

export function countryOf(code: string): CatalogCountry | null {
  return countryByCode.get(code) ?? null;
}

// ---------- 旧接口适配器（plans/monitors/orchestrator 沿用 CityEntry 形状） ----------

export interface CityEntry {
  cityId: string;
  cityNameZh: string;
  cityNameEn: string;
  countryCode: string;
  timezone: string;
  metroCode: string | null;
  airports: AirportEntry[];
}

export const HUB_CATALOG: CityEntry[] = CITIES.map((c) => ({
  cityId: c.cityId,
  cityNameZh: c.nameZh,
  cityNameEn: c.nameEn,
  countryCode: c.countryCode,
  timezone: c.timezone,
  metroCode: c.metroCode,
  airports: c.airports,
}));

export interface ResolvedLocation {
  cityId: string;
  cityNameZh: string;
  cityNameEn: string;
  countryCode: string;
  searchCode: string; // 城市码或机场码
  searchCodeType: 'METRO' | 'AIRPORT';
  airports: AirportEntry[];
}

/** 旧契约：按中文名、英文名、cityId、metroCode、机场 IATA 精确解析（自由文本模糊检索用 searchCities）。 */
export function resolveLocation(inputRaw: string): ResolvedLocation | null {
  const input = (inputRaw || '').trim().toUpperCase();
  if (!input) return null;
  const lower = (inputRaw || '').trim().toLowerCase();
  for (const city of CITIES) {
    const hit =
      lower === city.cityId.toLowerCase() ||
      (inputRaw || '').trim() === city.nameZh ||
      city.nameEn.toUpperCase() === input ||
      (city.metroCode && city.metroCode === input) ||
      city.airports.some((a) => a.iata === input);
    if (hit) {
      return {
        cityId: city.cityId,
        cityNameZh: city.nameZh,
        cityNameEn: city.nameEn,
        countryCode: city.countryCode,
        searchCode: city.metroCode ?? city.airports[0].iata,
        searchCodeType: city.metroCode ? 'METRO' : 'AIRPORT',
        airports: city.airports,
      };
    }
  }
  return null;
}

/** 中转候选城市集合（亚洲热门优先，其余亚洲城市补充；不含出发地与目的地所在国）。 */
export function candidateHubs(excludeCountryCodes: string[], limit = 8): CityEntry[] {
  const asia = CONTINENTS.find((c) => c.continentCode === 'AS');
  const ordered: string[] = [...(asia?.popularCityIds ?? [])];
  for (const cc of asia?.countryCodes ?? []) {
    for (const id of countryByCode.get(cc)?.cityIds ?? []) if (!ordered.includes(id)) ordered.push(id);
  }
  const picked: CityEntry[] = [];
  for (const id of ordered) {
    const city = cityById.get(id);
    if (!city) continue;
    if (excludeCountryCodes.includes(city.countryCode)) continue;
    picked.push(HUB_CATALOG.find((c) => c.cityId === id)!);
    if (picked.length >= limit) break;
  }
  return picked;
}

// ---------- 按航线动态排序的全球中转候选（生产级选城） ----------

type GeoPoint = { lat: number; lon: number };

/** 球面大圆距离（km），用于中转绕飞度排序。 */
function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * 按本次航线动态生成全球中转候选（不再限定亚洲热门三城）：
 * - 候选池为全目录（六大洲）城市，仅排除出发地与目的地所在国；
 * - 两端坐标齐备时按绕飞增量排序：detour = dist(O,H) + dist(H,D) - dist(O,D)，越小越顺路；
 * - 离任一端点不足全程 10% 的“近端点城市”（如伦敦出发经法兰克福）不是有意义的中转停留，
 *   降权排在真正居中的候选之后（不排除，作为候选不足时的补充）；
 * - 短途航线（直达 <600km）无绕行空间，退回热门优先，避免把无关远城排到前面；
 * - 缺坐标的城市按热门次序排在有坐标候选之后。
 */
export function rankHubsForRoute(
  originCityId: string | null,
  destCityId: string | null,
  excludeCountryCodes: string[],
  limit = 16,
): CityEntry[] {
  const origin = originCityId ? cityOf(originCityId) : null;
  const dest = destCityId ? cityOf(destCityId) : null;
  const o: GeoPoint | null =
    origin && typeof origin.latitude === 'number' && typeof origin.longitude === 'number'
      ? { lat: origin.latitude, lon: origin.longitude }
      : null;
  const d: GeoPoint | null =
    dest && typeof dest.latitude === 'number' && typeof dest.longitude === 'number'
      ? { lat: dest.latitude, lon: dest.longitude }
      : null;
  const popularRank = new Map(POPULAR_CITY_IDS.map((id, i) => [id, i]));

  const excludeCityIds = new Set([originCityId, destCityId].filter(Boolean) as string[]);
  const candidates = CITIES.filter(
    (c) => !excludeCountryCodes.includes(c.countryCode) && !excludeCityIds.has(c.cityId),
  );

  const direct = o && d ? distanceKm(o, d) : null;
  const shortHaul = direct !== null && direct < 600;
  const nearEndpoint = direct !== null ? direct * 0.1 : 0;

  const scored = candidates.map((c) => {
    const rank = popularRank.get(c.cityId) ?? 999;
    const p: GeoPoint | null =
      typeof c.latitude === 'number' && typeof c.longitude === 'number'
        ? { lat: c.latitude, lon: c.longitude }
        : null;
    let detour: number | null = null;
    let degenerate = false;
    if (!shortHaul && o && d && p && direct !== null) {
      const dOH = distanceKm(o, p);
      const dHD = distanceKm(p, d);
      detour = dOH + dHD - direct;
      degenerate = dOH < nearEndpoint || dHD < nearEndpoint;
    }
    return { city: c, rank, detour, degenerate };
  });

  scored.sort((a, b) => {
    // 近端点降权：真正居中的候选优先；同类内部再按绕飞度。
    if (a.degenerate !== b.degenerate) return a.degenerate ? 1 : -1;
    if (a.detour !== null && b.detour !== null && Math.abs(a.detour - b.detour) > 150) {
      return a.detour - b.detour;
    }
    if (a.detour === null && b.detour !== null) return 1; // 缺坐标排在可计算绕飞度的城市之后
    if (a.detour !== null && b.detour === null) return -1;
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.city.cityId.localeCompare(b.city.cityId);
  });

  return scored.slice(0, limit).map((s) => HUB_CATALOG.find((c) => c.cityId === s.city.cityId)!);
}

// ---------- 规范化与模糊检索（12 号方案 §6） ----------

/** NFKD → 小写 → 去空格/连字符/撇号/句点 → 去拉丁音调；保留中文。 */
export function normalize(s: string): string {
  return (s || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[\s\-'.]/g, '')
    .replace(/[\u0300-\u036f]/g, '');
}

const CJK_RE = /[\u4e00-\u9fff]/;

function lev1(a: string, b: string): boolean {
  // 仅判断编辑距离 <=1（长度差 <=1 前提下的单遍扫描）
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let [s, l] = a.length <= b.length ? [a, b] : [b, a];
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < s.length && j < l.length) {
    if (s[i] === l[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (s.length === l.length) {
      i++;
      j++;
    } else {
      j++;
    }
  }
  return edits + (l.length - j) + (s.length - i) <= 1;
}

export type MatchedBy =
  | 'AIRPORT_IATA'
  | 'CITY_CODE'
  | 'AMBIGUOUS_CODE'
  | 'CITY_EXACT'
  | 'CITY_PREFIX'
  | 'CITY_CONTAINS'
  | 'AIRPORT_NAME'
  | 'COUNTRY'
  | 'FUZZY';

export interface CitySearchResult {
  cityId: string;
  cityNameZh: string;
  cityNameEn: string;
  countryCode: string;
  metroCode: string | null;
  matchedBy: MatchedBy;
  matchedAirportIata: string | null;
  score: number;
  airports: AirportEntry[];
}

export interface CitySearchOptions {
  continent?: string;
  country?: string;
  limit?: number;
}

/** 模糊检索：中/英/拼音/别名/城市码/机场码/机场名/国家名 + 编辑距离；返回命中原因与分数。 */
export function searchCities(qRaw: string, opts: CitySearchOptions = {}): CitySearchResult[] {
  const q = (qRaw || '').trim();
  if (!q) return [];
  const nq = normalize(q);
  const upper = q.toUpperCase();
  const hasCjk = CJK_RE.test(q);
  const limit = Math.min(opts.limit ?? 20, 50);

  // 拉丁查询至少 2 字符才显示模糊结果（三字 IATA 精确除外）
  const isIataQuery = /^[A-Z]{3}$/.test(upper);
  if (!hasCjk && nq.length < 2 && !isIataQuery) return [];

  const popularRank = new Map<string, number>(POPULAR_CITY_IDS.map((id, i) => [id, i]));
  const results: CitySearchResult[] = [];

  for (const city of CITIES) {
    if (opts.continent && city.continentCode !== opts.continent) continue;
    if (opts.country && city.countryCode !== opts.country) continue;

    let score = 0;
    let matchedBy: MatchedBy | null = null;
    let matchedAirport: string | null = null;

    const iataHit = city.airports.find((a) => a.iata === upper);
    const metroHit = city.metroCode === upper;

    if (iataHit && metroHit) {
      if (city.airports.length === 1) {
        // 单机场城市同码（SGN/SIN）：消歧无意义，直接机场级命中
        score = 1000;
        matchedBy = 'AIRPORT_IATA';
        matchedAirport = iataHit.iata;
      } else {
        // 城市码与机场码同码（SHA/KUL/BKK）：不替用户猜，返回消歧结果
        score = 990;
        matchedBy = 'AMBIGUOUS_CODE';
        matchedAirport = iataHit.iata;
      }
    } else if (iataHit) {
      score = 1000;
      matchedBy = 'AIRPORT_IATA';
      matchedAirport = iataHit.iata;
    } else if (metroHit) {
      score = 980;
      matchedBy = 'CITY_CODE';
    }

    if (!matchedBy && nq) {
      const names = [normalize(city.nameZh), normalize(city.nameEn), ...city.searchAliases.map(normalize)];
      if (names.some((n) => n && n === nq)) {
        score = 950;
        matchedBy = 'CITY_EXACT';
      } else if (names.some((n) => n && n.startsWith(nq))) {
        score = 850;
        matchedBy = 'CITY_PREFIX';
      } else if (names.some((n) => n && n.includes(nq))) {
        score = 760;
        matchedBy = 'CITY_CONTAINS';
      } else {
        const ap = city.airports.find((a) => {
          const az = normalize(a.nameZh);
          const ae = normalize(a.nameEn);
          return az.startsWith(nq) || ae.startsWith(nq) || az.includes(nq) || ae.includes(nq);
        });
        if (ap) {
          score = 700;
          matchedBy = 'AIRPORT_NAME';
          matchedAirport = ap.iata;
        } else {
          const country = countryByCode.get(city.countryCode);
          if (country && (normalize(country.nameZh).includes(nq) || normalize(country.nameEn).includes(nq))) {
            score = 620;
            matchedBy = 'COUNTRY';
          } else if (!hasCjk && nq.length >= 4 && names.some((n) => n && lev1(nq, n))) {
            score = 520;
            matchedBy = 'FUZZY';
          }
        }
      }
    }

    if (!score || !matchedBy) continue;
    // 机场名独立词命中（pudong/浦东/hongqiao…）且不是城市名前缀：补充 matchedAirport，
    // 供 UI 展示“匹配机场”并直接形成机场级选择（§4.3）。
    if (!matchedAirport && nq) {
      const cityPrefix = normalize(city.nameEn).startsWith(nq) || normalize(city.nameZh).startsWith(nq);
      if (!cityPrefix) {
        const ap = city.airports.find((a) => {
          const tokens = a.nameEn.toLowerCase().split(/[^a-z]+/).filter((t) => t.length >= 2);
          return tokens.includes(nq) || (hasCjk && a.nameZh.includes(q.trim()) && q.trim().length >= 2);
        });
        if (ap) matchedAirport = ap.iata;
      }
    }
    // 热门最多加 40，且不得超过精确 IATA（1000）
    const rank = popularRank.get(city.cityId);
    if (rank !== undefined && score < 1000) score += Math.min(40, 990 - score);
    results.push({
      cityId: city.cityId,
      cityNameZh: city.nameZh,
      cityNameEn: city.nameEn,
      countryCode: city.countryCode,
      metroCode: city.metroCode,
      matchedBy,
      matchedAirportIata: matchedAirport,
      score,
      airports: city.airports,
    });
  }

  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const pa = popularRank.get(a.cityId) ?? 999;
    const pb = popularRank.get(b.cityId) ?? 999;
    if (pa !== pb) return pa - pb;
    return a.cityNameEn.localeCompare(b.cityNameEn);
  });
  return results.slice(0, limit);
}

// ---------- Search Request V2 选择解析（12 号方案 §7.2，后端权威校验） ----------

export interface SelectionInput {
  cityId: string;
  mode: 'ALL_AIRPORTS' | 'AIRPORT';
  airportIata?: string | null;
}

export type SelectionError = 'INVALID_CITY' | 'INVALID_AIRPORT' | 'MODE_MISMATCH';

export interface ResolvedSelection {
  city: CatalogCity;
  mode: 'ALL_AIRPORTS' | 'AIRPORT';
  airportIata: string | null;
  /** 主搜索码：AIRPORT→指定机场；ALL_AIRPORTS→城市码（无则默认机场）。 */
  primaryCode: string;
  /** ALL_AIRPORTS 且多机场时的受控展开列表（≤3）。 */
  expansionCodes: string[];
}

export function resolveSelection(sel: SelectionInput): { ok: true; value: ResolvedSelection } | { ok: false; error: SelectionError } {
  const city = cityOf(sel?.cityId);
  if (!city) return { ok: false, error: 'INVALID_CITY' };
  if (sel.mode === 'AIRPORT') {
    const iata = (sel.airportIata || '').toUpperCase();
    if (!iata) return { ok: false, error: 'MODE_MISMATCH' };
    if (!city.airports.some((a) => a.iata === iata)) return { ok: false, error: 'INVALID_AIRPORT' };
    return { ok: true, value: { city, mode: 'AIRPORT', airportIata: iata, primaryCode: iata, expansionCodes: [iata] } };
  }
  if (sel.mode !== 'ALL_AIRPORTS') return { ok: false, error: 'MODE_MISMATCH' };
  if (sel.airportIata) return { ok: false, error: 'MODE_MISMATCH' };
  const expansion = city.airports.slice(0, 3).map((a) => a.iata);
  const primary = city.metroCode ?? city.defaultAirportIata;
  return { ok: true, value: { city, mode: 'ALL_AIRPORTS', airportIata: null, primaryCode: primary, expansionCodes: expansion } };
}

// ---------- 本地城市体验包（MVP 不接酒店库存，均为人工维护建议）。中英双语，按请求语言返回。 ----------
export const CITY_PACKS: Record<
  string,
  {
    attractions: string[];
    areas: string[];
    tips: string[];
    airportToCityZh: string;
    attractionsEn: string[];
    areasEn: string[];
    tipsEn: string[];
    airportToCityEn: string;
    suggestedDays: number;
  }
> = {
  'my-kuala-lumpur': {
    attractions: ['双子塔 KLCC', '茨厂街', '黑风洞', '独立广场', '中央艺术坊'],
    areas: ['KLCC', '武吉免登', '茨厂街（唐人街）', '吉隆坡老城'],
    tips: ['多数商场营业至 22:00', '周五部分场所礼拜时段调整', '建议出行前复核营业时间'],
    airportToCityZh: 'KLIA Ekspres 机场快线约 28 分钟直达 KL Sentral',
    attractionsEn: ['Petronas Twin Towers (KLCC)', 'Petaling Street (Chinatown)', 'Batu Caves', 'Merdeka Square', 'Central Market'],
    areasEn: ['KLCC', 'Bukit Bintang', 'Petaling Street (Chinatown)', 'Old Kuala Lumpur'],
    tipsEn: ['Most malls open until 22:00', 'Some venues adjust hours for Friday prayers', 'Re-check opening hours before you go'],
    airportToCityEn: 'KLIA Ekspres takes about 28 minutes non-stop to KL Sentral',
    suggestedDays: 3,
  },
  'th-bangkok': {
    attractions: ['大皇宫', '卧佛寺', '暹罗商圈', '乍都乍周末市场', '湄南河夜游'],
    areas: ['暹罗', '素坤逸', '老城区', '河畔'],
    tips: ['大皇宫需着装过膝', '高峰时段堵车明显，预留时间', '建议出行前复核营业时间'],
    airportToCityZh: '素万那普机场快线约 30 分钟到帕亚泰站',
    attractionsEn: ['Grand Palace', 'Wat Pho', 'Siam shopping district', 'Chatuchak Weekend Market', 'Chao Phraya evening cruise'],
    areasEn: ['Siam', 'Sukhumvit', 'Old City', 'Riverside'],
    tipsEn: ['The Grand Palace requires attire below the knee', 'Rush-hour traffic is heavy — allow buffer time', 'Re-check opening hours before you go'],
    airportToCityEn: 'Suvarnabhumi Airport Rail Link takes about 30 minutes to Phaya Thai',
    suggestedDays: 3,
  },
  'hk-hong-kong': {
    attractions: ['维多利亚港', '太平山顶', '庙街夜市', '星光大道'],
    areas: ['尖沙咀', '中环', '旺角'],
    tips: ['机场快线约 24 分钟到中环', '过境需真实续程凭证', '建议出行前复核营业时间'],
    airportToCityZh: '机场快线约 24 分钟直达中环',
    attractionsEn: ['Victoria Harbour', 'Victoria Peak', 'Temple Street Night Market', 'Avenue of Stars'],
    areasEn: ['Tsim Sha Tsui', 'Central', 'Mong Kok'],
    tipsEn: ['Airport Express takes about 24 minutes to Central', 'Transit requires genuine onward proof', 'Re-check opening hours before you go'],
    airportToCityEn: 'Airport Express takes about 24 minutes non-stop to Central',
    suggestedDays: 2,
  },
  'vn-ho-chi-minh-city': {
    attractions: ['范五老街', '统一宫', '滨城市场', '西贡圣母大教堂'],
    areas: ['第一郡', '第三郡'],
    tips: ['电子签需提前申请', '摩托车多，过街注意', '建议出行前复核营业时间'],
    airportToCityZh: '出租车约 20 分钟到第一郡',
    attractionsEn: ['Bui Vien Walking Street', 'Reunification Palace', 'Ben Thanh Market', 'Saigon Notre-Dame Basilica'],
    areasEn: ['District 1', 'District 3'],
    tipsEn: ['E-visa must be applied for in advance', 'Watch for motorbikes when crossing streets', 'Re-check opening hours before you go'],
    airportToCityEn: 'About 20 minutes by taxi to District 1',
    suggestedDays: 2,
  },
  'vn-hanoi': {
    attractions: ['还剑湖', '老城区三十六街', '胡志明纪念堂', '火车街'],
    areas: ['还剑区', '巴亭区'],
    tips: ['电子签需提前申请', '纪念堂周一周五闭馆', '建议出行前复核营业时间'],
    airportToCityZh: '86 路机场巴士约 45 分钟到还剑湖',
    attractionsEn: ['Hoan Kiem Lake', 'Old Quarter (36 Streets)', 'Ho Chi Minh Mausoleum', 'Train Street'],
    areasEn: ['Hoan Kiem District', 'Ba Dinh District'],
    tipsEn: ['E-visa must be applied for in advance', 'The Mausoleum is closed on Mondays and Fridays', 'Re-check opening hours before you go'],
    airportToCityEn: 'Bus route 86 takes about 45 minutes to Hoan Kiem Lake',
    suggestedDays: 2,
  },
};
