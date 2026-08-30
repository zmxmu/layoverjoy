#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""给 shared/catalog 城市机场目录注入经纬度与 atlasSearchEnabled，schemaVersion 2.0.0 → 2.1.0。

单一事实源是 shared/catalog/city-airport-catalog.zh-en.json；本脚本只改它，
改完必须跑 scripts/sync-catalog.sh 同步 Android assets 与后端副本。

坐标口径：城市中心 + 机场基准点（ARP）近似值，精度到 0.0001°（约 11 米），
用于 120/250 公里半径的本地“附近机场”匹配，误差远小于判定阈值。
"""
import json
import pathlib
import sys

SRC = pathlib.Path(__file__).resolve().parent.parent / 'shared/catalog/city-airport-catalog.zh-en.json'

# cityId -> (latitude, longitude) 城市中心
CITY = {
    'sg-singapore': (1.3521, 103.8198),
    'my-kuala-lumpur': (3.1390, 101.6869),
    'my-penang': (5.4141, 100.3288),
    'th-bangkok': (13.7563, 100.5018),
    'th-phuket': (7.8804, 98.3923),
    'hk-hong-kong': (22.3193, 114.1694),
    'mo-macau': (22.1987, 113.5439),
    'cn-beijing': (39.9042, 116.4074),
    'cn-shanghai': (31.2304, 121.4737),
    'cn-guangzhou': (23.1291, 113.2644),
    'cn-shenzhen': (22.5431, 114.0579),
    'cn-chengdu': (30.5728, 104.0668),
    'cn-xiamen': (24.4798, 118.0894),
    'jp-tokyo': (35.6762, 139.6503),
    'jp-osaka': (34.6937, 135.5023),
    'kr-seoul': (37.5665, 126.9780),
    'tw-taipei': (25.0330, 121.5654),
    'vn-ho-chi-minh-city': (10.8231, 106.6297),
    'vn-hanoi': (21.0278, 105.8342),
    'vn-da-nang': (16.0544, 108.2022),
    'id-jakarta': (-6.2088, 106.8456),
    'id-bali': (-8.6705, 115.2126),
    'ph-manila': (14.5995, 120.9842),
    'ph-cebu': (10.3157, 123.8854),
    'ae-dubai': (25.2048, 55.2708),
    'ae-abu-dhabi': (24.4539, 54.3773),
    'qa-doha': (25.2854, 51.5310),
    'tr-istanbul': (41.0082, 28.9784),
    'gb-london': (51.5074, -0.1278),
    'fr-paris': (48.8566, 2.3522),
    'nl-amsterdam': (52.3676, 4.9041),
    'de-frankfurt': (50.1109, 8.6821),
    'de-munich': (48.1351, 11.5820),
    'it-rome': (41.9028, 12.4964),
    'it-milan': (45.4642, 9.1900),
    'es-madrid': (40.4168, -3.7038),
    'es-barcelona': (41.3851, 2.1734),
    'ch-zurich': (47.3769, 8.5417),
    'at-vienna': (48.2082, 16.3738),
    'pt-lisbon': (38.7223, -9.1393),
    'us-new-york': (40.7128, -74.0060),
    'us-los-angeles': (34.0522, -118.2437),
    'us-san-francisco': (37.7749, -122.4194),
    'us-chicago': (41.8781, -87.6298),
    'us-seattle': (47.6062, -122.3321),
    'us-honolulu': (21.3069, -157.8583),
    'ca-toronto': (43.6532, -79.3832),
    'ca-vancouver': (49.2827, -123.1207),
    'mx-mexico-city': (19.4326, -99.1332),
    'mx-cancun': (21.1619, -86.8515),
    'au-sydney': (-33.8688, 151.2093),
    'au-melbourne': (-37.8136, 144.9631),
    'au-brisbane': (-27.4698, 153.0251),
    'au-perth': (-31.9505, 115.8605),
    'nz-auckland': (-36.8485, 174.7633),
    'za-johannesburg': (-26.2041, 28.0473),
    'za-cape-town': (-33.9249, 18.4241),
    'eg-cairo': (30.0444, 31.2357),
    'ma-casablanca': (33.5731, -7.5898),
    'et-addis-ababa': (9.0192, 38.7525),
    'ke-nairobi': (-1.2864, 36.8172),
    'br-sao-paulo': (-23.5505, -46.6333),
    'br-rio-de-janeiro': (-22.9068, -43.1729),
    'ar-buenos-aires': (-34.6037, -58.3816),
    'cl-santiago': (-33.4489, -70.6693),
    'pe-lima': (-12.0464, -77.0428),
}

# IATA -> (latitude, longitude) 机场基准点
AIRPORT = {
    'SIN': (1.3644, 103.9915),
    'KUL': (2.7456, 101.7099), 'SZB': (3.1297, 101.5520),
    'PEN': (5.2971, 100.2769),
    'BKK': (13.6900, 100.7501), 'DMK': (13.9125, 100.6067),
    'HKT': (8.1132, 98.3068),
    'HKG': (22.3080, 113.9185),
    'MFM': (22.1496, 113.5912),
    'PEK': (40.0799, 116.6031), 'PKX': (39.5090, 116.4106),
    'PVG': (31.1443, 121.8083), 'SHA': (31.1979, 121.3363),
    'CAN': (23.3924, 113.2988),
    'SZX': (22.6393, 113.8108),
    'TFU': (30.3125, 104.4413), 'CTU': (30.5785, 103.9474),
    'XMN': (24.5440, 118.1277),
    'HND': (35.5533, 139.7811), 'NRT': (35.7720, 140.3929),
    'KIX': (34.4342, 135.2440), 'ITM': (34.7852, 135.4682),
    'ICN': (37.4602, 126.4407), 'GMP': (37.5596, 126.8004),
    'TPE': (25.0821, 121.2341), 'TSA': (25.0676, 121.5526),
    'SGN': (10.8188, 106.6520),
    'HAN': (21.2222, 105.8000),
    'DAD': (16.0436, 108.1996),
    'CGK': (-6.1256, 106.6538), 'HLP': (-6.2236, 106.8940),
    'DPS': (-8.7481, 115.1672),
    'MNL': (14.5086, 121.0199),
    'CEB': (10.3075, 123.9794),
    'DXB': (25.2532, 55.3657), 'DWC': (24.8964, 55.1614),
    'AUH': (24.4330, 54.6511),
    'DOH': (25.2731, 51.6080),
    'IST': (41.2753, 28.7519), 'SAW': (40.8985, 29.3092),
    'LHR': (51.4700, -0.4543), 'LGW': (51.1537, -0.1821),
    'LCY': (51.5053, 0.0235), 'STN': (51.8850, 0.2350),
    'CDG': (49.0097, 2.5479), 'ORY': (48.7239, 2.3796),
    'AMS': (52.3105, 4.7683),
    'FRA': (50.0374, 8.5622),
    'MUC': (48.3538, 11.7861),
    'FCO': (41.8015, 12.2519), 'CIA': (41.7994, 12.5949),
    'MXP': (45.6306, 8.7281), 'LIN': (45.4451, 9.2567), 'BGY': (45.6739, 9.7041),
    'MAD': (40.4719, -3.5626),
    'BCN': (41.2971, 2.0785),
    'ZRH': (47.4596, 8.5516),
    'VIE': (48.1103, 16.5697),
    'LIS': (38.7742, -9.1342),
    'JFK': (40.6413, -73.7781), 'EWR': (40.6895, -74.1745), 'LGA': (40.7769, -73.8740),
    'LAX': (33.9416, -118.4085),
    'SFO': (37.6213, -122.3790),
    'ORD': (41.9742, -87.9073), 'MDW': (41.7868, -87.7522),
    'SEA': (47.4502, -122.3088),
    'HNL': (21.3206, -157.9242),
    'YYZ': (43.6777, -79.6248), 'YTZ': (43.6275, -79.3962),
    'YVR': (49.1965, -123.1798),
    'MEX': (19.4363, -99.0721),
    'CUN': (21.0365, -86.8771),
    'SYD': (-33.9399, 151.1753),
    'MEL': (-37.6690, 144.8410),
    'BNE': (-27.3897, 153.1261),
    'PER': (-31.9403, 115.9669),
    'AKL': (-37.0081, 174.7917),
    'JNB': (-26.1392, 28.2460),
    'CPT': (-33.9676, 18.6009),
    'CAI': (30.1219, 31.4056),
    'CMN': (33.5678, -7.6564),
    'ADD': (8.9779, 38.7993),
    'NBO': (-1.3192, 36.9278),
    'GRU': (-23.4356, -46.4731), 'CGH': (-23.6266, -46.6555),
    'GIG': (-22.8099, -43.2506), 'SDU': (-22.9104, -43.1631),
    'EZE': (-34.8222, -58.5358), 'AEP': (-34.5592, -58.5376),
    'SCL': (-33.3930, -70.7858),
    'LIM': (-12.0219, -77.1143),
}


def enrich_airport(a):
    lat, lng = AIRPORT[a['iata']]
    out = dict(a)
    out['latitude'] = lat
    out['longitude'] = lng
    # 目录即搜索能力边界：后端 airports.controller 只对目录外输入抛 UNSUPPORTED_AIRPORT，
    # 因此目录内机场一律可搜；该字段留给未来按机场粒度收紧，不作为“城市不支持”的展示依据。
    out['atlasSearchEnabled'] = True
    return out


def main():
    data = json.loads(SRC.read_text(encoding='utf-8'))
    cities = [c for ct in data['continents'] for ctry in ct['countries'] for c in ctry['cities']]
    missing_city = sorted({c['cityId'] for c in cities if c['cityId'] not in CITY})
    missing_ap = sorted({a['iata'] for c in cities for a in c['airports'] if a['iata'] not in AIRPORT})
    if missing_city or missing_ap:
        print('MISSING city:', missing_city, file=sys.stderr)
        print('MISSING airport:', missing_ap, file=sys.stderr)
        return 1
    used = {a['iata'] for c in cities for a in c['airports']}
    unused = sorted(set(AIRPORT) - used)
    if unused:
        print('UNUSED airport in table:', unused, file=sys.stderr)
        return 1

    n_airports = 0
    for ct in data['continents']:
        for ctry in ct['countries']:
            rebuilt = []
            for c in ctry['cities']:
                lat, lng = CITY[c['cityId']]
                newc = {}
                for k, v in c.items():
                    if k == 'airports':
                        newc['latitude'] = lat
                        newc['longitude'] = lng
                        newc['airports'] = [enrich_airport(a) for a in v]
                        n_airports += len(newc['airports'])
                    else:
                        newc[k] = v
                rebuilt.append(newc)
            ctry['cities'] = rebuilt

    data['schemaVersion'] = '2.1.0'
    data['updatedAt'] = '2026-08-30'
    data['geoNoteZh'] = '经纬度为城市中心与机场基准点的近似值，仅用于本机“附近机场”匹配与排序，不代表可售库存或入境资格。'
    data['geoNoteEn'] = 'Coordinates are approximate city-centre and airport reference points, used only for on-device nearby-airport matching; they never imply inventory or entry eligibility.'
    SRC.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'ok: {len(cities)} cities / {n_airports} airports enriched, schemaVersion 2.1.0')
    return 0


if __name__ == '__main__':
    sys.exit(main())
