package com.yuanhe.layoverjoy.ui

import com.yuanhe.layoverjoy.data.catalog.LocationCatalog
import com.yuanhe.layoverjoy.ui.i18n.AppLanguage
import com.yuanhe.layoverjoy.ui.i18n.L10n

/**
 * 展示层统一的地名解析：界面上不出现城市/机场三字码缩写，
 * 一律把 cityId、metroCode、机场 IATA 解析为当前语言的完整城市名。
 * 解析不到时回退原值（保底，不崩溃）。
 */

/** cityId → 本地化城市名；不在目录中返回 null。 */
fun cityNameById(cityId: String?): String? {
    val city = LocationCatalog.city(cityId) ?: return null
    return if (L10n.current == AppLanguage.EN) city.nameEn.ifBlank { city.nameZh } else city.nameZh.ifBlank { city.nameEn }
}

/** cityId / metroCode / 机场 IATA → 本地化城市名；解析不到回退原值。 */
fun cityDisplayName(codeOrId: String?): String {
    val raw = codeOrId?.trim().orEmpty()
    if (raw.isEmpty()) return ""
    val city = LocationCatalog.city(raw) ?: LocationCatalog.cityByCode(raw) ?: return raw
    return if (L10n.current == AppLanguage.EN) city.nameEn.ifBlank { city.nameZh } else city.nameZh.ifBlank { city.nameEn }
}

/** ISO alpha-2 国家/地区码 → 本地化全称；解析不到回退原值。 */
fun countryDisplayName(countryCode: String?): String {
    val raw = countryCode?.trim().orEmpty()
    if (raw.isEmpty()) return ""
    val country = LocationCatalog.country(raw) ?: return raw
    return if (L10n.current == AppLanguage.EN) country.nameEn.ifBlank { country.nameZh } else country.nameZh.ifBlank { country.nameEn }
}
