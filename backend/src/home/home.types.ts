/** 首页机会卡契约（11-执行方案 §5.2）。只读接口，不含任何证件号码/姓名/邮箱/加密字段。 */

export type OpportunityState = 'NEEDS_DOCUMENT' | 'EMPTY' | 'READY' | 'STALE';

/** 报价新鲜度：CURRENT=未过期；STALE=已过期需重新确认；UNKNOWN=无过期信息（不得显示"实时"）。 */
export type QuoteFreshness = 'CURRENT' | 'STALE' | 'UNKNOWN';

export interface OpportunityProfile {
  passportCountry: string;
  passportType: string | null;
  validVisaCount: number;
}

export interface OpportunityEligibility {
  status: string;
  ruleId: string | null;
  ruleVersion: string | null;
}

export interface OpportunityDetail {
  planId: string;
  searchRunId: string;
  origin: string;
  hub: string;
  destination: string;
  stayDays: number;
  usableHours: number;
  currency: string;
  airfareTotal: number;
  /** 无直飞基准时为 null，UI 隐藏差价比较。 */
  directAirfare: number | null;
  airfareDelta: number | null;
  /** 含酒店/地面交通估算的全成本；无数据时为 null，不得捏造。 */
  estimatedTripTotal: number | null;
  joyScore: number;
  eligibility: OpportunityEligibility;
  sourceProvider: string;
  isSimulated: boolean;
  quoteFreshness: QuoteFreshness;
  quoteExpiresAt: string | null;
}

export interface HomeOpportunityResponse {
  state: OpportunityState;
  profile?: OpportunityProfile;
  eligibleHubCount?: number;
  opportunity?: OpportunityDetail;
  generatedAt: string;
}
