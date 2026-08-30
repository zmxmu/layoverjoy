package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.FlightTakeoff
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.data.catalog.CatalogCity
import com.yuanhe.layoverjoy.data.catalog.LocationCatalog
import com.yuanhe.layoverjoy.data.catalog.LocationSelection
import com.yuanhe.layoverjoy.data.catalog.LocationSelectionMode
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.Routes
import com.yuanhe.layoverjoy.ui.i18n.AppLanguage
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.theme.BrandBackground
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import kotlinx.serialization.json.Json

private val resultJson = Json { ignoreUnknownKeys = true }

/** 本地化城市名。 */
fun cityName(city: CatalogCity): String =
    if (L10n.current == AppLanguage.EN) city.nameEn.ifBlank { city.nameZh } else city.nameZh.ifBlank { city.nameEn }

/** 本地化机场名。 */
fun airportName(a: com.yuanhe.layoverjoy.data.catalog.CatalogAirport): String =
    if (L10n.current == AppLanguage.EN) a.nameEn.ifBlank { a.nameZh } else a.nameZh.ifBlank { a.nameEn }

/** 地点副文案：国家/地区 · 范围（代码）。 */
fun locationSubtitle(city: CatalogCity, sel: LocationSelection): String {
    val country = LocationCatalog.countryOf(city)?.let { if (L10n.current == AppLanguage.EN) it.nameEn else it.nameZh } ?: city.countryCode
    val scope = if (sel.mode == LocationSelectionMode.AIRPORT) {
        val ap = city.airports.firstOrNull { it.iata == sel.airportIata }
        "${ap?.let { airportName(it) } ?: sel.airportIata}（${sel.airportIata}）"
    } else {
        "${L10n.t("loc.all_airports")}（${city.airports.joinToString(" / ") { it.iata }}）"
    }
    return "$country · $scope"
}

private fun returnSelection(
    context: android.content.Context,
    nav: NavController,
    sel: LocationSelection,
    role: String,
    originSource: String? = null,
) {
    LocationCatalog.record(context, sel)
    // 结果直写搜索页 handle，并从任意层级（picker/洲/国家）一步回到搜索页。
    // 旧实现写 previousBackStackEntry 且只 pop 一层：深层浏览链下结果写错 handle、
    // 且只回到 picker，表现为“选完城市自动返回上一页且选择丢失”。
    val target = runCatching { nav.getBackStackEntry(Routes.SEARCH) }.getOrNull()
    val handle = (target?.savedStateHandle ?: nav.previousBackStackEntry?.savedStateHandle) ?: return
    handle.set("location_selection_$role", resultJson.encodeToString(LocationSelection.serializer(), sel))
    // 出发地来源（仅「使用当前城市」会写）：搜索页据此记 originSelectionSource，不存经纬度。
    if (role == "ORIGIN") handle.set("location_origin_source", originSource ?: "MANUAL")
    if (!nav.popBackStack(Routes.SEARCH, false)) nav.popBackStack()
}

/** 地点选择页：搜索 + 最近 + 热门 + 洲浏览；多机场消歧与机场 Bottom Sheet。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun LocationPickerScreen(nav: NavController, role: String) {
    val context = LocalContext.current
    var query by remember { mutableStateOf("") }
    var sheetCity by remember { mutableStateOf<CatalogCity?>(null) }
    var ambiguous by remember { mutableStateOf<CatalogCity?>(null) }
    val focusRequester = remember { FocusRequester() }

    val pick: (LocationSelection) -> Unit = { returnSelection(context, nav, it, role) }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(L10n.t(if (role == "ORIGIN") "loc.picker_origin" else "loc.picker_destination")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )
        TextField(
            value = query,
            onValueChange = { query = it },
            modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp).focusRequester(focusRequester),
            placeholder = { Text(L10n.t("loc.search_placeholder")) },
            leadingIcon = { Icon(Icons.Default.Search, null) },
            trailingIcon = { if (query.isNotEmpty()) IconButton(onClick = { query = "" }) { Icon(Icons.Default.Close, null) } },
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
            colors = TextFieldDefaults.colors(focusedContainerColor = BrandBackground, unfocusedContainerColor = BrandBackground),
            singleLine = true,
        )
        androidx.compose.runtime.LaunchedEffect(Unit) { try { focusRequester.requestFocus() } catch (_: Exception) {} }

        // 「使用当前城市」只在出发地页出现（方案 §6.1）；目的地页不展示该入口。
        if (role == "ORIGIN") {
            CurrentCityOriginEntry(onConfirm = { sel, source -> returnSelection(context, nav, sel, role, source) })
        }

        val hits = remember(query) { if (query.isBlank()) emptyList() else LocationCatalog.search(query) }
        val recent = remember { LocationCatalog.recent(context) }

        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
            if (query.isBlank()) {
                if (recent.isNotEmpty()) {
                    item { Spacer(Modifier.height(14.dp)); SectionLabel(L10n.t("loc.recent")) }
                    item {
                        Row(horizontalArrangement = androidx.compose.foundation.layout.Arrangement.spacedBy(8.dp)) {
                            recent.take(6).forEach { sel ->
                                val city = LocationCatalog.city(sel.cityId)
                                if (city != null) {
                                    TextButton(onClick = { pick(sel) }) { Text(cityName(city), color = BrandPrimary) }
                                }
                            }
                        }
                    }
                }
                item { Spacer(Modifier.height(10.dp)); SectionLabel(L10n.t("loc.popular")) }
                item {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        LocationCatalog.popularCities(12).chunked(3).forEach { col ->
                            Column(Modifier.weight(1f)) {
                                col.forEach { c ->
                                    TextButton(onClick = {
                                        pick(LocationSelection(c.cityId, LocationSelectionMode.ALL_AIRPORTS))
                                    }) { Text(cityName(c), style = MaterialTheme.typography.labelMedium, color = BrandPrimary) }
                                }
                            }
                        }
                    }
                }
                item { Spacer(Modifier.height(10.dp)); SectionLabel(L10n.t("loc.browse")) }
                items(LocationCatalog.continents) { cont ->
                    JoyCard(modifier = Modifier.padding(vertical = 4.dp).clickable {
                        nav.navigate(Routes.continent(cont.continentCode, role))
                    }) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                if (L10n.current == AppLanguage.EN) cont.nameEn else cont.nameZh,
                                style = MaterialTheme.typography.titleSmall,
                                modifier = Modifier.weight(1f),
                            )
                            Text(L10n.t("loc.city_count", LocationCatalog.countryCityCount(cont)), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                        }
                    }
                }
                item {
                    Spacer(Modifier.height(10.dp))
                    Text(
                        if (L10n.current == AppLanguage.EN) LocationCatalog.disclaimerEn else LocationCatalog.disclaimerZh,
                        style = MaterialTheme.typography.labelSmall,
                        color = BrandInkSoft,
                    )
                    Spacer(Modifier.height(20.dp))
                }
            } else if (hits.isEmpty()) {
                item {
                    Spacer(Modifier.height(24.dp))
                    Text(L10n.t("loc.no_result", query), style = MaterialTheme.typography.bodyMedium)
                    Spacer(Modifier.height(6.dp))
                    Text(L10n.t("loc.no_result_hint"), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                }
            } else {
                items(hits, key = { "${it.city.cityId}:${it.matchedBy}:${it.matchedAirportIata}" }) { hit ->
                    CityRow(
                        city = hit.city,
                        matchedAirport = hit.matchedAirportIata,
                        ambiguous = hit.matchedBy == "AMBIGUOUS_CODE",
                        onClick = {
                            when {
                                hit.matchedBy == "AMBIGUOUS_CODE" -> ambiguous = hit.city
                                hit.matchedBy == "AIRPORT_IATA" && hit.matchedAirportIata != null ->
                                    pick(LocationSelection(hit.city.cityId, LocationSelectionMode.AIRPORT, hit.matchedAirportIata))
                                else -> pick(LocationSelection(hit.city.cityId, LocationSelectionMode.ALL_AIRPORTS))
                            }
                        },
                        onPickAirport = { if (hit.city.airports.size > 1) sheetCity = hit.city },
                    )
                }
                item { Spacer(Modifier.height(20.dp)) }
            }
        }
    }

    // 多机场 Bottom Sheet：第一项始终为全市机场
    sheetCity?.let { city ->
        ModalBottomSheet(onDismissRequest = { sheetCity = null }, sheetState = rememberModalBottomSheetState()) {
            Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 32.dp)) {
                Text(cityName(city), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = {
                    sheetCity = null
                    pick(LocationSelection(city.cityId, LocationSelectionMode.ALL_AIRPORTS))
                }) { Text("${L10n.t("loc.all_airports")}（${city.airports.joinToString(" / ") { it.iata }}）", color = BrandPrimary) }
                city.airports.forEach { a ->
                    TextButton(onClick = {
                        sheetCity = null
                        pick(LocationSelection(city.cityId, LocationSelectionMode.AIRPORT, a.iata))
                    }) { Text("${airportName(a)}（${a.iata}）", color = BrandPrimary) }
                }
            }
        }
    }

    // 城市码与机场码同码消歧（SHA/KUL/BKK）：不替用户猜
    ambiguous?.let { city ->
        val iata = city.metroCode!!
        AlertDialog(
            onDismissRequest = { ambiguous = null },
            title = { Text(L10n.t("loc.disambig_title", city.metroCode!!)) },
            text = {
                Column {
                    TextButton(onClick = {
                        ambiguous = null
                        pick(LocationSelection(city.cityId, LocationSelectionMode.ALL_AIRPORTS))
                    }) { Text("${cityName(city)} · ${L10n.t("loc.all_airports")}（${city.airports.joinToString(" / ") { it.iata }}）") }
                    TextButton(onClick = {
                        ambiguous = null
                        pick(LocationSelection(city.cityId, LocationSelectionMode.AIRPORT, iata))
                    }) {
                        Text("${airportName(city.airports.first { it.iata == iata })}（$iata）")
                    }
                }
            },
            confirmButton = { TextButton(onClick = { ambiguous = null }) { Text(L10n.t("common.cancel")) } },
        )
    }
}

/** 洲 → 国家/地区列表页。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ContinentCountriesScreen(nav: NavController, continentCode: String, role: String) {
    val cont = LocationCatalog.continents.firstOrNull { it.continentCode == continentCode }
    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(cont?.let { if (L10n.current == AppLanguage.EN) it.nameEn else it.nameZh } ?: "") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
            items(cont?.countries ?: emptyList()) { ctry ->
                JoyCard(modifier = Modifier.padding(vertical = 4.dp).clickable {
                    nav.navigate(Routes.countryCitiesOf(ctry.countryCode, role))
                }) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(if (L10n.current == AppLanguage.EN) ctry.nameEn else ctry.nameZh, style = MaterialTheme.typography.titleSmall)
                            Spacer(Modifier.height(2.dp))
                            Text(ctry.countryCode, style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                        }
                        Text(L10n.t("loc.city_count", ctry.cities.size), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                    }
                }
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }
}

/** 国家/地区 → 城市二级页（热门优先；多机场行含“选择机场”次级入口）。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CountryCitiesScreen(nav: NavController, countryCode: String, role: String) {
    val context = LocalContext.current
    val country = LocationCatalog.country(countryCode)
    var sheetCity by remember { mutableStateOf<CatalogCity?>(null) }
    val pick: (LocationSelection) -> Unit = { returnSelection(context, nav, it, role) }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(country?.let { if (L10n.current == AppLanguage.EN) it.nameEn else it.nameZh } ?: "") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
            items(country?.let { LocationCatalog.citiesOf(it, L10n.current == AppLanguage.EN) } ?: emptyList()) { city ->
                CityRow(
                    city = city,
                    matchedAirport = null,
                    ambiguous = false,
                    onClick = { pick(LocationSelection(city.cityId, LocationSelectionMode.ALL_AIRPORTS)) },
                    onPickAirport = { if (city.airports.size > 1) sheetCity = city },
                )
            }
            item { Spacer(Modifier.height(20.dp)) }
        }
    }

    sheetCity?.let { city ->
        ModalBottomSheet(onDismissRequest = { sheetCity = null }, sheetState = rememberModalBottomSheetState()) {
            Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 32.dp)) {
                Text(cityName(city), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = {
                    sheetCity = null
                    pick(LocationSelection(city.cityId, LocationSelectionMode.ALL_AIRPORTS))
                }) { Text("${L10n.t("loc.all_airports")}（${city.airports.joinToString(" / ") { it.iata }}）", color = BrandPrimary) }
                city.airports.forEach { a ->
                    TextButton(onClick = {
                        sheetCity = null
                        pick(LocationSelection(city.cityId, LocationSelectionMode.AIRPORT, a.iata))
                    }) { Text("${airportName(a)}（${a.iata}）", color = BrandPrimary) }
                }
            }
        }
    }
}

/** 城市行：城市名 + 国家/地区 + 城市码 + 机场摘要；命中机场时第二行解释。 */
@Composable
private fun CityRow(city: CatalogCity, matchedAirport: String?, ambiguous: Boolean, onClick: () -> Unit, onPickAirport: () -> Unit) {
    JoyCard(modifier = Modifier.padding(vertical = 4.dp).clickable(onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text("${cityName(city)}  ·  ${city.metroCode ?: city.defaultAirportIata}", style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(2.dp))
                Text(
                    "${LocationCatalog.countryOf(city)?.let { if (L10n.current == AppLanguage.EN) it.nameEn else it.nameZh } ?: city.countryCode} · ${city.airports.joinToString(" / ") { it.iata }}",
                    style = MaterialTheme.typography.labelSmall,
                    color = BrandInkSoft,
                )
                if (matchedAirport != null && !ambiguous) {
                    Spacer(Modifier.height(4.dp))
                    val ap = city.airports.firstOrNull { it.iata == matchedAirport }
                    Text(L10n.t("loc.matched_airport", "${ap?.let { airportName(it) } ?: matchedAirport} $matchedAirport"), style = MaterialTheme.typography.labelSmall, color = BrandPrimary)
                }
            }
            if (city.airports.size > 1) {
                Spacer(Modifier.width(8.dp))
                TextButton(onClick = onPickAirport) { Text(L10n.t("loc.pick_airport"), style = MaterialTheme.typography.labelSmall, color = BrandPrimary) }
            } else {
                Icon(Icons.Default.FlightTakeoff, null, tint = BrandInkSoft)
            }
        }
    }
}

@Composable
private fun SectionLabel(text: String) {
    Text(text, style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
}
