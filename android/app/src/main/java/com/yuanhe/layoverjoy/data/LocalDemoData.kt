package com.yuanhe.layoverjoy.data

import com.yuanhe.layoverjoy.ui.i18n.AppLanguage
import com.yuanhe.layoverjoy.ui.i18n.L10n

/**
 * 首页本地演示数据。
 * 契约要求：首页原型仅使用本地数据展示，不请求网络、不上传任何证件信息。
 * 登录并连接后端后，搜索/结果/监控/预订均走真实接口。
 * 文案双语：字段同时提供中/英版本，按当前语言取用。
 */
data class LocalCityCard(
    val cityId: String,
    val cityNameZh: String,
    val cityNameEn: String,
    val countryCode: String,
    val iata: String,            // 点击灵感卡预填到搜索页的目的地码
    val entryLabelZh: String,    // 入境规则摘要（本地示例文案）
    val entryLabelEn: String,
    val joyScore: Int,
    val stayDays: Int,
    val highlightZh: String,
    val highlightEn: String,
) {
    val entryLabel: String get() = if (L10n.current == AppLanguage.EN) entryLabelEn else entryLabelZh
    val highlight: String get() = if (L10n.current == AppLanguage.EN) highlightEn else highlightZh
    val displayName: String get() = if (L10n.current == AppLanguage.EN) cityNameEn else cityNameZh
}

data class LocalAgentActivity(val time: String, val text: String)

object LocalDemoData {

    val cities = listOf(
        LocalCityCard(
            cityId = "my-kuala-lumpur",
            cityNameZh = "吉隆坡",
            cityNameEn = "Kuala Lumpur",
            countryCode = "MY",
            iata = "KUL",
            entryLabelZh = "中国普通护照免签停留 30 天",
            entryLabelEn = "Visa-free 30 days for CN ordinary passports",
            joyScore = 92,
            stayDays = 2,
            highlightZh = "双子塔夜景 + 茨厂街美食，机场快线 28 分钟直达市区",
            highlightEn = "Petronas Towers night view + Petaling Street food; KLIA Express reaches downtown in 28 minutes",
        ),
        LocalCityCard(
            cityId = "th-bangkok",
            cityNameZh = "曼谷",
            cityNameEn = "Bangkok",
            countryCode = "TH",
            iata = "BKK",
            entryLabelZh = "中泰互免签证 30 天",
            entryLabelEn = "Mutual CN–TH visa exemption, 30 days",
            joyScore = 88,
            stayDays = 2,
            highlightZh = "大皇宫与湄南河夜游，把转机变成一次短途旅行",
            highlightEn = "Grand Palace and a Chao Phraya night cruise — turn a layover into a mini trip",
        ),
        LocalCityCard(
            cityId = "hk-hong-kong",
            cityNameZh = "中国香港",
            cityNameEn = "Hong Kong",
            countryCode = "HK",
            iata = "HKG",
            entryLabelZh = "凭联程机票可过境停留 7 天",
            entryLabelEn = "7-day transit stay with an onward ticket",
            joyScore = 84,
            stayDays = 1,
            highlightZh = "维港天际线与茶餐厅，适合 24 小时闪电停留",
            highlightEn = "Victoria Harbour skyline and cha chaan teng — perfect for a 24-hour flash stay",
        ),
    )

    private val activitiesZh = listOf(
        LocalAgentActivity("刚刚", "已核对 4 条官方入境规则的版本与有效期"),
        LocalAgentActivity("5 分钟前", "为 SIN → PVG 扫描了 3 个候选中转城市"),
        LocalAgentActivity("1 小时前", "监控中的 2 条价格规则完成例行检查"),
    )

    private val activitiesEn = listOf(
        LocalAgentActivity("Just now", "Verified versions and validity of 4 official entry rules"),
        LocalAgentActivity("5 min ago", "Scanned 3 candidate stopover cities for SIN → PVG"),
        LocalAgentActivity("1 h ago", "Routine check completed for 2 monitored price rules"),
    )

    val agentActivities: List<LocalAgentActivity>
        get() = if (L10n.current == AppLanguage.EN) activitiesEn else activitiesZh

    val demoRoute: String get() = if (L10n.current == AppLanguage.EN) "Singapore SIN → Shanghai PVG" else "新加坡 SIN → 上海 PVG"
}

/** 首页灵感卡 → 探索页的一次性预填（首页本身仍不发网络请求，保持本地契约）。 */
object SearchPrefill {
    @Volatile
    var destination: String? = null

    fun takeDestination(): String? {
        val v = destination
        destination = null
        return v
    }
}
