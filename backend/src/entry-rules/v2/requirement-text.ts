/**
 * 所需旅行证件 code → 英文描述字典。
 * 规则数据集只维护中文 descriptionZh；英文界面展示时由评估期/读取期按 code 补齐 descriptionEn，
 * 保证双语 App 不出现整段中文。未知 code 回退 undefined（客户端再回退中文/原文）。
 */
export const REQUIREMENT_EN: Record<string, string> = {
  ACCOMMODATION: 'Have verifiable accommodation bookings.',
  ACCOMMODATION_OR_INVITATION: 'Provide accommodation, invitation or purpose proof.',
  APPROVED_E_VISA: 'Hold an approved e-visa for this destination.',
  ARRIVAL_CARD_AND_ONLINE_FORM: 'Submit the required arrival card and online forms before arrival.',
  CAMBODIA_E_ARRIVAL: 'Complete the Cambodia e-Arrival card before arrival.',
  COLOMBIA_STAY_REVIEW: 'Stay conditions are subject to manual review.',
  CONFIRMED_HOTEL: 'Hold verifiable hotel bookings.',
  CONFIRMED_ONWARD_TICKET: 'Hold a confirmed onward ticket.',
  CONFIRMED_ONWARD_WITHIN_30_DAYS: 'Hold a confirmed onward ticket within 30 days.',
  CURRENT_CIRCULAR_REVIEW: 'The current circular must be verified before travel.',
  DESIGNATED_E_VISA_PORTS: 'Enter only via designated e-visa ports.',
  DESTINATION_ENTRY_PERMISSION: "Meet the destination's entry permission requirements.",
  ETRAVEL: 'Complete the Philippines eTravel registration.',
  FUNDS_500_USD: 'Show proof of funds of at least USD 500.',
  GENUINE_THIRD_COUNTRY_ROUTE: 'The route must be a genuine third-country transit.',
  ICN_ONWARD_TICKET: 'Hold an onward ticket departing from Incheon.',
  IMMIGRATION_HISTORY_DECLARATION: 'Declare your immigration history truthfully.',
  MAINLAND_EXIT_PREFLIGHT: 'Meet mainland exit pre-flight checks.',
  MDAC: 'Submit the Malaysia Digital Arrival Card (MDAC) as required.',
  MFM_TRANSPORT_DOCUMENT: 'Hold transport documents for Macao SAR.',
  NON_TRANSIT_QUALIFYING_VISA: 'Hold a qualifying visa that is not transit-limited.',
  NO_REMUNERATED_WORK: 'No remunerated work during the stay.',
  OMAN_CURRENT_DETAILS_REVIEW: 'Oman entry details require current verification.',
  ONWARD_AND_ACCOMMODATION: 'Hold onward tickets and accommodation proof.',
  ONWARD_FUNDS_PURPOSE: 'Show onward tickets, sufficient funds and travel purpose.',
  ONWARD_TICKET: 'Hold a return or onward ticket.',
  ORIGINAL_QUALIFYING_DOCUMENT: 'Present the original qualifying document.',
  PASSPORT_STAY_PLUS_90_DAYS: 'Passport valid at least 90 days beyond the stay.',
  PASSPORT_VALID_3_MONTHS: 'Passport valid for at least 3 months on arrival.',
  PASSPORT_VALID_6_MONTHS: 'Passport valid for at least six months on arrival.',
  PASSPORT_VALID_6_MONTHS_BEYOND_STAY: 'Passport valid at least six months beyond the intended stay.',
  PERU_PREFLIGHT_REVIEW: 'Peru pre-flight review applies.',
  PHU_QUOC_ONLY_ITINERARY: 'Itinerary must stay within Phu Quoc Island.',
  PH_TRANSIT_VISA: 'A Philippines transit visa is required for third-country transit.',
  QUALIFYING_DOCUMENT_VALIDITY: 'Qualifying documents must remain valid for the stay.',
  QUALIFYING_VISA_OR_RESIDENCE: 'Hold a qualifying visa or residence permit.',
  RECOGNIZED_TRANSIT_TOUR_BOOKING: 'Hold a recognized transit-tour booking.',
  RETURN_OR_ONWARD_TICKET: 'Hold a return or onward ticket.',
  RETURN_TICKET: 'Hold a return ticket.',
  ROUTE_DIRECTION_CHECK: 'Route direction must satisfy transit rules.',
  SG_ARRIVAL_CARD: 'Submit the SG Arrival Card within 3 days before arrival.',
  STAY_LIMIT_MANUAL_REVIEW: 'Stay limit requires manual review.',
  SUFFICIENT_FUNDS: 'Prepare sufficient travel funds.',
  TEMPORARY_POLICY_RECHECK: 'Temporary policy must be rechecked before ticketing.',
  TOURIST_CARD_OR_INCLUDED_TAX: 'Hold a tourist card or proof of included tax.',
  TRANSIT_ZONE_CONTINUITY: 'Remain within the transit zone between flights.',
  VALIDITY_6_MONTHS: 'Travel documents valid for at least six months.',
  VALID_PASSPORT: 'Hold a valid passport.',
  VOA_FEE: 'Pay the visa-on-arrival fee at the port.',
};

/** 为所需证件对象补齐 descriptionEn（已有则不覆盖）。 */
export function withDescriptionEn(doc: { code?: string; descriptionEn?: string | null }): {
  descriptionEn?: string;
} {
  if (doc.descriptionEn) return { descriptionEn: doc.descriptionEn };
  const en = doc.code ? REQUIREMENT_EN[doc.code] : undefined;
  return en ? { descriptionEn: en } : {};
}
