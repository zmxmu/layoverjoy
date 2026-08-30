import { describe, expect, it } from 'vitest';
import { candidateHubs, cityOf, rankHubsForRoute } from '../src/airports/catalog';

/**
 * 全球中转候选排序验收：
 * - 候选不再固化为亚洲热门三城，按本次航线绕飞度动态排序；
 * - 出发地/目的地所在国与城市本身必须排除；
 * - 短途航线退回热门优先；坐标缺失时保持旧行为兼容（candidateHubs 不变）。
 */

function ids(hubs: { cityId: string }[]): string[] {
  return hubs.map((h) => h.cityId);
}

describe('rankHubsForRoute', () => {
  it('新加坡→上海：候选数放开到上限，且不再固定为新加坡/吉隆坡/曼谷前三', () => {
    const hubs = rankHubsForRoute('sg-singapore', 'cn-shanghai', ['SG', 'CN'], 8);
    expect(hubs.length).toBe(8);
    const top3 = ids(hubs).slice(0, 3);
    expect(top3).not.toEqual(['my-kuala-lumpur', 'th-bangkok', 'hk-hong-kong']);
    // 出发地/目的地所在国与城市本身不得成为中转候选
    for (const h of hubs) {
      expect(['SG', 'CN']).not.toContain(h.countryCode);
    }
    expect(ids(hubs)).not.toContain('sg-singapore');
    expect(ids(hubs)).not.toContain('cn-shanghai');
  });

  it('长航线按绕飞度排序：顺路城市应排在大幅绕行的城市之前', () => {
    // 伦敦→悉尼：亚洲/中东方向城市明显比横跨大西洋方向顺路（纽约绕飞约 4500km+）
    const hubs = rankHubsForRoute('gb-london', 'au-sydney', ['GB', 'AU'], 30);
    const ranked = ids(hubs);
    const indexOf = (id: string) => ranked.indexOf(id);
    const doha = indexOf('qa-doha');
    const tokyo = indexOf('jp-tokyo');
    const newYork = indexOf('us-new-york');
    expect(doha).toBeGreaterThanOrEqual(0);
    expect(tokyo).toBeGreaterThanOrEqual(0);
    if (newYork >= 0) {
      expect(doha).toBeLessThan(newYork);
      expect(tokyo).toBeLessThan(newYork);
    }
  });

  it('短途航线（直达<600km）退回热门优先，不把无关远城排前', () => {
    // 新加坡→吉隆坡直达约 300km：热门城市应优先于按绕飞度算出的远城
    const hubs = rankHubsForRoute('sg-singapore', 'my-kuala-lumpur', ['SG', 'MY'], 4);
    const top = ids(hubs)[0];
    expect(['th-bangkok', 'hk-hong-kong', 'jp-tokyo', 'kr-seoul', 'tw-taipei']).toContain(top);
  });

  it('近端点城市降权：离任一端点不足全程 10% 的城市排在真正居中的候选之后', () => {
    // 伦敦→悉尼：法兰克福距伦敦仅约 650km（全程约 17000km），不是有意义的中转停留；
    // 新加坡处于航线中段，应排在法兰克福之前。
    const hubs = rankHubsForRoute('gb-london', 'au-sydney', ['GB', 'AU'], 16);
    const ranked = ids(hubs);
    const singapore = ranked.indexOf('sg-singapore');
    const frankfurt = ranked.indexOf('de-frankfurt');
    expect(singapore).toBeGreaterThanOrEqual(0);
    if (frankfurt >= 0) expect(singapore).toBeLessThan(frankfurt);
  });

  it('坐标缺失时回退：候选全部可解析且不重复', () => {
    const hubs = rankHubsForRoute(null, null, [], 8);
    expect(hubs.length).toBe(8);
    expect(new Set(ids(hubs)).size).toBe(8);
    for (const h of hubs) {
      expect(cityOf(h.cityId)).not.toBeNull();
    }
  });

  it('旧接口 candidateHubs 行为保持兼容（planning-jobs 仍在使用）', () => {
    const hubs = candidateHubs([], 3);
    expect(ids(hubs)).toEqual(['sg-singapore', 'my-kuala-lumpur', 'th-bangkok']);
    const excluded = candidateHubs(['SG', 'MY', 'TH'], 3);
    expect(ids(excluded)).not.toContain('sg-singapore');
  });
});
