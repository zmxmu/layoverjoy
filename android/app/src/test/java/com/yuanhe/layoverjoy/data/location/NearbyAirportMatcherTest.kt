package com.yuanhe.layoverjoy.data.location

import com.yuanhe.layoverjoy.data.catalog.CatalogAirport
import com.yuanhe.layoverjoy.data.catalog.CatalogCity
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * 本地 Haversine 附近机场匹配（方案 §7.2）：120km 内命中城市、250km 内给候选、更远则无匹配。
 * 目录以 lambda 注入，全程不联网、不调用任何地图服务。
 */
class NearbyAirportMatcherTest {

    private val singapore = CatalogCity(
        cityId = "sg-singapore",
        countryCode = "SG",
        nameZh = "新加坡",
        nameEn = "Singapore",
        latitude = 1.3521,
        longitude = 103.8198,
        metroCode = "SIN",
        defaultAirportIata = "SIN",
        airports = listOf(
            CatalogAirport("SIN", "樟宜机场", "Changi", 1.3644, 103.9915, atlasSearchEnabled = true),
            // 目录里没有坐标的机场：按城市中心距离兜底，排在有坐标的主门户之后。
            CatalogAirport("XSP", "实里达机场", "Seletar", atlasSearchEnabled = true),
        ),
    )

    private val kualaLumpur = CatalogCity(
        cityId = "my-kuala-lumpur",
        countryCode = "MY",
        nameZh = "吉隆坡",
        nameEn = "Kuala Lumpur",
        latitude = 3.1390,
        longitude = 101.6869,
        metroCode = "KUL",
        defaultAirportIata = "KUL",
        airports = listOf(CatalogAirport("KUL", "吉隆坡国际机场", "KLIA", 2.7456, 101.7072, atlasSearchEnabled = true)),
    )

    private fun matcher(cities: List<CatalogCity> = listOf(singapore, kualaLumpur)) =
        NearbyAirportMatcher(cities = { cities }, popularityRank = { if (it == "sg-singapore") 0 else 5 })

    @Test
    fun `changi coordinates match singapore city`() {
        val result = matcher().match(GeoPoint(1.3644, 103.9915))
        val matched = result as NearbyAirportResult.CityMatched
        assertEquals("sg-singapore", matched.city.cityId)
        // 同城多机场进二级列表，主门户（有坐标、最近）排第一。
        assertEquals(listOf("SIN", "XSP"), matched.airports.map { it.airport.iata })
        assertTrue(matched.airports.first().distanceKm < 1.0)
    }

    @Test
    fun `city center coordinates also match within the 120km ring`() {
        val result = matcher().match(GeoPoint(1.3521, 103.8198))
        assertTrue(result is NearbyAirportResult.CityMatched)
    }

    @Test
    fun `beyond 120km but within 250km returns airport candidates to confirm`() {
        // (2.5, 103.9)：离新加坡市中心约 128km（超出城市环），但离樟宜约 127km、离 KLIA 约 244km。
        val result = matcher().match(GeoPoint(2.5, 103.9))
        val candidates = (result as NearbyAirportResult.Candidates).items
        assertEquals(listOf("SIN", "KUL"), candidates.map { it.airport.iata })
        assertTrue(candidates.first().distanceKm < candidates.last().distanceKm)
    }

    @Test
    fun `candidate list is capped at three`() {
        val result = matcher().match(GeoPoint(2.5, 103.9))
        assertTrue((result as NearbyAirportResult.Candidates).items.size <= NearbyAirportMatcher.MAX_CANDIDATES)
    }

    @Test
    fun `mid ocean coordinates have no match`() {
        assertEquals(NearbyAirportResult.NoMatch, matcher().match(GeoPoint(-40.0, -140.0)))
    }

    @Test
    fun `empty catalog reports catalog unavailable rather than no match`() {
        assertEquals(NearbyAirportResult.CatalogUnavailable, matcher(emptyList()).match(GeoPoint(1.3644, 103.9915)))
    }

    @Test
    fun `invalid coordinates are rejected before scanning the catalog`() {
        for (bad in listOf(GeoPoint(Double.NaN, 103.9), GeoPoint(1.3, Double.NaN), GeoPoint(91.0, 0.0), GeoPoint(0.0, 200.0))) {
            assertEquals(NearbyAirportResult.NoMatch, matcher().match(bad))
        }
    }

    @Test
    fun `cities without coordinates are skipped instead of crashing`() {
        val noCoords = singapore.copy(cityId = "xx-unknown", latitude = null, longitude = null, airports = emptyList())
        val result = matcher(listOf(noCoords, singapore)).match(GeoPoint(1.3644, 103.9915))
        assertEquals("sg-singapore", (result as NearbyAirportResult.CityMatched).city.cityId)
    }

    @Test
    fun `airports without atlas search support are not offered as candidates`() {
        val disabled = kualaLumpur.copy(
            airports = listOf(kualaLumpur.airports.first().copy(atlasSearchEnabled = false)),
        )
        val result = matcher(listOf(singapore, disabled)).match(GeoPoint(2.5, 103.9))
        assertEquals(listOf("SIN"), (result as NearbyAirportResult.Candidates).items.map { it.airport.iata })
    }

    @Test
    fun `haversine distance between singapore and kuala lumpur is about three hundred km`() {
        val km = NearbyAirportMatcher.haversineKm(1.3521, 103.8198, 3.1390, 101.6869)
        assertTrue("actual=$km", km in 290.0..330.0)
        // 同一点距离为 0，反向距离相等。
        assertEquals(0.0, NearbyAirportMatcher.haversineKm(1.3521, 103.8198, 1.3521, 103.8198), 1e-9)
        assertEquals(km, NearbyAirportMatcher.haversineKm(3.1390, 101.6869, 1.3521, 103.8198), 1e-9)
    }
}
