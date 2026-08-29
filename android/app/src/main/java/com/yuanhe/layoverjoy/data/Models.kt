package com.yuanhe.layoverjoy.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonObject

/**
 * 与后端 API 契约一一对应的数据模型。
 * 后端响应统一附带的 requestId / serverTime 在反序列化时被忽略（ignoreUnknownKeys）。
 */

// ---------- 错误契约 ----------

@Serializable
data class ErrorEnvelope(
    val code: String = "INTERNAL_ERROR",
    val message: String? = null,
    val retryable: Boolean = false,
    val traceId: String? = null,
    /** 业务细节：如 PARTIAL_BOOKING 时携带 intentId，用于后续补偿操作。 */
    val details: JsonObject? = null,
)

@Serializable
data class ErrorBody(val error: ErrorEnvelope = ErrorEnvelope())

// ---------- 认证 ----------

@Serializable
data class RegisterRequest(val email: String, val password: String, val displayName: String? = null)

@Serializable
data class LoginRequest(val email: String, val password: String)

@Serializable
data class RefreshRequest(val refreshToken: String)

@Serializable
data class AuthTokens(
    val accessToken: String,
    val refreshToken: String? = null,
    val expiresIn: Int = 900,
)

// ---------- 用户与证件钱包 ----------

@Serializable
data class MeUser(
    val id: String? = null,
    val email: String? = null,
    val displayName: String? = null,
    val residenceCountry: String? = null,
    val timezone: String? = null,
)

/** GET /v1/me 返回 { user, wallet } 包装。 */
@Serializable
data class MeProfile(
    val user: MeUser? = null,
    val wallet: JsonObject? = null,
)

@Serializable
data class DocumentDto(
    val id: String,
    val kind: String,
    val countryCode: String,
    val passportType: String? = null,
    val visaType: String? = null,
    val entryType: String? = null,
    val remainingEntries: Int? = null,
    val validFrom: String? = null,
    val expiresOn: String? = null,
    val isPrimary: Boolean = false,
    val status: String = "ACTIVE",
)

@Serializable
data class DocumentsResponse(
    val documents: List<DocumentDto> = emptyList(),
    val validVisaCount: Int = 0,
    val needsInfoCount: Int = 0,
)

/** 隐私底线：只上传签发国家、类型与有效期，绝不上传证件号码、姓名与照片。 */
@Serializable
data class DocumentInput(
    val kind: String,
    val countryCode: String,
    val passportType: String? = null,
    val visaType: String? = null,
    val entryType: String? = null,
    val remainingEntries: Int? = null,
    val validFrom: String? = null,
    val expiresOn: String? = null,
    val isPrimary: Boolean? = null,
)

@Serializable
data class IdResponse(val id: String)

// ---------- 首页机会卡 ----------

/** 首页「我的最佳中转机会」：金额一律 Double?，未知不用 0 顶替（11-执行方案 §5.2）。 */
@Serializable
data class OpportunityProfile(
    val passportCountry: String = "",
    val passportType: String? = null,
    val validVisaCount: Int = 0,
)

@Serializable
data class OpportunityEligibility(
    val status: String = "",
    val ruleId: String? = null,
    val ruleVersion: String? = null,
)

@Serializable
data class OpportunityDetail(
    val planId: String = "",
    val searchRunId: String = "",
    val origin: String = "",
    val hub: String = "",
    val destination: String = "",
    val stayDays: Int = 0,
    val usableHours: Double = 0.0,
    val currency: String = "",
    val airfareTotal: Double? = null,
    val directAirfare: Double? = null,
    val airfareDelta: Double? = null,
    val estimatedTripTotal: Double? = null,
    val joyScore: Int = 0,
    val eligibility: OpportunityEligibility = OpportunityEligibility(),
    val sourceProvider: String = "MOCK",
    val isSimulated: Boolean = true,
    val quoteFreshness: String = "UNKNOWN",
    val quoteExpiresAt: String? = null,
)

@Serializable
data class HomeOpportunityResponse(
    val state: String = "EMPTY", // NEEDS_DOCUMENT | EMPTY | READY | STALE
    val profile: OpportunityProfile? = null,
    val eligibleHubCount: Int? = null,
    val opportunity: OpportunityDetail? = null,
    val generatedAt: String = "",
)

// ---------- 机场目录 ----------

@Serializable
data class AirportRef(val iata: String = "", val nameZh: String? = null, val nameEn: String? = null)

@Serializable
data class CityDto(
    val cityId: String,
    val cityNameZh: String = "",
    val cityNameEn: String = "",
    val countryCode: String = "",
    val metroCode: String? = null,
    val airports: List<AirportRef> = emptyList(),
)

@Serializable
data class CitiesResponse(val cities: List<CityDto> = emptyList())

// ---------- 搜索 ----------

@Serializable
data class SearchPreferences(
    val interests: List<String>? = null,
    val acceptRedEye: Boolean? = null,
    val demoFixture: Boolean? = null,
)

@Serializable
data class SearchRequest(
    val origin: String,
    val destination: String,
    val departureDate: String,
    val minStopDays: Int? = null,
    val maxStopDays: Int? = null,
    val maxAirfareDelta: Double? = null,
    val preferences: SearchPreferences? = null,
)

@Serializable
data class SearchCreatedResponse(val searchRunId: String, val status: String = "PENDING")

@Serializable
data class FunnelItem(
    val cityId: String = "",
    val cityNameZh: String = "",
    val status: String = "",
    val reasonCodes: List<String> = emptyList(),
    val ruleId: String? = null,
)

@Serializable
data class SearchCounts(
    val candidates: Int = 0,
    val eligibilityRejected: Int = 0,
    val experienceRejected: Int = 0,
    val keptPlans: Int = 0,
)

@Serializable
data class SearchStatusResponse(
    val searchRunId: String,
    val status: String,
    val resultStatus: String? = null,
    val providerMode: String? = null,
    val funnel: List<FunnelItem> = emptyList(),
    val counts: SearchCounts = SearchCounts(),
    val error: JsonObject? = null,
)

// ---------- 方案 ----------

@Serializable
data class OfferDto(
    val snapshotId: String? = null,
    val legNo: Int = 0,
    val role: String = "",
    val origin: String = "",
    val destination: String = "",
    val departureAt: String = "",
    val arrivalAt: String = "",
    val carrier: String? = null,
    val flightNumber: String? = null,
    val currency: String = "SGD",
    val totalPrice: Double = 0.0,
    val priceStatus: String = "current",
    val isSimulated: Boolean = true,
    val sourceProvider: String = "ATLAS_SANDBOX",
)

@Serializable
data class CostItem(
    val key: String = "",
    val amount: Double = 0.0,
    val confidence: String = "UNKNOWN",
    val note: String = "",
)

@Serializable
data class CostBreakdown(
    val currency: String = "SGD",
    val items: List<CostItem> = emptyList(),
    val total: Double = 0.0,
)

@Serializable
data class JoyComponent(
    val key: String = "",
    val label: String? = null,
    val weight: Double = 0.0,
    val normalized: Double = 0.0,
    val points: Double = 0.0,
)

@Serializable
data class PlanDto(
    val planId: String,
    val planType: String = "STOPOVER",
    val stopoverCityId: String? = null,
    val hubAirport: String? = null,
    val stayDays: Int = 0,
    val legs: List<OfferDto?> = emptyList(),
    val airfareTotal: Double = 0.0,
    val airfareDelta: Double = 0.0,
    val currency: String = "SGD",
    val costBreakdown: CostBreakdown? = null,
    val joyScore: Int = 0,
    val joyScoreBreakdown: List<JoyComponent> = emptyList(),
    val usableHours: Double = 0.0,
    val riskLevel: String = "MEDIUM",
    val riskFlags: List<String> = emptyList(),
    val sourceProvider: String = "ATLAS_SANDBOX",
    val isSimulated: Boolean = true,
)

@Serializable
data class EligibilityDto(
    val cityId: String = "",
    val status: String = "",
    val ruleId: String? = null,
    val ruleVersion: String? = null,
    val reasonCodes: List<String> = emptyList(),
    val sourceUrl: String? = null,
    val verifiedAt: String? = null,
)

@Serializable
data class DirectBaseline(val planType: String = "DIRECT", val offer: OfferDto? = null)

@Serializable
data class PlansResponse(
    val searchRunId: String,
    val status: String,
    val resultStatus: String? = null,
    val providerMode: String? = null,
    val directBaseline: DirectBaseline? = null,
    val plans: List<PlanDto> = emptyList(),
    val funnel: List<FunnelItem> = emptyList(),
    val eligibility: List<EligibilityDto> = emptyList(),
    val counts: SearchCounts = SearchCounts(),
)

// ---------- 方案详情 / 解释 / 城市包 ----------

@Serializable
data class StopoverCityRef(
    val cityId: String = "",
    val cityNameZh: String = "",
    val cityNameEn: String = "",
    val countryCode: String = "",
)

@Serializable
data class CityPack(
    val attractions: List<String> = emptyList(),
    val areas: List<String> = emptyList(),
    val tips: List<String> = emptyList(),
    val airportToCityZh: String = "",
    val suggestedDays: Int = 0,
)

@Serializable
data class ExplanationPayload(
    val provider: String = "TEMPLATE",
    val summary: String = "",
    val highlights: List<String> = emptyList(),
    val tips: List<String> = emptyList(),
    val modelId: String? = null,
    /** Nosana 推理耗时（毫秒），诚实展示真实成本。 */
    val latencyMs: Long? = null,
    /** 部署 ID 后 8 位。 */
    val deploymentIdTail: String? = null,
    /** TEMPLATE 时的降级原因（TIMEOUT/NETWORK_ERROR 等）。 */
    val fallbackReason: String? = null,
)

/** POST /v1/plans/:id/explanation 与详情内嵌 explanation 共用。 */
@Serializable
data class ExplanationDto(
    val provider: String = "TEMPLATE",
    val modelId: String? = null,
    val payload: ExplanationPayload? = null,
)

@Serializable
data class EligibilityDetailDto(
    val status: String = "",
    val ruleId: String? = null,
    val ruleVersion: String? = null,
    val reasonCodes: List<String> = emptyList(),
    val requiredDocuments: List<String> = emptyList(),
    val sourceUrl: String? = null,
    val verifiedAt: String? = null,
)

/** GET /v1/plans/:id 返回扁平结构。 */
@Serializable
data class PlanDetailDto(
    val planId: String,
    val searchRunId: String = "",
    val planType: String = "STOPOVER",
    val stopoverCity: StopoverCityRef? = null,
    val hubAirport: String? = null,
    val stayDays: Int = 0,
    val legs: List<OfferDto> = emptyList(),
    val airfareTotal: Double = 0.0,
    val airfareDelta: Double = 0.0,
    val currency: String = "SGD",
    val costBreakdown: CostBreakdown? = null,
    val joyScore: Int = 0,
    val joyScoreBreakdown: List<JoyComponent> = emptyList(),
    val usableHours: Double = 0.0,
    val riskLevel: String = "MEDIUM",
    val riskFlags: List<String> = emptyList(),
    val isSimulated: Boolean = true,
    val eligibility: EligibilityDetailDto? = null,
    val cityPack: CityPack? = null,
    val explanation: ExplanationDto? = null,
)

// ---------- 通知 ----------

@Serializable
data class NotificationDto(
    val id: String,
    val kind: String = "",
    val title: String = "",
    val body: String = "",
    val deepLink: String? = null,
    val planId: String? = null,
    val monitorId: String? = null,
    val isSimulated: Boolean = true,
    val readAt: String? = null,
    val createdAt: String = "",
)

@Serializable
data class NotificationsResponse(val notifications: List<NotificationDto> = emptyList())

// ---------- 监控 ----------

@Serializable
data class MonitorInput(
    val planId: String,
    val targetAirfare: Double? = null,
    val minJoyScore: Int? = null,
    val notifyEmail: Boolean = true,
    val notifyApp: Boolean = true,
)

@Serializable
data class MonitorDto(
    val monitorId: String,
    val planId: String = "",
    val routeLabel: String = "",
    val targetAirfare: Double? = null,
    val minJoyScore: Int? = null,
    val notifyEmail: Boolean = true,
    val notifyApp: Boolean = true,
    val status: String = "ACTIVE",
    val lastCheckedAt: String? = null,
    val lastTriggeredAt: String? = null,
    val lastTriggerReason: String? = null,
)

@Serializable
data class MonitorsResponse(val monitors: List<MonitorDto> = emptyList())

@Serializable
data class MonitorStatusInput(val status: String)

@Serializable
data class MonitorCreatedResponse(val monitorId: String, val status: String = "ACTIVE")

// ---------- 预订 ----------

@Serializable
data class PassengerInput(val givenName: String? = null, val familyName: String? = null)

@Serializable
data class CompositeOrderRequest(
    val planId: String,
    val riskAckVersion: Int = 1,
    val passengers: List<PassengerInput>? = null,
    val legBFailure: Boolean? = null,
)

@Serializable
data class OrderDto(
    val legNo: Int = 0,
    val provider: String = "ATLAS",
    val status: String = "",
    val orderNoLast4: String? = null,
)

@Serializable
data class BookingDto(
    val bookingId: String,
    val planId: String = "",
    val status: String = "DRAFT",
    val sourceEnvironment: String = "SANDBOX",
    val isSimulated: Boolean = true,
    val acceptedTotal: Double = 0.0,
    val currency: String = "SGD",
    val riskAckVersion: Int = 1,
    val expiresAt: String? = null,
    val createdAt: String = "",
    val orders: List<OrderDto> = emptyList(),
)

@Serializable
data class BookingsResponse(val bookings: List<BookingDto> = emptyList())

@Serializable
data class BookingResponse(val booking: BookingDto)
