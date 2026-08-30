/**
 * v2 入境规则引擎类型（13 号方案）。数据格式唯一事实源：
 * fixtures/entry-rules/layoverjoy-entry-rule.schema.json 与 cn-ordinary-passport-entry-rules.v2.json。
 */

export type TriVal = 'TRUE' | 'FALSE' | 'UNKNOWN';

export type DecisionCode = 'ELIGIBLE' | 'CONDITIONALLY_ELIGIBLE' | 'NEEDS_INFO' | 'NEEDS_REVIEW' | 'INELIGIBLE';

export interface RuleExpression {
  all?: RuleExpression[];
  any?: RuleExpression[];
  not?: RuleExpression;
  fact?: string;
  op?: string;
  value?: any;
}

export interface RuleDecision {
  search: DecisionCode;
  booking: DecisionCode;
  entryMode: string;
  maxStay: null | { value: number; unit: 'HOURS' | 'DAYS'; calculation: string; cumulativeLimit?: { days: number; windowDays: number } };
  manualReviewRequired: boolean;
  explanationZh: string;
}

export interface RuleRequirement {
  code: string;
  mandatory: boolean;
  descriptionZh: string;
  factPaths?: string[];
}

export interface RuleV2 {
  ruleId: string;
  version: number;
  titleZh: string;
  destination: { countryCode: string; jurisdictionCode?: string | null; displayNameZh: string; displayNameEn: string; regions?: string[]; entryPorts?: string[] };
  category: string;
  status: string;
  priority: number;
  validity: { effectiveFrom: string | null; effectiveTo: string | null };
  match: RuleExpression;
  decision: RuleDecision;
  requirements: RuleRequirement[];
  warningsZh: string[];
  sourceIds: string[];
  review: { verifiedAt: string; reviewBy: string; owner: string; changeTriggers: string[] };
}

export interface SourceDoc {
  sourceId: string;
  authority: string;
  title: string;
  url: string;
  tier: 'A_DESTINATION_AUTHORITY' | 'B_CHINESE_MFA' | 'C_OFFICIAL_AGGREGATE';
  language: string;
  sourcePublishedAt?: string | null;
  sourceUpdatedAt?: string | null;
  lastCheckedAt: string;
  status: 'CURRENT' | 'STALE' | 'SUPERSEDED' | 'PARTIAL';
  supportsAutoDecision: boolean;
  summaryZh?: string;
}

export interface ReferenceGroup {
  groupId: string;
  labelZh: string;
  memberType: string;
  members: string[];
  asOf: string;
  sourceIds?: string[];
}

export interface DatasetV2 {
  schemaVersion: string;
  dataset: { datasetId: string; nameZh: string; asOf: string; generatedFor: string; legalNoticeZh: string; checksum: string | null };
  subject: { nationalityCountryCode: string; passportIssuingCountryCode: string; passportType: string };
  policy: {
    defaultSearchDecision: DecisionCode;
    defaultBookingDecision: DecisionCode;
    borderAuthorityIsFinal: true;
    llmMayDecideEligibility: false;
    sourceTierReviewDays: { A_DESTINATION_AUTHORITY: number; B_CHINESE_MFA: number; C_OFFICIAL_AGGREGATE: number };
    temporaryRuleSafetyHours: number;
  };
  referenceGroups: ReferenceGroup[];
  sourceDocuments: SourceDoc[];
  verifiedRules: RuleV2[];
  coverageInventories: any;
}

/** 评估请求（/v1/entry-eligibility/assess 与内部编排共用）。 */
export interface AssessInput {
  userId: string;
  mode: 'SEARCH' | 'BOOKING';
  now?: string;
  itinerary: {
    purpose: string;
    segments: Array<{ from: string; to: string; departureAt: string; arrivalAt: string }>;
    stopover?: { country?: string; jurisdiction?: string | null; airport?: string; stayHours?: number };
    stayDays?: number;
    arrivalDate?: string; // YYYY-MM-DD，计划抵达/入境当地日期
    entryAirport?: string;
    exitAirport?: string;
    destination?: { country?: string; region?: string | null };
  };
  traveler: {
    passport?: { issuingCountry?: string; type?: string; validFrom?: string; validUntil?: string };
    documents?: Array<QualifyingDoc>;
    history?: Record<string, Partial<HistoryFacts>>;
  };
  documents?: Record<string, { status?: string }>;
  manualReview?: { status?: string };
}

export interface QualifyingDoc {
  kind: string; // VISA | PERMANENT_RESIDENCE | TEMPORARY_RESIDENCE | REENTRY_PERMIT | RESIDENCE
  issuerCountry: string;
  visaType?: string;
  entryCount?: string; // SINGLE | DOUBLE | MULTIPLE | NOT_APPLICABLE | UNKNOWN
  validFrom?: string;
  validUntil?: string;
  usedBefore?: boolean;
  verificationMode?: string;
  status?: string;
}

export interface HistoryFacts {
  daysInRollingWindowIncludingTrip?: number;
  daysInVisaYearIncludingTrip?: number;
  daysInMigrationYearIncludingTrip?: number;
  deniedEntryWithin3Years?: boolean;
  seriousImmigrationViolation?: boolean;
}

export interface AssessResult {
  assessmentId: string;
  searchDecision: DecisionCode;
  bookingDecision: DecisionCode;
  matchedRuleIds: string[];
  missingFacts: string[];
  requirements: Array<{ code: string; status: 'SATISFIED' | 'PENDING' | 'MISSING'; descriptionZh: string }>;
  explanationZh: string;
  warningsZh: string[];
  sources: Array<{ sourceId: string; authority: string; url: string; lastCheckedAt: string }>;
  ruleSet: { schemaVersion: string; checksum: string };
  expiresAt: string;
  maxStay: RuleDecision['maxStay'];
  entryMode?: string;
  category?: string;
  disclaimerZh: string;
}
