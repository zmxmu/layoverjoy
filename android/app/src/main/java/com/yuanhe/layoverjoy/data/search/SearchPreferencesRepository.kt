package com.yuanhe.layoverjoy.data.search

import com.yuanhe.layoverjoy.data.StringPrefStore
import com.yuanhe.layoverjoy.data.catalog.CatalogCity
import com.yuanhe.layoverjoy.data.catalog.LocationCatalog
import com.yuanhe.layoverjoy.data.catalog.LocationSelection
import com.yuanhe.layoverjoy.data.catalog.LocationSelectionMode
import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate

/**
 * 搜索设置缓存读写（方案 §4）。刻意复用 SessionStore 所在的那一个 Preferences DataStore，
 * 不引入 Room/SharedPreferences 第二套缓存；只多一个按 userId 隔离的字符串键。
 *
 * key：`search_preferences_v1_{userId}`；未登录用 `guest` 命名空间（§4.2）。
 * 登出**不删**这些键：同一个账号下次登录仍可恢复（§4.2 第 4 条）。
 */
class SearchPreferencesRepository(
    private val store: StringPrefStore,
    private val clock: () -> Instant = { Instant.now() },
) {

    /** 读不到、解析失败或版本不认识一律返回 null，调用方走默认值。 */
    suspend fun load(userId: String?): CachedSearchPreferences? = runCatching {
        SearchPreferencesCodec.decode(store.read(keyFor(userId)))
    }.getOrNull()

    suspend fun save(userId: String?, prefs: CachedSearchPreferences) {
        val stamped = prefs.copy(updatedAt = clock(), schemaVersion = SearchPreferencesCodec.SCHEMA_VERSION)
        runCatching { store.write(keyFor(userId), SearchPreferencesCodec.encode(stamped)) }
        // 写失败（磁盘/损坏）不影响搜索功能：下次进入页面用默认值即可。
    }

    suspend fun saveForm(userId: String?, form: SearchFormState) =
        save(userId, SearchPreferencesMapper.toCached(form))

    /** 仅清除当前命名空间的缓存（开发页/未来「重置偏好」用）。 */
    suspend fun clear(userId: String?) = runCatching { store.delete(keyFor(userId)) }

    companion object {
        const val KEY_PREFIX = "search_preferences_v1_"
        const val GUEST_NAMESPACE = "guest"

        /** userId 为空/空白时落 guest 命名空间；有值时原样作为后缀（服务端 UUID，不含邮箱）。 */
        fun keyFor(userId: String?): String =
            KEY_PREFIX + (userId?.trim()?.ifBlank { null } ?: GUEST_NAMESPACE)
    }
}

/** 搜索页当前表单的状态快照（保存与恢复的双向中间表示）。 */
data class SearchFormState(
    val origin: LocationSelection? = null,
    val destination: LocationSelection? = null,
    val departureDate: LocalDate? = null,
    val minStopoverDays: Int = SearchPreferencesCodec.DEFAULT_MIN_STOPOVER_DAYS,
    val maxStopoverDays: Int = SearchPreferencesCodec.DEFAULT_MAX_STOPOVER_DAYS,
    val maxExtraPriceSgd: BigDecimal? = null,
    val originSelectionSource: OriginSelectionSource = OriginSelectionSource.MANUAL,
)

/**
 * 表单 ↔ 缓存 的纯映射。目录解析以函数注入，因此这一层可在纯 JVM 单测里跑（不依赖 Android/Context）。
 *
 * 城市代码口径：优先 `metroCode`（IATA 城市码，如 SIN/KUL/BKK），无城市码时用主门户机场码。
 * 机场列表口径：空列表 = 全市机场（ALL_AIRPORTS）；非空 = 只选这些机场。
 */
object SearchPreferencesMapper {

    fun cityCodeOf(city: CatalogCity): String =
        city.metroCode?.trim()?.takeIf { it.isNotEmpty() } ?: city.defaultAirportIata.trim()

    fun toCached(
        form: SearchFormState,
        cityById: (String?) -> CatalogCity? = { LocationCatalog.city(it) },
        base: CachedSearchPreferences = CachedSearchPreferences(),
    ): CachedSearchPreferences {
        val originCity = cityById(form.origin?.cityId)
        val destCity = cityById(form.destination?.cityId)
        val date = form.departureDate
        val today = runCatching { LocalDate.now() }.getOrNull()
        return base.copy(
            originCityCode = originCity?.let { cityCodeOf(it) }?.takeIf { it.isNotEmpty() },
            originAirportCodes = form.origin?.airportIata?.let { listOf(it) } ?: emptyList(),
            destinationCityCode = destCity?.let { cityCodeOf(it) }?.takeIf { it.isNotEmpty() },
            destinationAirportCodes = form.destination?.airportIata?.let { listOf(it) } ?: emptyList(),
            departureDate = date,
            preferredLeadDays = if (date != null && today != null) {
                SmartDepartureDateResolver.leadDaysUntil(date, today)
            } else {
                base.preferredLeadDays
            },
            preferredDepartureDayOfWeek = date?.dayOfWeek?.value ?: base.preferredDepartureDayOfWeek,
            minStopoverDays = form.minStopoverDays.coerceAtLeast(1),
            maxStopoverDays = maxOf(form.maxStopoverDays, form.minStopoverDays.coerceAtLeast(1)),
            maxExtraPriceSgd = form.maxExtraPriceSgd,
            originSelectionSource = form.originSelectionSource,
        )
    }

    /**
     * 缓存 → 表单。城市代码在当前目录里找不到时（目录换版/该城市被移除）返回 null 选择，
     * 页面按「未选择」展示，绝不崩，也不会把不可搜的代码提交给后端。
     */
    fun toForm(
        cached: CachedSearchPreferences,
        cityByCode: (String) -> CatalogCity? = { LocationCatalog.cityByCode(it) },
    ): SearchFormState = SearchFormState(
        origin = cached.originCityCode?.let { selection(it, cached.originAirportCodes, cityByCode) },
        destination = cached.destinationCityCode?.let { selection(it, cached.destinationAirportCodes, cityByCode) },
        departureDate = cached.departureDate,
        minStopoverDays = cached.minStopoverDays,
        maxStopoverDays = cached.maxStopoverDays,
        maxExtraPriceSgd = cached.maxExtraPriceSgd,
        originSelectionSource = cached.originSelectionSource,
    )

    private fun selection(
        cityCode: String,
        airportCodes: List<String>,
        cityByCode: (String) -> CatalogCity?,
    ): LocationSelection? {
        val city = cityByCode(cityCode) ?: return null
        val airport = airportCodes.firstOrNull { code -> city.airports.any { it.iata == code } }
        return if (airport == null) {
            LocationSelection(city.cityId, LocationSelectionMode.ALL_AIRPORTS)
        } else {
            LocationSelection(city.cityId, LocationSelectionMode.AIRPORT, airport)
        }
    }
}
