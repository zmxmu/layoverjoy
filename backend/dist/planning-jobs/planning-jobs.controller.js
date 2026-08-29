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
exports.PlanningJobsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../common/auth");
const planning_jobs_service_1 = require("./planning-jobs.service");
let PlanningJobsController = class PlanningJobsController {
    jobs;
    constructor(jobs) {
        this.jobs = jobs;
    }
    create(user, body) {
        return this.jobs.create(user.userId, body);
    }
    get(user, id) {
        return this.jobs.get(user.userId, id);
    }
    evidence(user, id) {
        return this.jobs.evidence(user.userId, id);
    }
    remove(user, id) {
        return this.jobs.remove(user.userId, id);
    }
};
exports.PlanningJobsController = PlanningJobsController;
__decorate([
    (0, common_1.Post)(),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", void 0)
], PlanningJobsController.prototype, "create", null);
__decorate([
    (0, common_1.Get)(':id'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PlanningJobsController.prototype, "get", null);
__decorate([
    (0, common_1.Get)(':id/evidence'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PlanningJobsController.prototype, "evidence", null);
__decorate([
    (0, common_1.Delete)(':id'),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", void 0)
], PlanningJobsController.prototype, "remove", null);
exports.PlanningJobsController = PlanningJobsController = __decorate([
    (0, swagger_1.ApiTags)('planning-jobs'),
    (0, common_1.Controller)('api/v1/planning-jobs'),
    (0, common_1.UseGuards)(auth_1.JwtAuthGuard),
    __metadata("design:paramtypes", [planning_jobs_service_1.PlanningJobsService])
], PlanningJobsController);
