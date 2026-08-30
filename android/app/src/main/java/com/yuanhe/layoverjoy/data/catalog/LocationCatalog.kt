package com.yuanhe.layoverjoy.data.catalog

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json

/** 地点选择对象（12 号方案 §7.1）。显示名称/国家/机场列表一律按 cityId 从本地目录读取。 */
enum class LocationSelectionMode { ALL_AIRPORTS, AIRPORT }

@Serializable
data class LocationSelection(
    val cityId: String,
    val mode: LocationSelectionMode,
    val airportIata: String? = null,
)

@Serializable
data class CatalogAirport(
    val iata: String,
    val nameZh: String,
    val nameEn: String,
    /** 机场基准点经纬度（catalog 2.1.0 起提供；旧副本为 null，仅影响附近机场匹配）。 */
    val latitude: Double? = null,
    val longitude: Double? = null,
    /** 该机场可作为 Atlas Search 入参（目录即搜索能力边界，与后端 airports.controller 一致）。 */
    val atlasSearchEnabled: Boolean = false,
)

@Serializable
data class CatalogCity(
    val cityId: String,
    val countryCode: String,
    val nameZh: String,
    val nameEn: String,
    val searchAliases: List<String> = emptyList(),
    val timezone: String = "",
    /** 城市中心经纬度（近似值，只用于本机「附近机场」匹配，不上传也不落盘）。 */
    val latitude: Double? = null,
    val longitude: Double? = null,
    val metroCode: String? = null,
    val defaultAirportIata: String = "",
    val airports: List<CatalogAirport>,
)

@Serializable
data class CatalogCountry(
    val countryCode: String,
    val nameZh: String,
    val nameEn: String,
    val popularCityIds: List<String> = emptyList(),
    val cities: List<CatalogCity>,
)

@Serializable
data class CatalogContinent(
    val continentCode: String,
    val nameZh: String,
    val nameEn: String,
    val sortOrder: Int = 0,
    val popularCityIds: List<String> = emptyList(),
    val countries: List<CatalogCountry>,
)

@Serializable
data class CatalogJson(
    val schemaVersion: String,
    val catalogType: String = "",
    val disclaimerZh: String = "",
    val disclaimerEn: String = "",
    val popularCityIds: List<String> = emptyList(),
    val continents: List<CatalogContinent>,
)

/** 检索命中（与后端 §6 评分一致的离线实现）。 */
data class LocationSearchHit(
    val city: CatalogCity,
    val matchedBy: String,
    val matchedAirportIata: String?,
    val score: Int,
)

/**
 * 本地城市目录（离线可用）。assets 单一事实源由 scripts/sync-catalog.sh 与 Gradle syncCatalog 同步。
 * 启动时解析并建立扁平索引；校验 schemaVersion/重复 cityId/重复 IATA/空机场，失败阻止进入搜索。
 */
object LocationCatalog {

    private const val PREFS = "layoverjoy_recent_locations"
    private const val KEY_RECENT = "recent"
    private const val RECENT_MAX = 6

    private val json = Json { ignoreUnknownKeys = true }

    @Volatile
    var ready: Boolean = false
        private set

    @Volatile
    var loadError: String? = null
        private set

    var schemaVersion: String = ""
        private set
    var disclaimerZh: String = ""
        private set
    var disclaimerEn: String = ""
        private set
    var popularCityIds: List<String> = emptyList()
        private set
    var continents: List<CatalogContinent> = emptyList()
        private set

    private val cityById = HashMap<String, CatalogCity>()
    private val iataToCity = HashMap<String, CatalogCity>()
    private val countryByCode = HashMap<String, CatalogCountry>()
    private val continentByCity = HashMap<String, CatalogContinent>()
    private val countryByCity = HashMap<String, CatalogCountry>()
    private var allCities: List<CatalogCity> = emptyList()
    private var popularRank: Map<String, Int> = emptyMap()

    fun init(context: Context) {
        if (ready) return
        try {
            val raw = context.assets.open("catalog/city-airport-catalog.zh-en.json").bufferedReader().use { it.readText() }
            val parsed = json.decodeFromString<CatalogJson>(raw)
            require(parsed.schemaVersion.startsWith("2.")) { "unsupported schemaVersion ${parsed.schemaVersion}" }
            val seenCities = HashSet<String>()
            val seenIata = HashSet<String>()
            for (cont in parsed.continents) {
                for (ctry in cont.countries) {
                    countryByCode[ctry.countryCode] = ctry
                    for (c in ctry.cities) {
                        require(seenCities.add(c.cityId)) { "duplicate cityId ${c.cityId}" }
                        require(c.airports.isNotEmpty()) { "empty airports ${c.cityId}" }
                        for (a in c.airports) require(seenIata.add(a.iata)) { "duplicate IATA ${a.iata}" }
                        cityById[c.cityId] = c
                        continentByCity[c.cityId] = cont
                        countryByCity[c.cityId] = ctry
                    }
                }
            }
            schemaVersion = parsed.schemaVersion
            disclaimerZh = parsed.disclaimerZh
            disclaimerEn = parsed.disclaimerEn
            popularCityIds = parsed.popularCityIds
            continents = parsed.continents.sortedBy { it.sortOrder }
            popularRank = parsed.popularCityIds.withIndex().associate { (i, id) -> id to i }
            allCities = cityById.values.sortedBy { it.nameEn }
            ready = true
            loadError = null
        } catch (e: Exception) {
            ready = false
            loadError = e.message ?: "catalog load failed"
        }
    }

    fun city(cityId: String?): CatalogCity? = cityId?.let { cityById[it] }

    /**
     * 按 IATA 城市码（metroCode）反查城市；无 metroCode 的城市退到主门户机场码。
     * 城市码优先于机场码，保证搜索偏好缓存（存 metro 码）能稳定恢复到同一个城市。
     */
    fun cityByCode(code: String?): CatalogCity? {
        val c = code?.trim()?.uppercase()?.ifBlank { null } ?: return null
        if (!ready) return null
        return allCities.firstOrNull { it.metroCode?.uppercase() == c } ?: iataToCity[c]
    }
    fun country(code: String?): CatalogCountry? = code?.let { countryByCode[it] }
    fun countryOf(city: CatalogCity): CatalogCountry? = countryByCity[city.cityId]
    fun continentOf(city: CatalogCity): CatalogContinent? = continentByCity[city.cityId]

    /** 全量城市快照（附近机场匹配遍历用）；未 init 成功时返回空表。 */
    fun cities(): List<CatalogCity> = if (ready) allCities else emptyList()

    /** 热门榜名次（popularCityIds 序号，越小越热；不在榜上返回 999）。 */
    fun popularityRank(cityId: String): Int = popularRank[cityId] ?: 999

    fun popularCities(limit: Int = 12): List<CatalogCity> =
        popularCityIds.mapNotNull { cityById[it] }.take(limit)

    fun countryCityCount(continent: CatalogContinent): Int =
        continent.countries.sumOf { it.cities.size }

    /** 国家/地区城市列表：热门优先，其余按本地化名称排序。 */
    fun citiesOf(country: CatalogCountry, en: Boolean): List<CatalogCity> {
        val rank = country.popularCityIds.withIndex().associate { (i, id) -> id to i }
        return country.cities.sortedWith(
            compareBy<CatalogCity> { rank[it.cityId] ?: 999 }
                .thenBy { if (en) it.nameEn else it.nameZh },
        )
    }

    // ---------- 规范化与评分（与后端 catalog.ts 同规则） ----------

    private fun normalize(s: String): String {
        val sb = StringBuilder()
        for (ch in java.text.Normalizer.normalize(s, java.text.Normalizer.Form.NFKD)) {
            if (ch.isWhitespace() || ch == '-' || ch == '\'' || ch == '.') continue
            if (ch.code in 0x300..0x36f) continue
            sb.append(ch.lowercaseChar())
        }
        return sb.toString()
    }

    private fun hasCjk(s: String) = s.any { it in '一'..'鿿' }

    private fun lev1(a: String, b: String): Boolean {
        if (a == b) return true
        if (kotlin.math.abs(a.length - b.length) > 1) return false
        val (s, l) = if (a.length <= b.length) a to b else b to a
        var i = 0; var j = 0; var edits = 0
        while (i < s.length && j < l.length) {
            if (s[i] == l[j]) { i++; j++; continue }
            if (++edits > 1) return false
            if (s.length == l.length) { i++; j++ } else j++
        }
        return edits + (l.length - j) + (s.length - i) <= 1
    }

    fun search(qRaw: String, limit: Int = 20): List<LocationSearchHit> {
        val q = qRaw.trim()
        if (!ready || q.isEmpty()) return emptyList()
        val nq = normalize(q)
        val upper = q.uppercase()
        val cjk = hasCjk(q)
        val isIata = upper.length == 3 && upper.all { it.isLetter() }
        if (!cjk && nq.length < 2 && !isIata) return emptyList()

        val hits = ArrayList<LocationSearchHit>()
        for (city in allCities) {
            var score = 0
            var matchedBy: String? = null
            var matchedAirport: String? = null

            val iataHit = city.airports.firstOrNull { it.iata == upper }
            val metroHit = city.metroCode == upper
            when {
                iataHit != null && metroHit && city.airports.size == 1 -> { score = 1000; matchedBy = "AIRPORT_IATA"; matchedAirport = iataHit.iata }
                iataHit != null && metroHit -> { score = 990; matchedBy = "AMBIGUOUS_CODE"; matchedAirport = iataHit.iata }
                iataHit != null -> { score = 1000; matchedBy = "AIRPORT_IATA"; matchedAirport = iataHit.iata }
                metroHit -> { score = 980; matchedBy = "CITY_CODE" }
            }
            if (matchedBy == null && nq.isNotEmpty()) {
                val names = listOf(normalize(city.nameZh), normalize(city.nameEn)) + city.searchAliases.map { normalize(it) }
                val ap = city.airports.firstOrNull { a ->
                    val az = normalize(a.nameZh); val ae = normalize(a.nameEn)
                    az.startsWith(nq) || ae.startsWith(nq) || az.contains(nq) || ae.contains(nq)
                }
                val ctry = countryByCity[city.cityId]
                when {
                    names.any { it.isNotEmpty() && it == nq } -> { score = 950; matchedBy = "CITY_EXACT" }
                    names.any { it.isNotEmpty() && it.startsWith(nq) } -> { score = 850; matchedBy = "CITY_PREFIX" }
                    names.any { it.isNotEmpty() && it.contains(nq) } -> { score = 760; matchedBy = "CITY_CONTAINS" }
                    ap != null -> { score = 700; matchedBy = "AIRPORT_NAME"; matchedAirport = ap.iata }
                    ctry != null && (normalize(ctry.nameZh).contains(nq) || normalize(ctry.nameEn).contains(nq)) -> { score = 620; matchedBy = "COUNTRY" }
                    !cjk && nq.length >= 4 && names.any { it.isNotEmpty() && lev1(nq, it) } -> { score = 520; matchedBy = "FUZZY" }
                }
            }
            if (matchedBy == null || score == 0) continue
            // 机场名独立词命中（pudong/浦东/hongqiao…）且不是城市名前缀：补充 matchedAirport。
            if (matchedAirport == null && nq.isNotEmpty()) {
                val cityPrefix = normalize(city.nameEn).startsWith(nq) || normalize(city.nameZh).startsWith(nq)
                if (!cityPrefix) {
                    val ap = city.airports.firstOrNull { a ->
                        val tokens = a.nameEn.lowercase().split(Regex("[^a-z]+")).filter { it.length >= 2 }
                        tokens.contains(nq) || (cjk && q.trim().length >= 2 && a.nameZh.contains(q.trim()))
                    }
                    if (ap != null) matchedAirport = ap.iata
                }
            }
            val rank = popularRank[city.cityId]
            if (rank != null && score < 1000) score += minOf(40, 990 - score)
            hits.add(LocationSearchHit(city, matchedBy, matchedAirport, score))
        }
        return hits.sortedWith(
            compareByDescending<LocationSearchHit> { it.score }
                .thenBy { popularRank[it.city.cityId] ?: 999 }
                .thenBy { it.city.nameEn },
        ).take(limit)
    }

    // ---------- 最近选择（只存 cityId+mode+airportIata，≤6） ----------

    fun recent(context: Context): List<LocationSelection> {
        val raw = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(KEY_RECENT, null) ?: return emptyList()
        return try {
            json.decodeFromString<List<LocationSelection>>(raw)
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun record(context: Context, sel: LocationSelection) {
        val list = mutableListOf(sel) + recent(context).filterNot {
            it.cityId == sel.cityId && it.mode == sel.mode && it.airportIata == sel.airportIata
        }
        val trimmed = list.take(RECENT_MAX)
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putString(KEY_RECENT, json.encodeToString(kotlinx.serialization.builtins.ListSerializer(LocationSelection.serializer()), trimmed))
            .apply()
    }
}
