"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CITY_PACKS = exports.HUB_CATALOG = void 0;
exports.resolveLocation = resolveLocation;
exports.candidateHubs = candidateHubs;
const hub_catalog_json_1 = __importDefault(require("./hub-catalog.json"));
exports.HUB_CATALOG = hub_catalog_json_1.default.cities;
function resolveLocation(inputRaw) {
    const input = (inputRaw || '').trim().toUpperCase();
    if (!input)
        return null;
    const lower = (inputRaw || '').trim().toLowerCase();
    for (const city of exports.HUB_CATALOG) {
        const hit = lower === city.cityId.toLowerCase() ||
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
function candidateHubs(excludeCountryCodes, limit = 8) {
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
    const picked = [];
    for (const id of order) {
        const city = exports.HUB_CATALOG.find((c) => c.cityId === id);
        if (!city)
            continue;
        if (excludeCountryCodes.includes(city.countryCode))
            continue;
        picked.push(city);
        if (picked.length >= limit)
            break;
    }
    return picked;
}
exports.CITY_PACKS = {
    'my-kuala-lumpur': {
        attractions: ['双子塔 KLCC', '茨厂街', '黑风洞', '独立广场', '中央艺术坊'],
        areas: ['KLCC', '武吉免登', '茨厂街（唐人街）', '吉隆坡老城'],
        tips: ['多数商场营业至 22:00', '周五部分场所礼拜时段调整', '建议出行前复核营业时间'],
        airportToCityZh: 'KLIA Ekspres 机场快线约 28 分钟直达 KL Sentral',
        suggestedDays: 3,
    },
    'th-bangkok': {
        attractions: ['大皇宫', '卧佛寺', '暹罗商圈', '乍都乍周末市场', '湄南河夜游'],
        areas: ['暹罗', '素坤逸', '老城区', '河畔'],
        tips: ['大皇宫需着装过膝', '高峰时段堵车明显，预留时间', '建议出行前复核营业时间'],
        airportToCityZh: '素万那普机场快线约 30 分钟到帕亚泰站',
        suggestedDays: 3,
    },
    'hk-hong-kong': {
        attractions: ['维多利亚港', '太平山顶', '庙街夜市', '星光大道'],
        areas: ['尖沙咀', '中环', '旺角'],
        tips: ['机场快线约 24 分钟到中环', '过境需真实续程凭证', '建议出行前复核营业时间'],
        airportToCityZh: '机场快线约 24 分钟直达中环',
        suggestedDays: 2,
    },
    'vn-ho-chi-minh-city': {
        attractions: ['范五老街', '统一宫', '滨城市场', '西贡圣母大教堂'],
        areas: ['第一郡', '第三郡'],
        tips: ['电子签需提前申请', '摩托车多，过街注意', '建议出行前复核营业时间'],
        airportToCityZh: '出租车约 20 分钟到第一郡',
        suggestedDays: 2,
    },
    'vn-hanoi': {
        attractions: ['还剑湖', '老城区三十六街', '胡志明纪念堂', '火车街'],
        areas: ['还剑区', '巴亭区'],
        tips: ['电子签需提前申请', '纪念堂周一周五闭馆', '建议出行前复核营业时间'],
        airportToCityZh: '86 路机场巴士约 45 分钟到还剑湖',
        suggestedDays: 2,
    },
};
