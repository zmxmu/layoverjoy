"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AtlasModule = void 0;
const common_1 = require("@nestjs/common");
const atlas_service_1 = require("./atlas.service");
const redis_service_1 = require("../redis.service");
let AtlasModule = class AtlasModule {
};
exports.AtlasModule = AtlasModule;
exports.AtlasModule = AtlasModule = __decorate([
    (0, common_1.Module)({
        providers: [atlas_service_1.AtlasService, redis_service_1.RedisService],
        exports: [atlas_service_1.AtlasService],
    })
], AtlasModule);
