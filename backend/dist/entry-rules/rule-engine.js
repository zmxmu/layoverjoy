"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateEligibility = evaluateEligibility;
const DAY_MS = 24 * 3600 * 1000;
function daysBetween(a, b) {
    return Math.floor((b.getTime() - a.getTime()) / DAY_MS);
}
function evaluateEligibility(rule, input) {
    const now = input.now ? new Date(input.now) : new Date();
    const base = { disclaimerRequired: true };
    if (!input.passport?.issuingCountry || !input.passport?.type || !input.passport?.validUntil) {
        return { ...base, status: 'NEEDS_INFO', reasonCodes: ['PASSPORT_INFO_MISSING'], requiredDocuments: [] };
    }
    if (!rule) {
        return { ...base, status: 'INELIGIBLE', reasonCodes: ['NO_RULE_FOUND'], requiredDocuments: [] };
    }
    const meta = {
        ruleId: rule.id,
        ruleVersion: rule.version,
        sourceUrl: rule.sourceUrl,
        verifiedAt: rule.verifiedAt,
        requiredDocuments: [...rule.requiredEvidence],
    };
    const verifiedAt = new Date(rule.verifiedAt);
    if (daysBetween(verifiedAt, now) > 30) {
        return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['RULE_NEEDS_REVERIFY'] };
    }
    const travelDate = new Date(input.travelDate);
    if (rule.minPassportValidityMonths) {
        const passportValidUntil = new Date(input.passport.validUntil);
        const requiredDays = rule.minPassportValidityMonths * 30;
        if (daysBetween(travelDate, passportValidUntil) < requiredDays) {
            return { ...base, ...meta, status: 'INELIGIBLE', reasonCodes: ['PASSPORT_VALIDITY_INSUFFICIENT'] };
        }
    }
    if (input.stayDays > rule.maxStayDays) {
        return { ...base, ...meta, status: 'INELIGIBLE', reasonCodes: ['STAY_EXCEEDS_LIMIT'] };
    }
    if (input.stayDays <= 0) {
        return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['STAY_DAYS_MISSING'] };
    }
    if (rule.maxCumulativeStayDays && input.cumulativeKnown === false) {
        return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['CUMULATIVE_STAY_UNKNOWN'] };
    }
    if (rule.maxCumulativeStayDays) {
        const used = input.cumulativeStayDaysInWindow ?? 0;
        if (used + input.stayDays > rule.maxCumulativeStayDays) {
            return { ...base, ...meta, status: 'INELIGIBLE', reasonCodes: ['CUMULATIVE_STAY_EXCEEDS_LIMIT'] };
        }
    }
    if (rule.entryMode === 'E_VISA_REQUIRED') {
        const visa = (input.visas || []).find((v) => v.country === rule.transitCountry && (!v.validUntil || new Date(v.validUntil) >= travelDate));
        if (!visa) {
            return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['E_VISA_REQUIRED'] };
        }
    }
    if (rule.requiredEvidence.includes('CONFIRMED_ONWARD_TICKET') && input.onwardTicketConfirmed === false) {
        return { ...base, ...meta, status: 'NEEDS_INFO', reasonCodes: ['ONWARD_TICKET_UNCONFIRMED'] };
    }
    return {
        ...base,
        ...meta,
        status: 'ELIGIBLE',
        reasonCodes: [
            rule.entryMode === 'VISA_FREE' ? 'VISA_EXEMPT' : rule.entryMode === 'TRANSIT_PERMISSION' ? 'TRANSIT_PERMISSION' : 'E_VISA_HELD',
            'STAY_WITHIN_LIMIT',
        ],
    };
}
