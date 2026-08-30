/**
 * requiredDocuments 统一契约测试：normalizeRequiredDocuments 对旧/新/混合/异常数据的归一化。
 */
import { describe, expect, it } from 'vitest';
import { normalizeRequiredDocuments, REQUIRED_DOC_I18N } from '../src/plans/plans.service';

describe('normalizeRequiredDocuments', () => {
  it('新版对象数组能够解析并保留字段', () => {
    const out = normalizeRequiredDocuments([
      { code: 'PASSPORT_VALID_6_MONTHS', mandatory: true, descriptionZh: '护照剩余有效期至少六个月', factPaths: ['traveler.passport.expiryDate'] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      code: 'PASSPORT_VALID_6_MONTHS',
      mandatory: true,
      descriptionZh: '护照剩余有效期至少六个月',
      factPaths: ['traveler.passport.expiryDate'],
    });
    expect(out[0].descriptionEn).toBe(REQUIRED_DOC_I18N.PASSPORT_VALID_6_MONTHS.en);
  });

  it('旧版字符串数组能够解析', () => {
    const out = normalizeRequiredDocuments(['CONFIRMED_ONWARD_TICKET', 'ACCOMMODATION_OR_ADDRESS']);
    expect(out).toHaveLength(2);
    expect(out[0].code).toBe('CONFIRMED_ONWARD_TICKET');
    expect(out[0].mandatory).toBe(true);
    expect(out[0].descriptionZh).toBe(REQUIRED_DOC_I18N.CONFIRMED_ONWARD_TICKET.zh);
    expect(out[0].factPaths).toEqual([]);
  });

  it('null 和空数组能够解析', () => {
    expect(normalizeRequiredDocuments(null)).toEqual([]);
    expect(normalizeRequiredDocuments(undefined)).toEqual([]);
    expect(normalizeRequiredDocuments([])).toEqual([]);
  });

  it('非数组输入归一为空数组', () => {
    expect(normalizeRequiredDocuments({ code: 'X' })).toEqual([]);
  });

  it('字符串和对象混合数组能够兼容', () => {
    const out = normalizeRequiredDocuments([
      'ONWARD_TICKET',
      { code: 'MDAC', mandatory: false },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].code).toBe('ONWARD_TICKET');
    expect(out[1].mandatory).toBe(false);
  });

  it('未知字段不会导致失败', () => {
    const out = normalizeRequiredDocuments([
      { code: 'SOME_NEW_CODE', mandatory: true, unknownField: { nested: true }, descriptionEn: 'Some new requirement' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('SOME_NEW_CODE');
    expect(out[0].descriptionEn).toBe('Some new requirement');
    expect(out[0].descriptionZh).toBeNull();
  });

  it('无效项目跳过且不影响其他项目', () => {
    const out = normalizeRequiredDocuments([42, null, '', { noCode: true }, 'SUFFICIENT_FUNDS']);
    expect(out).toHaveLength(1);
    expect(out[0].code).toBe('SUFFICIENT_FUNDS');
  });

  it('输出条目结构统一（code/mandatory/descriptionZh/descriptionEn/factPaths）', () => {
    for (const item of normalizeRequiredDocuments(['X_UNKNOWN', { code: 'Y' }])) {
      expect(Object.keys(item).sort()).toEqual(['code', 'descriptionEn', 'descriptionZh', 'factPaths', 'mandatory']);
    }
  });
});
