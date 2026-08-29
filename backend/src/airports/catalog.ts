/**
 * 机场与城市目录。数据源：qoder-input/fixtures/airports/hub-catalog.json。
 * 规则：KLIA 与 KLIA2 共用 KUL；曼谷含 BKK/DMK；上海含 PVG/SHA；雅加达用城市码 JKT。
 * 未列入目录的自由文本城市返回 UNSUPPORTED_AIRPORT。
 */

export interface AirportEntry {
  iata: string;
  nameZh: string;
  nameEn: string;
}

export interface CityEntry {
  cityId: string;
  cityNameZh: string;
  cityNameEn: string;
  countryCode: string;
  timezone: string;
  metroCode: string | null;
  airports: AirportEntry[];
}

import catalogJson from './hub-catalog.json';

export const HUB_CATALOG: CityEntry[] = (catalogJson as any).cities as CityEntry[];

export interface ResolvedLocation {
  cityId: string;
  cityNameZh: string;
  cityNameEn: string;
  countryCode: string;
  searchCode: string; // 城市码或机场码
  searchCodeType: 'METRO' | 'AIRPORT';
  airports: AirportEntry[];
}

/** 按中文名、英文名、cityId、metroCode、机场 IATA 解析位置。 */
export function resolveLocation(inputRaw: string): ResolvedLocation | null {
  const input = (inputRaw || '').trim().toUpperCase();
  if (!input) return null;
  const lower = (inputRaw || '').trim().toLowerCase();

  for (const city of HUB_CATALOG) {
    const hit =
      lower === city.cityId.toLowerCase() ||
      inputRaw.trim() === city.cityNameZh ||
      city.cityNameEn.toUpperCase() === input ||
      (city.metroCode && city.metroCode === input) ||
      city.airports.some((a) => a.iata === input);
    if (hit) {
      return {
        cityId: city.cityId,
        cityNameZh: city.cityNameZh,
        cityNameEn: city.cityNameEn,
        countryCode: city.countryCode,
        searchCode: city.metroCode ?? city.airports[0].iata,
        searchCodeType: city.metroCode ? 'METRO' : 'AIRPORT',
        airports: city.airports,
      };
    }
  }
  return null;
}

/** 中转候选城市集合（不含出发地与目的地所在城市）。 */
export function candidateHubs(excludeCountryCodes: string[], limit = 8): CityEntry[] {
  const order = [
    'my-kuala-lumpur',
    'th-bangkok',
    'hk-hong-kong',
    'vn-ho-chi-minh-city',
    'vn-hanoi',
    'my-penang',
    'vn-da-nang',
    'id-jakarta',
    'id-bali',
    'id-batam',
    'ph-manila',
    'ph-cebu',
  ];
  const picked: CityEntry[] = [];
  for (const id of order) {
    const city = HUB_CATALOG.find((c) => c.cityId === id);
    if (!city) continue;
    if (excludeCountryCodes.includes(city.countryCode)) continue;
    picked.push(city);
    if (picked.length >= limit) break;
  }
  return picked;
}

/** 本地城市体验包（MVP 不接酒店库存，均为人工维护建议）。中英双语，按请求语言返回。 */
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
