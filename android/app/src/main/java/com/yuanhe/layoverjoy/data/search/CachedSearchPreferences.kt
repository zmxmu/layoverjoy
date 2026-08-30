package com.yuanhe.layoverjoy.data.search

import java.math.BigDecimal
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate

/** 出发地的选择来源：手动挑选 或 「使用当前城市」定位匹配（方案 §4.1）。 */
enum class OriginSelectionSource { MANUAL, CURRENT_LOCATION }

/** 缓存条目来源，用于决定「建议」标签是否出现（方案 §5.4：只有系统推算才提示）。 */
enum class DepartureDateSource {
    /** 缓存日期仍有效，原样恢复。 */
    RESTORED_CACHED,

    /** 过期日期按历史提前天数滚动。 */
    ROLLED_FROM_LEAD_DAYS,

    /** 过期日期没有合法提前天数，按「至少 21 天后的同一星期」滚动。 */
    ROLLED_SAME_WEEKDAY,

    /** 首次打开/无历史：至少 21 天后的第一个周五。 */
    DEFAULT_FIRST_FRIDAY,
}

/**
 * 某用户上一次搜索设置的快照（方案 §4.1 的 13 个字段）。
 *
 * 隐私边界：只存城市/机场代码、日期与预算，**不存经纬度**、不存证件信息、不存邮箱。
 * 机场列表语义：空列表 = 该城市全部机场（ALL_AIRPORTS），单元素 = 只选那个机场。
 */
data class CachedSearchPreferences(
    val originCityCode: String? = null,
    val originAirportCodes: List<String> = emptyList(),
    val destinationCityCode: String? = null,
    val destinationAirportCodes: List<String> = emptyList(),
    val departureDate: LocalDate? = null,
    val preferredLeadDays: Int? = null,
    /** ISO 星期序号：1=周一 … 7=周日。 */
    val preferredDepartureDayOfWeek: Int? = null,
    val minStopoverDays: Int = SearchPreferencesCodec.DEFAULT_MIN_STOPOVER_DAYS,
    val maxStopoverDays: Int = SearchPreferencesCodec.DEFAULT_MAX_STOPOVER_DAYS,
    val maxExtraPriceSgd: BigDecimal? = null,
    val originSelectionSource: OriginSelectionSource = OriginSelectionSource.MANUAL,
    val updatedAt: Instant = Instant.EPOCH,
    val schemaVersion: Int = SearchPreferencesCodec.SCHEMA_VERSION,
)

/** 推算结果：日期 + 为什么是这个日期。 */
data class DepartureDateDecision(val date: LocalDate, val source: DepartureDateSource) {
    /** 系统自动调整过（需要展示「建议」标签，且只展示一次）。 */
    val autoAdjusted: Boolean get() = source != DepartureDateSource.RESTORED_CACHED
}

/**
 * 智能出发日期（方案 §5）。纯函数式、可注入 today，绝不使用 AI 生成默认日期：
 *
 * 1. 缓存日期在 `today+1 … today+365` → 原样恢复；
 * 2. 已过期且有历史提前天数 → `clamp(leadDays, 7, 180)` 后向后移动到偏好星期；
 * 3. 已过期但无合法提前天数 → 至少 21 天后的「同一星期」；
 * 4. 无日期历史（首次打开）→ 至少 21 天后的第一个周五。
 *
 * 任何解析异常/设备日期异常都由调用方兜底为第 4 条（见 [resolveSafely]）。
 */
class SmartDepartureDateResolver(private val today: () -> LocalDate = { LocalDate.now() }) {

    fun resolve(
        cachedDate: LocalDate?,
        preferredLeadDays: Int?,
        preferredDepartureDayOfWeek: Int?,
    ): DepartureDateDecision {
        val t = runCatching { today() }.getOrElse { MIN_SANE_TODAY }
        // 设备时钟异常（早于本产品立项年）时退到确定性默认，避免推出无意义日期。
        if (t < MIN_SANE_TODAY) return defaultFriday(MIN_SANE_TODAY)

        if (cachedDate != null) {
            val tomorrow = t.plusDays(1)
            val horizon = t.plusDays(MAX_SELECTABLE_DAYS.toLong())
            if (cachedDate in tomorrow..horizon) {
                return DepartureDateDecision(cachedDate, DepartureDateSource.RESTORED_CACHED)
            }
            // 历史提前天数按 §5.2 收敛到 7…180 天（400 天的极端习惯取 180，3 天取 7），而不是整条丢弃。
            val lead = preferredLeadDays?.coerceIn(MIN_LEAD_DAYS, MAX_LEAD_DAYS)
            return if (lead != null) {
                val candidate = t.plusDays(lead.toLong())
                val dow = preferredDepartureDayOfWeek?.let { dayOfWeekOf(it) }
                val rolled = if (dow == null) candidate else nextOnOrAfter(candidate, dow)
                DepartureDateDecision(cap(rolled, t), DepartureDateSource.ROLLED_FROM_LEAD_DAYS)
            } else {
                // 优先级 3：以过期日期自己的星期为准（“至少 21 天后的同一星期”）。
                val candidate = t.plusDays(DEFAULT_LEAD_DAYS.toLong())
                DepartureDateDecision(
                    nextOnOrAfter(candidate, cachedDate.dayOfWeek).let { cap(it, t) },
                    DepartureDateSource.ROLLED_SAME_WEEKDAY,
                )
            }
        }
        return defaultFriday(t)
    }

    /** 无历史/解析失败共用的兜底：至少 21 天后的第一个周五。 */
    fun defaultFriday(from: LocalDate = runCatching { today() }.getOrElse { MIN_SANE_TODAY }) =
        DepartureDateDecision(
            nextOnOrAfter(from.plusDays(DEFAULT_LEAD_DAYS.toLong()), DayOfWeek.FRIDAY),
            DepartureDateSource.DEFAULT_FIRST_FRIDAY,
        )

    /** 吞掉一切异常（含脏缓存字符串）后走第 4 级兜底，保证「不崩溃、不选过去日期」。 */
    fun resolveSafely(
        cachedDateText: String?,
        preferredLeadDays: Int?,
        preferredDepartureDayOfWeek: Int?,
    ): DepartureDateDecision {
        if (cachedDateText.isNullOrBlank()) return defaultFriday()
        val cached = runCatching { LocalDate.parse(cachedDateText.trim()) }.getOrNull()
            ?: return defaultFriday()
        return runCatching { resolve(cached, preferredLeadDays, preferredDepartureDayOfWeek) }
            .getOrElse { defaultFriday() }
    }

    private fun cap(date: LocalDate, t: LocalDate): LocalDate {
        val notPast = if (date.isBefore(t.plusDays(1))) t.plusDays(1) else date
        val horizon = t.plusDays(MAX_SELECTABLE_DAYS.toLong())
        return if (notPast.isAfter(horizon)) horizon else notPast
    }

    companion object {
        const val MIN_LEAD_DAYS = 7
        const val DEFAULT_LEAD_DAYS = 21
        const val MAX_LEAD_DAYS = 180
        const val MAX_SELECTABLE_DAYS = 365

        /** 设备时钟明显异常（早于本产品立项年）时的基线日。 */
        private val MIN_SANE_TODAY: LocalDate = LocalDate.of(2024, 1, 1)

        /** candidate 当天或之后第一个 [dayOfWeek]（同星期视为已命中，不额外 +7）。 */
        fun nextOnOrAfter(candidate: LocalDate, dayOfWeek: DayOfWeek): LocalDate {
            val delta = (dayOfWeek.value - candidate.dayOfWeek.value + 7) % 7
            return candidate.plusDays(delta.toLong())
        }

        /** ISO 序号 → DayOfWeek；越界返回 null（调用方按“无偏好”处理）。 */
        fun dayOfWeekOf(iso: Int): DayOfWeek? = DayOfWeek.values().firstOrNull { it.value == iso }

        /** 供 UI 计算「建议」文案与新的 preferredLeadDays。 */
        fun leadDaysUntil(date: LocalDate, from: LocalDate = LocalDate.now()): Int? {
            val days = java.time.temporal.ChronoUnit.DAYS.between(from, date)
            return if (days in 0..Int.MAX_VALUE.toLong()) days.toInt() else null
        }
    }
}

/** 缓存编解码：字符串字段 + 严格校验，任何异常都返回 null（页面用默认值，不崩溃）。 */
object SearchPreferencesCodec {
    const val SCHEMA_VERSION = 1
    const val MIN_SUPPORTED_VERSION = 1
    const val DEFAULT_MIN_STOPOVER_DAYS = 1
    const val DEFAULT_MAX_STOPOVER_DAYS = 3

    private val json = kotlinx.serialization.json.Json { ignoreUnknownKeys = true }

    fun encode(prefs: CachedSearchPreferences): String = json.encodeToString(
        SearchPreferencesWire.serializer(),
        SearchPreferencesWire(
            schemaVersion = SCHEMA_VERSION,
            originCityCode = prefs.originCityCode,
            originAirportCodes = prefs.originAirportCodes,
            destinationCityCode = prefs.destinationCityCode,
            destinationAirportCodes = prefs.destinationAirportCodes,
            departureDate = prefs.departureDate?.toString(),
            preferredLeadDays = prefs.preferredLeadDays,
            preferredDepartureDayOfWeek = prefs.preferredDepartureDayOfWeek,
            minStopoverDays = prefs.minStopoverDays,
            maxStopoverDays = prefs.maxStopoverDays,
            maxExtraPriceSgd = prefs.maxExtraPriceSgd?.toPlainString(),
            originSelectionSource = prefs.originSelectionSource.name,
            updatedAt = prefs.updatedAt.toString(),
        ),
    )

    /** 解析失败/版本不识别/字段非法一律返回 null；半损坏时字段级回退到默认值。 */
    fun decode(raw: String?): CachedSearchPreferences? {
        if (raw.isNullOrBlank()) return null
        val wire = runCatching { json.decodeFromString<SearchPreferencesWire>(raw) }.getOrNull() ?: return null
        if (wire.schemaVersion < MIN_SUPPORTED_VERSION || wire.schemaVersion > SCHEMA_VERSION) return null
        val date = wire.departureDate?.let {
            runCatching { LocalDate.parse(it) }.getOrNull()
        }
        val updated = runCatching { wire.updatedAt?.let { Instant.parse(it) } }.getOrNull()
        val minStop = wire.minStopoverDays.coerceIn(1, 7)
        val maxStop = wire.maxStopoverDays.coerceIn(minStop, 7)
        return CachedSearchPreferences(
            originCityCode = wire.originCityCode?.trim()?.uppercase()?.ifBlank { null },
            originAirportCodes = wire.originAirportCodes.map { it.trim().uppercase() }
                .filter { it.length == 3 }.distinct(),
            destinationCityCode = wire.destinationCityCode?.trim()?.uppercase()?.ifBlank { null },
            destinationAirportCodes = wire.destinationAirportCodes.map { it.trim().uppercase() }
                .filter { it.length == 3 }.distinct(),
            departureDate = date,
            preferredLeadDays = wire.preferredLeadDays?.takeIf { it in 0..SmartDepartureDateResolver.MAX_SELECTABLE_DAYS },
            preferredDepartureDayOfWeek = wire.preferredDepartureDayOfWeek?.takeIf { it in 1..7 },
            minStopoverDays = minStop,
            maxStopoverDays = maxStop,
            maxExtraPriceSgd = wire.maxExtraPriceSgd?.let { parseDecimal(it) },
            originSelectionSource = runCatching { OriginSelectionSource.valueOf(wire.originSelectionSource) }
                .getOrDefault(OriginSelectionSource.MANUAL),
            updatedAt = updated ?: Instant.EPOCH,
            schemaVersion = wire.schemaVersion,
        )
    }

    private fun parseDecimal(text: String): BigDecimal? = runCatching {
        BigDecimal(text.trim()).abs().setScale(2, java.math.RoundingMode.HALF_UP)
    }.getOrNull()
}
