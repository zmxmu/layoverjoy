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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AirportsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../common/auth");
const catalog_1 = require("./catalog");
const entry_rules_service_1 = require("../entry-rules/entry-rules.service");
const errors_1 = require("../common/errors");
let AirportsController = class AirportsController {
    rules;
    constructor(rules) {
        this.rules = rules;
    }
    cities(q) {
        const all = catalog_1.HUB_CATALOG.map((c) => ({
            cityId: c.cityId,
            cityNameZh: c.cityNameZh,
            cityNameEn: c.cityNameEn,
            countryCode: c.countryCode,
            metroCode: c.metroCode,
            airports: c.airports,
        }));
        if (!q)
            return { cities: all };
        const kw = q.toLowerCase();
        return {
            cities: all.filter((c) => c.cityNameZh.includes(q) ||
                c.cityNameEn.toLowerCase().includes(kw) ||
                (c.metroCode || '').toLowerCase() === kw ||
                c.airports.some((a) => a.iata.toLowerCase() === kw)),
        };
    }
    resolve(input) {
        if (!input)
            throw errors_1.AppError.validation(['input']);
        const loc = (0, catalog_1.resolveLocation)(input);
        if (!loc) {
            throw new errors_1.AppError('UNSUPPORTED_AIRPORT', '当前 MVP 暂不支持这个城市或机场。', 422, false, { input });
        }
        return { location: loc };
    }
};
exports.AirportsController = AirportsController;
__decorate([
    (0, common_1.Get)('cities'),
    __param(0, (0, common_1.Query)('q')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "cities", null);
__decorate([
    (0, common_1.Get)('resolve'),
    __param(0, (0, common_1.Query)('input')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], AirportsController.prototype, "resolve", null);
exports.AirportsController = AirportsController = __decorate([
    (0, swagger_1.ApiTags)('airports'),
    (0, common_1.Controller)('airports'),
    (0, common_1.UseGuards)(auth_1.JwtAuthGuard),
    __metadata("design:paramtypes", [entry_rules_service_1.EntryRulesService])
], AirportsController);
