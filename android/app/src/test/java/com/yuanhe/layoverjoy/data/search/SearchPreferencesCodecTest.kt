package com.yuanhe.layoverjoy.data.search

import java.math.BigDecimal
import java.time.Instant
import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * 缓存编解码（方案 §4.4 的容错要求）：坏 JSON / 不认识的结构都不能让搜索页崩溃，
 * 一律返回 null（= 当作没有缓存）；能救的字段则字段级回退到安全值。
 */
class SearchPreferencesCodecTest {

    private val sample = CachedSearchPreferences(
        originCityCode = "SIN",
        originAirportCodes = listOf("SIN"),
        destinationCityCode = "KUL",
        destinationAirportCodes = emptyList(),
        departureDate = LocalDate.of(2026, 9, 25),
        preferredLeadDays = 26,
        preferredDepartureDayOfWeek = 5,
        minStopoverDays = 2,
        maxStopoverDays = 4,
        maxExtraPriceSgd = BigDecimal("150.50"),
        originSelectionSource = OriginSelectionSource.CURRENT_LOCATION,
        updatedAt = Instant.parse("2026-08-30T02:00:00Z"),
    )

    @Test
    fun `encode then decode round trips every field`() {
        val back = SearchPreferencesCodec.decode(SearchPreferencesCodec.encode(sample))
        assertNotNull(back)
        assertEquals(sample, back)
    }

    @Test
    fun `blank or missing raw text means no cache`() {
        assertNull(SearchPreferencesCodec.decode(null))
        assertNull(SearchPreferencesCodec.decode(""))
        assertNull(SearchPreferencesCodec.decode("   "))
    }

    @Test
    fun `malformed json returns null instead of throwing`() {
        for (bad in listOf("{", "not json", "[]", "{\"schemaVersion\":")) {
            assertNull("input=$bad", SearchPreferencesCodec.decode(bad))
        }
    }

    @Test
    fun `unknown schema versions are rejected both ways`() {
        assertNull(SearchPreferencesCodec.decode("""{"schemaVersion":2}"""))
        assertNull(SearchPreferencesCodec.decode("""{"schemaVersion":0}"""))
        // 未来版本降级为「无缓存」，页面回到默认值而不是读半截数据。
        assertNull(SearchPreferencesCodec.decode("""{"schemaVersion":99,"originCityCode":"SIN"}"""))
    }

    @Test
    fun `unknown extra json keys are ignored`() {
        val raw = """{"schemaVersion":1,"originCityCode":"SIN","futureField":{"a":1}}"""
        val decoded = SearchPreferencesCodec.decode(raw)
        assertNotNull(decoded)
        assertEquals("SIN", decoded?.originCityCode)
    }

    @Test
    fun `airport codes are normalized trimmed deduped and length checked`() {
        val raw = """
            {"schemaVersion":1,"originCityCode":"  sin ",
             "originAirportCodes":["sin","SIN","TGN","X",""]}
        """.trimIndent()
        val decoded = SearchPreferencesCodec.decode(raw)
        assertEquals("SIN", decoded?.originCityCode)
        assertEquals(listOf("SIN", "TGN"), decoded?.originAirportCodes)
    }

    @Test
    fun `blank city codes collapse to null`() {
        val decoded = SearchPreferencesCodec.decode("""{"schemaVersion":1,"originCityCode":"   "}""")
        assertNull(decoded?.originCityCode)
    }

    @Test
    fun `stopover days are coerced so min never exceeds max`() {
        val decoded = SearchPreferencesCodec.decode("""{"schemaVersion":1,"minStopoverDays":9,"maxStopoverDays":0}""")
        assertEquals(7, decoded?.minStopoverDays)
        assertEquals(7, decoded?.maxStopoverDays)

        val reversed = SearchPreferencesCodec.decode("""{"schemaVersion":1,"minStopoverDays":3,"maxStopoverDays":1}""")
        assertEquals(3, reversed?.minStopoverDays)
        assertEquals(3, reversed?.maxStopoverDays)
    }

    @Test
    fun `illegal date and lead days degrade to null fields`() {
        val decoded = SearchPreferencesCodec.decode(
            """{"schemaVersion":1,"departureDate":"2026-13-45","preferredLeadDays":-5,"preferredDepartureDayOfWeek":9}""",
        )
        assertNull(decoded?.departureDate)
        assertNull(decoded?.preferredLeadDays)
        assertNull(decoded?.preferredDepartureDayOfWeek)
    }

    @Test
    fun `lead days beyond the selectable horizon are dropped`() {
        assertNull(SearchPreferencesCodec.decode("""{"schemaVersion":1,"preferredLeadDays":9999}""")?.preferredLeadDays)
        assertEquals(
            365,
            SearchPreferencesCodec.decode("""{"schemaVersion":1,"preferredLeadDays":365}""")?.preferredLeadDays,
        )
    }

    @Test
    fun `negative budget text is stored as a positive amount`() {
        val decoded = SearchPreferencesCodec.decode("""{"schemaVersion":1,"maxExtraPriceSgd":"-120.30"}""")
        assertEquals(BigDecimal("120.30"), decoded?.maxExtraPriceSgd)

        assertNull(SearchPreferencesCodec.decode("""{"schemaVersion":1,"maxExtraPriceSgd":"abc"}""")?.maxExtraPriceSgd)
    }

    @Test
    fun `unknown origin source falls back to manual`() {
        val decoded = SearchPreferencesCodec.decode("""{"schemaVersion":1,"originSelectionSource":"SATELLITE"}""")
        assertEquals(OriginSelectionSource.MANUAL, decoded?.originSelectionSource)

        val ok = SearchPreferencesCodec.decode("""{"schemaVersion":1,"originSelectionSource":"CURRENT_LOCATION"}""")
        assertEquals(OriginSelectionSource.CURRENT_LOCATION, ok?.originSelectionSource)
    }

    @Test
    fun `missing or broken updatedAt degrades to epoch`() {
        assertEquals(Instant.EPOCH, SearchPreferencesCodec.decode("""{"schemaVersion":1}""")?.updatedAt)
        assertEquals(
            Instant.EPOCH,
            SearchPreferencesCodec.decode("""{"schemaVersion":1,"updatedAt":"yesterday"}""")?.updatedAt,
        )
    }
}
