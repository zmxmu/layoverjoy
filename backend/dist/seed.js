"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const client_1 = require("@prisma/client");
const prisma = new client_1.PrismaClient();
const RULES = [
    {
        id: 'CN-ORD-MY-VISA-FREE-2025',
        version: '2026-08-29.1',
        passportCountry: 'CN',
        passportType: 'ORDINARY',
        transitCountry: 'MY',
        candidateCities: ['KUL', 'PEN', 'BKI'],
        entryMode: 'VISA_FREE',
        maxStayDays: 30,
        maxCumulativeStayDays: 90,
        cumulativeWindowDays: 180,
        minPassportValidityMonths: 6,
        requiredEvidence: ['CONFIRMED_ONWARD_TICKET', 'ACCOMMODATION_OR_ADDRESS', 'SUFFICIENT_FUNDS_DECLARATION'],
        hardConditions: ['SOCIAL_VISIT_OR_TOURISM', 'NO_EMPLOYMENT', 'STAY_NOT_EXTENDABLE'],
        sourceUrl: 'https://malaysiavisa.imi.gov.my/faq/',
        sourceVersion: 'Malaysia-China mutual visa exemption effective 2025-07-17',
        verifiedAt: '2026-08-29',
    },
    {
        id: 'CN-ORD-TH-BILATERAL-30D',
        version: '2026-08-29.1',
        passportCountry: 'CN',
        passportType: 'ORDINARY',
        transitCountry: 'TH',
        candidateCities: ['BKK', 'DMK', 'CNX', 'HKT'],
        entryMode: 'VISA_FREE',
        maxStayDays: 30,
        maxCumulativeStayDays: 90,
        cumulativeWindowDays: 180,
        minPassportValidityMonths: 6,
        requiredEvidence: ['CONFIRMED_ONWARD_TICKET', 'ACCOMMODATION_OR_ADDRESS'],
        hardConditions: ['NO_RESIDENCE', 'NO_EMPLOYMENT', 'NO_STUDY', 'NO_MEDIA_ACTIVITY'],
        sourceUrl: 'https://mfa.go.th/en/content/thcn280124?cate=5d5bcb4e15e39c306000683e',
        sourceVersion: 'China-Thailand mutual visa exemption effective 2024-03-01',
        verifiedAt: '2026-08-29',
    },
    {
        id: 'CN-ORD-HK-TRANSIT-7D',
        version: '2026-08-29.1',
        passportCountry: 'CN',
        passportType: 'ORDINARY',
        transitCountry: 'HK',
        candidateCities: ['HKG'],
        entryMode: 'TRANSIT_PERMISSION',
        maxStayDays: 7,
        maxCumulativeStayDays: null,
        cumulativeWindowDays: null,
        minPassportValidityMonths: null,
        requiredEvidence: ['CONFIRMED_ONWARD_TICKET', 'VALID_DESTINATION_ENTRY_DOCUMENTS', 'THIRD_COUNTRY_OR_REGION_TRANSIT'],
        hardConditions: ['GENUINE_TRANSIT', 'NORMAL_IMMIGRATION_REQUIREMENTS'],
        sourceUrl: 'https://www.immd.gov.hk/hks/services/visas/overseas-chinese-entry-arrangement.html',
        sourceVersion: 'Hong Kong Immigration Department transit paragraph 14',
        verifiedAt: '2026-08-29',
    },
    {
        id: 'CN-ORD-VN-EVISA-REQUIRED',
        version: '2026-08-29.1',
        passportCountry: 'CN',
        passportType: 'ORDINARY',
        transitCountry: 'VN',
        candidateCities: ['SGN', 'HAN', 'DAD'],
        entryMode: 'E_VISA_REQUIRED',
        maxStayDays: 90,
        maxCumulativeStayDays: null,
        cumulativeWindowDays: null,
        minPassportValidityMonths: null,
        requiredEvidence: ['VALID_VIETNAM_E_VISA', 'APPROVED_ENTRY_CHECKPOINT', 'CONFIRMED_ONWARD_TICKET'],
        hardConditions: ['E_VISA_MUST_COVER_FULL_STAY', 'PASSPORT_DETAILS_MUST_MATCH'],
        sourceUrl: 'https://evisa.gov.vn/?option=MO',
        sourceVersion: 'Vietnam Immigration Department e-visa portal',
        verifiedAt: '2026-08-29',
    },
];
async function main() {
    for (const r of RULES) {
        await prisma.entryRule.upsert({
            where: { id: r.id },
            create: {
                id: r.id,
                version: r.version,
                passportCountry: r.passportCountry,
                passportType: r.passportType,
                transitCountry: r.transitCountry,
                candidateCitiesJson: r.candidateCities,
                entryMode: r.entryMode,
                maxStayDays: r.maxStayDays,
                maxCumulativeStayDays: r.maxCumulativeStayDays,
                cumulativeWindowDays: r.cumulativeWindowDays,
                minPassportValidityMonths: r.minPassportValidityMonths,
                requiredEvidenceJson: r.requiredEvidence,
                hardConditionsJson: r.hardConditions,
                sourceUrl: r.sourceUrl,
                sourceVersion: r.sourceVersion,
                verifiedAt: new Date(`${r.verifiedAt}T00:00:00Z`),
                status: 'ACTIVE',
            },
            update: {
                version: r.version,
                candidateCitiesJson: r.candidateCities,
                requiredEvidenceJson: r.requiredEvidence,
                hardConditionsJson: r.hardConditions,
                sourceUrl: r.sourceUrl,
                sourceVersion: r.sourceVersion,
                verifiedAt: new Date(`${r.verifiedAt}T00:00:00Z`),
            },
        });
    }
    console.log(`[seed] upserted ${RULES.length} entry rules`);
}
main()
    .catch((e) => {
    console.error('[seed] failed:', e?.message ?? e);
    process.exit(1);
})
    .finally(() => prisma.$disconnect());
