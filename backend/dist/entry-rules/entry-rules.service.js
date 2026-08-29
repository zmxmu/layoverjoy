"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.EntryRulesService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma.service");
const rule_engine_1 = require("./rule-engine");
let EntryRulesService = class EntryRulesService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async findRule(passportCountry, passportType, transitCountry) {
        const rule = await this.prisma.entryRule.findFirst({
            where: { passportCountry, passportType, transitCountry, status: 'ACTIVE' },
        });
        if (!rule)
            return null;
        return {
            id: rule.id,
            version: rule.version,
            passportCountry: rule.passportCountry,
            passportType: rule.passportType,
            transitCountry: rule.transitCountry,
            candidateCities: rule.candidateCitiesJson ?? [],
            entryMode: rule.entryMode,
            maxStayDays: rule.maxStayDays,
            maxCumulativeStayDays: rule.maxCumulativeStayDays ?? undefined,
            cumulativeWindowDays: rule.cumulativeWindowDays ?? undefined,
            minPassportValidityMonths: rule.minPassportValidityMonths ?? undefined,
            requiredEvidence: rule.requiredEvidenceJson ?? [],
            hardConditions: rule.hardConditionsJson ?? [],
            sourceUrl: rule.sourceUrl,
            sourceVersion: rule.sourceVersion,
            verifiedAt: rule.verifiedAt.toISOString().slice(0, 10),
        };
    }
    async evaluate(input) {
        const country = input.passportCountry || input.passport?.issuingCountry || '';
        const type = input.passportType || input.passport?.type || '';
        const rule = country ? await this.findRule(country, type, input.destinationCountry) : null;
        return (0, rule_engine_1.evaluateEligibility)(rule, input);
    }
    async snapshot(searchRunId, cityId, countryCode, result) {
        const snap = await this.prisma.eligibilitySnapshot.create({
            data: {
                searchRunId,
                cityId,
                countryCode,
                status: result.status,
                ruleId: result.ruleId,
                ruleVersion: result.ruleVersion,
                reasonCodesJson: result.reasonCodes,
                requiredDocsJson: result.requiredDocuments,
                sourceUrl: result.sourceUrl,
                verifiedAt: result.verifiedAt,
            },
        });
        return snap.id;
    }
};
exports.EntryRulesService = EntryRulesService;
exports.EntryRulesService = EntryRulesService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], EntryRulesService);
