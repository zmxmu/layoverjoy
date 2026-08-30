package com.yuanhe.layoverjoy.data.location

import com.yuanhe.layoverjoy.data.catalog.CatalogAirport
import com.yuanhe.layoverjoy.data.catalog.CatalogCity
import kotlin.math.PI
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.sin
import kotlin.math.sqrt

/**
 * 一次性的本机大概位置。**只在内存中存在**：不写 DataStore、不进日志、不上传后端（方案 §7.3）。
 */
data class GeoPoint(val latitude: Double, val longitude: Double) {
    val isValid: Boolean
        get() = !latitude.isNaN() && !longitude.isNaN() &&
            latitude in -90.0..90.0 && longitude in -180.0..180.0
}

/** 一次候选：城市 + 其中的某个机场 + 直线距离（公里）。 */
data class NearbyCandidate(
    val city: CatalogCity,
    val airport: CatalogAirport,
    val distanceKm: Double,
)

/**
 * 附近机场匹配结果，对应方案 §7.2 的三档：
 * [CityMatched] 120km 内最近城市（同城多机场进二级列表）；
 * [Candidates] 120km 无城市时 250km 内最近三个可搜机场（要用户确认）；
 * [NoMatch] 连 250km 都没有；[CatalogUnavailable] 本地目录没加载成功。
 */
sealed class NearbyAirportResult {
    data class CityMatched(val city: CatalogCity, val airports: List<NearbyCandidate>) : NearbyAirportResult()
    data class Candidates(val items: List<NearbyCandidate>) : NearbyAirportResult()
    data object NoMatch : NearbyAirportResult()
    data object CatalogUnavailable : NearbyAirportResult()
}

/**
 * 本地 Haversine 匹配（方案 §7.2）：不联网、不调用任何地图/地理编码服务。
 * 目录以函数注入，因此纯 JVM 单测可以喂一个假城市表。
 */
class NearbyAirportMatcher(
    private val cities: () -> List<CatalogCity>,
    private val popularityRank: (String) -> Int = { 999 },
) {

    fun match(point: GeoPoint): NearbyAirportResult {
        if (!point.isValid) return NearbyAirportResult.NoMatch
        val catalog = cities()
        if (catalog.isEmpty()) return NearbyAirportResult.CatalogUnavailable

        // 1) 120km 内最近城市（按城市中心），命中后给出该城市全部可搜机场（按距离排序）。
        val cityHits = catalog.mapNotNull { city ->
            val clat = city.latitude ?: return@mapNotNull null
            val clng = city.longitude ?: return@mapNotNull null
            val d = haversineKm(point.latitude, point.longitude, clat, clng)
            city to d
        }.filter { it.second <= NEARBY_CITY_KM }
            .sortedWith(compareBy({ it.second }, { popularityRank(it.first.cityId) }))

        cityHits.firstOrNull()?.let { (city, distance) ->
            return NearbyAirportResult.CityMatched(city, rankedAirportsWithin(city, point, distance))
        }

        // 2) 250km 内最近三个可搜机场（同城不重复占位，但允许同一城市的第二个机场补充候选）。
        val fallback = catalog.flatMap { city ->
            city.airports.filter { it.atlasSearchEnabled }.mapNotNull { ap ->
                val d = ap.latitude?.let { lat ->
                    ap.longitude?.let { lng -> haversineKm(point.latitude, point.longitude, lat, lng) }
                } ?: return@mapNotNull null
                NearbyCandidate(city, ap, d)
            }
        }.filter { it.distanceKm <= FALLBACK_AIRPORT_KM }
            .sortedWith(
                compareBy<NearbyCandidate> { it.distanceKm }
                    .thenByDescending { it.airport.atlasSearchEnabled }
                    .thenBy { if (it.city.defaultAirportIata == it.airport.iata) 0 else 1 }
                    .thenBy { popularityRank(it.city.cityId) }
                    .thenBy { it.airport.iata },
            )
            .distinctBy { it.city.cityId + it.airport.iata }
            .take(MAX_CANDIDATES)

        return if (fallback.isEmpty()) NearbyAirportResult.NoMatch else NearbyAirportResult.Candidates(fallback)
    }

    /** 命中城市时列出该城市全部可搜机场；无坐标的机场按城市中心距离兜底排在其后。 */
    private fun rankedAirportsWithin(city: CatalogCity, point: GeoPoint, cityDistanceKm: Double): List<NearbyCandidate> =
        city.airports.filter { it.atlasSearchEnabled }.ifEmpty { city.airports }
            .map { ap ->
                val d = ap.latitude?.let { lat ->
                    ap.longitude?.let { lng -> haversineKm(point.latitude, point.longitude, lat, lng) }
                } ?: cityDistanceKm
                NearbyCandidate(city, ap, d)
            }
            .sortedWith(
                compareBy<NearbyCandidate> { it.distanceKm }
                    .thenBy { if (it.city.defaultAirportIata == it.airport.iata) 0 else 1 }
                    .thenBy { it.airport.iata },
            )

    companion object {
        const val NEARBY_CITY_KM = 120.0
        const val FALLBACK_AIRPORT_KM = 250.0
        const val MAX_CANDIDATES = 3
        private const val EARTH_RADIUS_KM = 6371.0088

        /** 球面直线距离（公里）；±180° 经线换算下仍正确，精度对本用途足够。 */
        fun haversineKm(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
            val dLat = toRadians(lat2 - lat1)
            val dLng = toRadians(lng2 - lng1)
            val a = sin2(dLat / 2) + cos(toRadians(lat1)) * cos(toRadians(lat2)) * sin2(dLng / 2)
            return 2 * EARTH_RADIUS_KM * asin(sqrt(minOf(1.0, a)))
        }

        private fun toRadians(degrees: Double): Double = degrees * PI / 180.0

        private fun sin2(x: Double): Double {
            val s = sin(x)
            return s * s
        }
    }
}
