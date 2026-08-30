package com.yuanhe.layoverjoy.data.search

import com.yuanhe.layoverjoy.data.catalog.CatalogAirport
import com.yuanhe.layoverjoy.data.catalog.CatalogCity
import com.yuanhe.layoverjoy.data.catalog.LocationSelection
import com.yuanhe.layoverjoy.data.catalog.LocationSelectionMode
import java.math.BigDecimal
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 表单 ↔ 缓存映射（方案 §4.1 的字段口径）。目录查询以 lambda 注入，
 * 因此这些断言跑在纯 JVM 上，不碰 Android assets。
 */
class SearchPreferencesMapperTest {

    private val sin = CatalogCity(
        cityId = "sg-singapore",
        countryCode = "SG",
        nameZh = "新加坡",
        nameEn = "Singapore",
        latitude = 1.3521,
        longitude = 103.8198,
        metroCode = "SIN",
        defaultAirportIata = "SIN",
        airports = listOf(
            CatalogAirport(iata = "SIN", nameZh = "樟宜", nameEn = "Changi", latitude = 1.3644, longitude = 103.9915, atlasSearchEnabled = true),
            CatalogAirport(iata = "XSP", nameZh = "实里达", nameEn = "Seletar", atlasSearchEnabled = true),
        ),
    )

    private val kul = CatalogCity(
        cityId = "my-kuala-lumpur",
        countryCode = "MY",
        nameZh = "吉隆坡",
        nameEn = "Kuala Lumpur",
        metroCode = "KUL",
        defaultAirportIata = "KUL",
        airports = listOf(CatalogAirport(iata = "KUL", nameZh = "国际机场", nameEn = "International", atlasSearchEnabled = true)),
    )

    /** 无 metroCode 的城市（如部分单机场城市）：退到主门户机场码。 */
    private val pen = CatalogCity(
        cityId = "my-penang",
        countryCode = "MY",
        nameZh = "槟城",
        nameEn = "Penang",
        metroCode = null,
        defaultAirportIata = "PEN",
        airports = listOf(CatalogAirport(iata = "PEN", nameZh = "槟城", nameEn = "Penang", atlasSearchEnabled = true)),
    )

    private val catalog = listOf(sin, kul, pen)
    private val byId: (String?) -> CatalogCity? = { id -> catalog.firstOrNull { it.cityId == id } }
    private val byCode: (String) -> CatalogCity? = { code -> catalog.firstOrNull { it.metroCode == code || it.defaultAirportIata == code } }

    @Test
    fun `city code prefers metro code and falls back to the main gateway`() {
        assertEquals("SIN", SearchPreferencesMapper.cityCodeOf(sin))
        assertEquals("PEN", SearchPreferencesMapper.cityCodeOf(pen))
    }

    @Test
    fun `form with all-airports selection caches an empty airport list`() {
        val cached = SearchPreferencesMapper.toCached(
            SearchFormState(
                origin = LocationSelection(sin.cityId, LocationSelectionMode.ALL_AIRPORTS),
                destination = LocationSelection(kul.cityId, LocationSelectionMode.ALL_AIRPORTS),
            ),
            cityById = byId,
        )
        assertEquals("SIN", cached.originCityCode)
        assertEquals(emptyList<String>(), cached.originAirportCodes)
        assertEquals("KUL", cached.destinationCityCode)
        assertEquals(emptyList<String>(), cached.destinationAirportCodes)
    }

    @Test
    fun `single airport selection is cached as a one element list`() {
        val cached = SearchPreferencesMapper.toCached(
            SearchFormState(origin = LocationSelection(sin.cityId, LocationSelectionMode.AIRPORT, "XSP")),
            cityById = byId,
        )
        assertEquals(listOf("XSP"), cached.originAirportCodes)
    }

    @Test
    fun `city missing from the catalog caches null instead of a stale code`() {
        val cached = SearchPreferencesMapper.toCached(
            SearchFormState(origin = LocationSelection("zz-removed", LocationSelectionMode.ALL_AIRPORTS)),
            cityById = byId,
        )
        assertNull(cached.originCityCode)
        assertNull(cached.destinationCityCode)
    }

    @Test
    fun `lead days and weekday are derived from the cached date`() {
        val today = LocalDate.of(2026, 8, 30)
        val cached = SearchPreferencesMapper.toCached(
            SearchFormState(departureDate = today.plusDays(26)), // 2026-09-25 周五
            cityById = byId,
        )
        // 提前天数依赖真实时钟，只断言稳定可推的星期。
        assertEquals(5, cached.preferredDepartureDayOfWeek)
        assertEquals(today.plusDays(26), cached.departureDate)
    }

    @Test
    fun `absent date keeps the previous habit signals`() {
        val base = CachedSearchPreferences(preferredLeadDays = 14, preferredDepartureDayOfWeek = 3)
        val cached = SearchPreferencesMapper.toCached(SearchFormState(), cityById = byId, base = base)
        assertNull(cached.departureDate)
        assertEquals(14, cached.preferredLeadDays)
        assertEquals(3, cached.preferredDepartureDayOfWeek)
    }

    @Test
    fun `stopover range is normalized so min never exceeds max`() {
        val cached = SearchPreferencesMapper.toCached(
            SearchFormState(minStopoverDays = 0, maxStopoverDays = 2),
            cityById = byId,
        )
        assertEquals(1, cached.minStopoverDays)
        assertEquals(2, cached.maxStopoverDays)

        val flipped = SearchPreferencesMapper.toCached(
            SearchFormState(minStopoverDays = 5, maxStopoverDays = 3),
            cityById = byId,
        )
        assertEquals(5, flipped.minStopoverDays)
        assertEquals(5, flipped.maxStopoverDays)
    }

    @Test
    fun `round trip keeps origin destination date and source`() {
        val form = SearchFormState(
            origin = LocationSelection(sin.cityId, LocationSelectionMode.AIRPORT, "SIN"),
            destination = LocationSelection(kul.cityId, LocationSelectionMode.ALL_AIRPORTS),
            departureDate = LocalDate.of(2026, 9, 25),
            minStopoverDays = 2,
            maxStopoverDays = 6,
            maxExtraPriceSgd = BigDecimal("120.00"),
            originSelectionSource = OriginSelectionSource.CURRENT_LOCATION,
        )
        val cached = SearchPreferencesMapper.toCached(form, cityById = byId)
        val restored = SearchPreferencesMapper.toForm(cached, cityByCode = byCode)

        assertEquals(form.origin, restored.origin)
        assertEquals(form.destination, restored.destination)
        assertEquals(form.departureDate, restored.departureDate)
        assertEquals(form.minStopoverDays, restored.minStopoverDays)
        assertEquals(form.maxStopoverDays, restored.maxStopoverDays)
        assertEquals(form.maxExtraPriceSgd, restored.maxExtraPriceSgd)
        assertEquals(OriginSelectionSource.CURRENT_LOCATION, restored.originSelectionSource)
    }

    @Test
    fun `airport code absent from the city restores to all airports`() {
        val cached = CachedSearchPreferences(originCityCode = "SIN", originAirportCodes = listOf("XXX"))
        val restored = SearchPreferencesMapper.toForm(cached, cityByCode = byCode)
        assertEquals(LocationSelection(sin.cityId, LocationSelectionMode.ALL_AIRPORTS), restored.origin)
    }

    @Test
    fun `city code removed from the catalog restores to an unselected field`() {
        val cached = CachedSearchPreferences(originCityCode = "OSA", destinationCityCode = "OSA")
        val restored = SearchPreferencesMapper.toForm(cached, cityByCode = byCode)
        assertNull(restored.origin)
        assertNull(restored.destination)
        // 其余数值仍然可用，不让一个失效城市拖垮整份缓存。
        assertEquals(1, restored.minStopoverDays)
        assertEquals(3, restored.maxStopoverDays)
    }

    @Test
    fun `blank cache restores to an empty form`() {
        val restored = SearchPreferencesMapper.toForm(CachedSearchPreferences(), cityByCode = byCode)
        assertNull(restored.origin)
        assertNull(restored.destination)
        assertNull(restored.departureDate)
        assertEquals(OriginSelectionSource.MANUAL, restored.originSelectionSource)
    }
}
