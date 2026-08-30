package com.yuanhe.layoverjoy.data.search

import kotlinx.serialization.Serializable

/**
 * 落盘结构（方案 §4.1 的 13 个字段）。刻意全部用 String/Int/List<String>：
 * kotlinx.serialization 不带 java.time / BigDecimal 支持，用字符串既避免自写 serializer，
 * 也让缓存 JSON 在 DataStore 里肉眼可读、损坏时能安全降级为默认值。
 */
@Serializable
internal data class SearchPreferencesWire(
    val schemaVersion: Int = SearchPreferencesCodec.SCHEMA_VERSION,
    val originCityCode: String? = null,
    val originAirportCodes: List<String> = emptyList(),
    val destinationCityCode: String? = null,
    val destinationAirportCodes: List<String> = emptyList(),
    /** yyyy-MM-dd */
    val departureDate: String? = null,
    val preferredLeadDays: Int? = null,
    /** 1=周一 … 7=周日 */
    val preferredDepartureDayOfWeek: Int? = null,
    val minStopoverDays: Int = SearchPreferencesCodec.DEFAULT_MIN_STOPOVER_DAYS,
    val maxStopoverDays: Int = SearchPreferencesCodec.DEFAULT_MAX_STOPOVER_DAYS,
    /** 十进制字符串，避免浮点误差；单位 SGD */
    val maxExtraPriceSgd: String? = null,
    val originSelectionSource: String = OriginSelectionSource.MANUAL.name,
    /** ISO-8601 Instant */
    val updatedAt: String? = null,
)
