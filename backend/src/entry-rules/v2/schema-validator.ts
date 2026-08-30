/**
 * JSON Schema 结构化校验器（ER-01 / T-23）。
 * 不引入外部 ajv 依赖：按 layoverjoy-entry-rule.schema.json 的 required/enum/pattern/
 * 表达式操作符白名单做递归校验。任何未知操作符或缺失必填字段都会导致导入失败（不能部分激活）。
 */

import { RuleExpression } from './types';

const COUNTRY_RE = /^[A-Z]{2}$/;
const ID_RE = /^[A-Z0-9_-]+$/;
const GROUP_RE = /^[A-Z0-9_]+$/;
const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T/;

const CATEGORY_ENUM = [
  'MUTUAL_VISA_FREE', 'UNILATERAL_VISA_FREE', 'VISA_ON_ARRIVAL', 'E_VISA',
  'LANDSIDE_TRANSIT_PERMISSION', 'TRANSIT_TOUR_PROGRAM', 'CONDITIONAL_VISA_EXEMPTION',
  'VISA_REQUIRED', 'REGIONAL_VISA_FREE',
];
const RULE_STATUS_ENUM = ['ACTIVE', 'TEMPORARY_ACTIVE', 'REVIEW_REQUIRED', 'EXPIRED', 'SUPERSEDED', 'NEGATIVE'];
const DECISION_ENUM = ['ELIGIBLE', 'CONDITIONALLY_ELIGIBLE', 'NEEDS_INFO', 'NEEDS_REVIEW', 'INELIGIBLE'];
const TIER_ENUM = ['A_DESTINATION_AUTHORITY', 'B_CHINESE_MFA', 'C_OFFICIAL_AGGREGATE'];
const SOURCE_STATUS_ENUM = ['CURRENT', 'STALE', 'SUPERSEDED', 'PARTIAL'];
const OP_ENUM = [
  'EQ', 'NEQ', 'IN', 'NOT_IN', 'EXISTS', 'NOT_EXISTS', 'GTE', 'LTE',
  'IS_TRUE', 'IS_FALSE', 'VALID_FOR_DAYS', 'HAS_VALID_DOCUMENT', 'ROUTE_MATCHES', 'DATE_WITHIN_RULE_VALIDITY',
];

export function validateDataset(ds: any): string[] {
  const errors: string[] = [];
  const req = (obj: any, keys: string[], path: string) => {
    for (const k of keys) if (obj == null || obj[k] === undefined) errors.push(`${path}: missing required '${k}'`);
  };

  if (typeof ds !== 'object' || ds === null) return ['dataset: not an object'];
  req(ds, ['schemaVersion', 'dataset', 'subject', 'policy', 'referenceGroups', 'sourceDocuments', 'verifiedRules', 'coverageInventories'], 'dataset');
  if (!SEMVER_RE.test(ds.schemaVersion ?? '')) errors.push('schemaVersion: must be semver');

  req(ds.dataset, ['datasetId', 'nameZh', 'asOf', 'generatedFor', 'legalNoticeZh', 'checksum'], 'dataset.dataset');
  if (!DATE_RE.test(ds.dataset?.asOf ?? '')) errors.push('dataset.asOf: must be date');

  req(ds.subject, ['nationalityCountryCode', 'passportIssuingCountryCode', 'passportType'], 'subject');
  if (!COUNTRY_RE.test(ds.subject?.nationalityCountryCode ?? '')) errors.push('subject.nationalityCountryCode: bad pattern');
  if (ds.subject?.passportType !== 'ORDINARY') errors.push('subject.passportType: must be ORDINARY');

  req(ds.policy, ['defaultSearchDecision', 'defaultBookingDecision', 'borderAuthorityIsFinal', 'llmMayDecideEligibility', 'sourceTierReviewDays', 'temporaryRuleSafetyHours'], 'policy');
  if (!DECISION_ENUM.includes(ds.policy?.defaultSearchDecision)) errors.push('policy.defaultSearchDecision: bad enum');
  if (ds.policy?.borderAuthorityIsFinal !== true) errors.push('policy.borderAuthorityIsFinal: must be true');
  if (ds.policy?.llmMayDecideEligibility !== false) errors.push('policy.llmMayDecideEligibility: must be false');
  req(ds.policy?.sourceTierReviewDays, ['A_DESTINATION_AUTHORITY', 'B_CHINESE_MFA', 'C_OFFICIAL_AGGREGATE'], 'policy.sourceTierReviewDays');

  for (const [i, g] of (ds.referenceGroups ?? []).entries()) {
    req(g, ['groupId', 'labelZh', 'memberType', 'members', 'asOf'], `referenceGroups[${i}]`);
    if (!GROUP_RE.test(g?.groupId ?? '')) errors.push(`referenceGroups[${i}].groupId: bad pattern`);
  }

  const sourceIds = new Set<string>();
  for (const [i, s] of (ds.sourceDocuments ?? []).entries()) {
    req(s, ['sourceId', 'authority', 'title', 'url', 'tier', 'language', 'lastCheckedAt', 'status', 'supportsAutoDecision'], `sourceDocuments[${i}]`);
    if (!ID_RE.test(s?.sourceId ?? '')) errors.push(`sourceDocuments[${i}].sourceId: bad pattern`);
    if (!TIER_ENUM.includes(s?.tier)) errors.push(`sourceDocuments[${i}].tier: bad enum`);
    if (!SOURCE_STATUS_ENUM.includes(s?.status)) errors.push(`sourceDocuments[${i}].status: bad enum`);
    if (!DATETIME_RE.test(s?.lastCheckedAt ?? '')) errors.push(`sourceDocuments[${i}].lastCheckedAt: must be date-time`);
    sourceIds.add(s?.sourceId);
  }

  const ruleIds = new Set<string>();
  for (const [i, r] of (ds.verifiedRules ?? []).entries()) {
    const p = `verifiedRules[${i}]`;
    req(r, ['ruleId', 'version', 'titleZh', 'destination', 'category', 'status', 'priority', 'validity', 'match', 'decision', 'requirements', 'warningsZh', 'sourceIds', 'review'], p);
    if (!ID_RE.test(r?.ruleId ?? '')) errors.push(`${p}.ruleId: bad pattern`);
    if (ruleIds.has(r?.ruleId)) errors.push(`${p}.ruleId: duplicate`);
    ruleIds.add(r?.ruleId);
    if (!CATEGORY_ENUM.includes(r?.category)) errors.push(`${p}.category: bad enum '${r?.category}'`);
    if (!RULE_STATUS_ENUM.includes(r?.status)) errors.push(`${p}.status: bad enum '${r?.status}'`);
    if (typeof r?.priority !== 'number' || r.priority < 0 || r.priority > 1000) errors.push(`${p}.priority: out of range`);
    if (!COUNTRY_RE.test(r?.destination?.countryCode ?? '')) errors.push(`${p}.destination.countryCode: bad pattern`);
    req(r?.destination, ['countryCode', 'displayNameZh', 'displayNameEn'], `${p}.destination`);
    req(r?.validity, ['effectiveFrom', 'effectiveTo'], `${p}.validity`);
    for (const [j, sid] of (r?.sourceIds ?? []).entries()) {
      if (!sourceIds.has(sid)) errors.push(`${p}.sourceIds[${j}]: unknown source '${sid}'`);
    }
    if (!Array.isArray(r?.sourceIds) || r.sourceIds.length < 1) errors.push(`${p}.sourceIds: minItems 1`);
    req(r?.review, ['verifiedAt', 'reviewBy', 'owner', 'changeTriggers'], `${p}.review`);
    req(r?.decision, ['search', 'booking', 'entryMode', 'maxStay', 'manualReviewRequired', 'explanationZh'], `${p}.decision`);
    if (!DECISION_ENUM.includes(r?.decision?.search)) errors.push(`${p}.decision.search: bad enum`);
    if (!DECISION_ENUM.includes(r?.decision?.booking)) errors.push(`${p}.decision.booking: bad enum`);
    validateExpression(r?.match, `${p}.match`, errors);
  }

  req(ds.coverageInventories, ['mutualOrdinaryPassport', 'legacyMfa2023'], 'coverageInventories');
  return errors;
}

/** 递归校验表达式；未知操作符直接报错（T-23：导入失败，不能部分激活）。 */
export function validateExpression(expr: any, path: string, errors: string[]): void {
  if (typeof expr !== 'object' || expr === null) {
    errors.push(`${path}: expression must be object`);
    return;
  }
  const keys = Object.keys(expr);
  if (keys.length === 1 && keys[0] === 'all') {
    if (!Array.isArray(expr.all) || expr.all.length < 1) errors.push(`${path}.all: minItems 1`);
    (expr.all ?? []).forEach((e: RuleExpression, i: number) => validateExpression(e, `${path}.all[${i}]`, errors));
    return;
  }
  if (keys.length === 1 && keys[0] === 'any') {
    if (!Array.isArray(expr.any) || expr.any.length < 1) errors.push(`${path}.any: minItems 1`);
    (expr.any ?? []).forEach((e: RuleExpression, i: number) => validateExpression(e, `${path}.any[${i}]`, errors));
    return;
  }
  if (keys.length === 1 && keys[0] === 'not') {
    validateExpression(expr.not, `${path}.not`, errors);
    return;
  }
  if (typeof expr.fact === 'string' && expr.fact.length > 0 && typeof expr.op === 'string' && 'value' in expr) {
    if (!OP_ENUM.includes(expr.op)) errors.push(`${path}.op: unknown operator '${expr.op}'`);
    return;
  }
  errors.push(`${path}: expression does not match any/oneOf shape (keys: ${keys.join(',')})`);
}
