package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.LayoverJoyApp
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.SearchPrefill
import com.yuanhe.layoverjoy.data.DemoFlags
import com.yuanhe.layoverjoy.data.SearchPreferences
import com.yuanhe.layoverjoy.data.SearchRequest
import com.yuanhe.layoverjoy.data.Trace
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.data.catalog.LocationCatalog
import com.yuanhe.layoverjoy.data.catalog.LocationSelection
import com.yuanhe.layoverjoy.data.catalog.LocationSelectionMode
import com.yuanhe.layoverjoy.data.location.LocationEvents
import com.yuanhe.layoverjoy.data.search.DepartureDateSource
import com.yuanhe.layoverjoy.data.search.OriginSelectionSource
import com.yuanhe.layoverjoy.data.search.SearchFormState
import com.yuanhe.layoverjoy.data.search.SearchPreferencesMapper
import com.yuanhe.layoverjoy.data.search.SmartDepartureDateResolver
import com.yuanhe.layoverjoy.ui.AppStateViewModel
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.Routes
import com.yuanhe.layoverjoy.ui.i18n.AppLanguage
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Place
import androidx.compose.material.icons.filled.SwapVert
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/* 后端错误码 → 用户文案（LOC-06：无匹配/无库存/超时/登录失效分别展示）。 */
fun locationErrorText(e: ApiResult.Err): String = when (e.code) {
    "SAME_ORIGIN_DESTINATION" -> L10n.t("loc.same_od")
    "INVALID_LOCATION_SELECTION" -> L10n.t("loc.err_invalid_selection")
    "NO_SANDBOX_INVENTORY", "NO_FLIGHT_INVENTORY" -> L10n.t("loc.err_no_inventory")
    "ATLAS_TIMEOUT", "FLIGHT_PROVIDER_TIMEOUT" -> L10n.t("loc.err_provider_timeout")
    "UNAUTHORIZED" -> L10n.t("loc.err_login")
    else -> e.message
}

/** 搜索页地点卡：整卡可点击；已选择时展示城市名 + 国家/地区 · 范围（代码）。 */
@Composable
fun LocationField(title: String, sel: LocationSelection?, modifier: Modifier = Modifier, tag: String? = null, onClick: () -> Unit) {
    val city = LocationCatalog.city(sel?.cityId)
    Column(
        modifier = modifier
            .clip(RoundedCornerShape(14.dp))
            .background(com.yuanhe.layoverjoy.ui.theme.BrandLine.copy(alpha = 0.18f))
            .clickable(onClick = onClick)
            .padding(14.dp),
    ) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
                Spacer(Modifier.height(4.dp))
                if (city != null && sel != null) {
                    Text(cityName(city), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                    Spacer(Modifier.height(2.dp))
                    Text(locationSubtitle(city, sel), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                    // 出发地来自「使用当前城市」时只标一个来源标签，不回显任何位置数据。
                    if (!tag.isNullOrBlank()) {
                        Spacer(Modifier.height(2.dp))
                        Text(tag, style = MaterialTheme.typography.labelSmall, color = BrandPrimary)
                    }
                } else {
                    Text(L10n.t("loc.field_placeholder"), style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(2.dp))
                    Text(L10n.t("loc.field_hint"), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                }
            }
            Icon(Icons.Default.Place, null, tint = BrandPrimary)
        }
    }
}

/** 兴趣标签：code 传给后端（保持语义稳定），文案按当前语言展示。 */
private val ALL_INTERESTS = listOf(
    "food" to "interest.food",
    "nature" to "interest.nature",
    "museum" to "interest.museum",
    "shopping" to "interest.shopping",
    "nightlife" to "interest.nightlife",
    "oldtown" to "interest.oldtown",
    "family" to "interest.family",
)

/* 地点选择在导航重建后仍需保留（rememberSaveable + JSON Saver）。 */
private val SelectionSaver = Saver<LocationSelection?, String>(
    save = { it?.let { v -> kotlinx.serialization.json.Json.encodeToString(LocationSelection.serializer(), v) } ?: "" },
    restore = { if (it.isEmpty()) null else kotlinx.serialization.json.Json.decodeFromString(LocationSelection.serializer(), it) },
)

/** 搜索页：输入起终点、日期与偏好，创建异步搜索编排；进入时恢复该用户的上一次搜索设置。 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SearchScreen(nav: NavController, appState: AppStateViewModel) {
    val scope = rememberCoroutineScope()
    val prefsRepo = remember { LayoverJoyApp.instance.searchPreferences }

    var originSel by rememberSaveable(stateSaver = SelectionSaver) { mutableStateOf<LocationSelection?>(null) }
    // 首页灵感卡点击后的一次性预填（cityId，取走即清空）。
    var destSel by rememberSaveable(stateSaver = SelectionSaver) {
        mutableStateOf(SearchPrefill.takeDestinationCityId()?.let { LocationSelection(it, LocationSelectionMode.ALL_AIRPORTS) })
    }
    // 出发日期以 ISO 文本保存（yyyy-MM-dd，与后端契约一致），`rememberSaveable` 直接支持。
    var departIso by rememberSaveable { mutableStateOf("") }
    var showDatePicker by remember { mutableStateOf(false) }
    var minStop by rememberSaveable { mutableIntStateOf(1) }
    var maxStop by rememberSaveable { mutableIntStateOf(3) }
    var maxDelta by rememberSaveable { mutableStateOf("") }
    var originSource by rememberSaveable { mutableStateOf(OriginSelectionSource.MANUAL.name) }
    var interests by remember { mutableStateOf(setOf<String>()) }
    var acceptRedEye by remember { mutableStateOf(true) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    // 恢复只做一次；「建议」文案只在系统推算日期后展示一次，用户动过日期即消失。
    var restored by rememberSaveable { mutableStateOf(false) }
    var suggestion by rememberSaveable { mutableStateOf<String?>(null) }
    // 用户真实改动计数：自动推算出的日期不反过来污染缓存（§4.3 只保存用户行为）。
    var userEdits by rememberSaveable { mutableIntStateOf(0) }

    val departDate: LocalDate? = remember(departIso) { departIso.parseDateOrNull() }
    val departDateText = departDate?.toIsoText().orEmpty()
    val originTagName = if (originSource == OriginSelectionSource.CURRENT_LOCATION.name) L10n.t("loc.origin_from_location") else null

    val buildForm: () -> SearchFormState = {
        SearchFormState(
            origin = originSel,
            destination = destSel,
            departureDate = departDate,
            minStopoverDays = minStop,
            maxStopoverDays = maxStop,
            maxExtraPriceSgd = maxDelta.toBigDecimalOrNull(),
            originSelectionSource = runCatching { OriginSelectionSource.valueOf(originSource) }
                .getOrDefault(OriginSelectionSource.MANUAL),
        )
    }

    // ---------- 进入页面：恢复缓存 + 智能出发日期（§4 / §5） ----------
    LaunchedEffect(Unit) {
        if (restored) return@LaunchedEffect
        // 冷启动补 userId 的极短窗口：最多等 2 秒，期间不加载也不保存（避免命名空间串写）。
        var waited = 0
        while (!appState.prefsReady && waited < NAMESPACE_WAIT_MS) {
            delay(100)
            waited += 100
        }
        restored = true
        val cached = if (appState.prefsReady) prefsRepo.load(appState.prefsUserId) else null
        val resolver = SmartDepartureDateResolver()
        if (cached == null) {
            // 首次打开（或命名空间未就绪）：至少 21 天后的第一个周五。
            if (departIso.isBlank()) {
                val decision = resolver.resolve(null, null, null)
                departIso = decision.date.toIsoText()
                suggestion = L10n.t("search.date_defaulted", decision.date.displayDate())
            }
            return@LaunchedEffect
        }
        val form = SearchPreferencesMapper.toForm(cached)
        Trace.event(
            "search_preferences_restored",
            "origin" to (form.origin?.cityId ?: "-"),
            "destination" to (form.destination?.cityId ?: "-"),
            "stopoverDays" to "${form.minStopoverDays}-${form.maxStopoverDays}",
        )
        form.origin?.let { originSel = it }
        form.destination?.let { destSel = it }
        minStop = form.minStopoverDays
        maxStop = form.maxStopoverDays
        maxDelta = form.maxExtraPriceSgd?.toPlainString() ?: ""
        originSource = form.originSelectionSource.name
        val decision = resolver.resolve(
            cachedDate = form.departureDate,
            preferredLeadDays = cached.preferredLeadDays,
            preferredDepartureDayOfWeek = cached.preferredDepartureDayOfWeek,
        )
        departIso = decision.date.toIsoText()
        suggestion = if (decision.autoAdjusted) {
            Trace.event(
                "search_date_auto_rolled",
                "source" to decision.source.name,
                "date" to decision.date.toIsoText(),
            )
            if (decision.source == DepartureDateSource.DEFAULT_FIRST_FRIDAY) {
                L10n.t("search.date_defaulted", decision.date.displayDate())
            } else {
                L10n.t("search.date_rolled", decision.date.displayDate())
            }
        } else {
            null
        }
    }

    // ---------- 保存：选完地点立即存，改日期/天数/预算 300ms debounce 存 ----------
    val persist: suspend () -> Unit = {
        if (restored && appState.prefsReady) {
            prefsRepo.save(appState.prefsUserId, SearchPreferencesMapper.toCached(buildForm()))
        }
    }
    LaunchedEffect(userEdits) {
        if (userEdits == 0 || !restored || !appState.prefsReady) return@LaunchedEffect
        delay(SAVE_DEBOUNCE_MS)
        persist()
    }

    // 选择页返回回填（按角色键区分，避免内存状态在导航重建中丢失）。
    val handle = nav.currentBackStackEntry?.savedStateHandle
    val resultJson = remember { Json { ignoreUnknownKeys = true } }
    androidx.compose.runtime.LaunchedEffect(handle) {
        handle?.getStateFlow<String?>("location_selection_ORIGIN", null)?.collect { raw ->
            if (raw != null) {
                try {
                    originSel = resultJson.decodeFromString<LocationSelection>(raw)
                    // 来源标签由选择页一并写回：手动选 = MANUAL，「使用当前城市」= CURRENT_LOCATION。
                    originSource = handle.get<String>("location_origin_source")
                        ?: OriginSelectionSource.MANUAL.name
                    // §4.3：完成城市/机场选择后立即保存（不走 debounce）。
                    persist()
                } catch (_: Exception) {
                }
                handle.remove<String>("location_selection_ORIGIN")
                handle.remove<String>("location_origin_source")
            }
        }
    }
    androidx.compose.runtime.LaunchedEffect(handle) {
        handle?.getStateFlow<String?>("location_selection_DESTINATION", null)?.collect { raw ->
            if (raw != null) {
                try {
                    destSel = resultJson.decodeFromString<LocationSelection>(raw)
                    persist()
                } catch (_: Exception) {}
                handle.remove<String>("location_selection_DESTINATION")
            }
        }
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(20.dp))
        Text(L10n.t("search.title"), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(L10n.t("search.subtitle"), style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(16.dp))

        JoyCard {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                LocationField(
                    L10n.t("search.origin"),
                    originSel,
                    Modifier.weight(1f),
                    tag = originTagName,
                ) { nav.navigate(Routes.locationPicker("ORIGIN")) }
                IconButton(onClick = {
                    val t = originSel
                    originSel = destSel
                    destSel = t
                    // 交换后出发地不再是定位结果（另一边本来是手动选的目的地）。
                    originSource = OriginSelectionSource.MANUAL.name
                    userEdits++
                }) {
                    Icon(Icons.Default.SwapVert, L10n.t("loc.swap"), tint = BrandPrimary)
                }
                LocationField(
                    L10n.t("search.destination"),
                    destSel,
                    Modifier.weight(1f),
                ) { nav.navigate(Routes.locationPicker("DESTINATION")) }
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(L10n.t("search.depart_date"), style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
                    Spacer(Modifier.height(4.dp))
                    Text(
                        departDateText.ifBlank { L10n.t("search.depart_date_placeholder") },
                        style = MaterialTheme.typography.titleSmall,
                    )
                }
                TextButton(onClick = { showDatePicker = true }) { Text(L10n.t("search.change"), color = BrandPrimary) }
            }
            // 「建议」标签：只在系统自动推算日期后出现一次，用户手改即消失（§5.4）。
            suggestion?.let { hint ->
                Spacer(Modifier.height(6.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(
                        L10n.t("search.suggest_badge"),
                        style = MaterialTheme.typography.labelSmall,
                        color = BrandPrimary,
                        modifier = Modifier
                            .clip(RoundedCornerShape(6.dp))
                            .background(BrandPrimary.copy(alpha = 0.12f))
                            .padding(horizontal = 6.dp, vertical = 2.dp),
                    )
                    Spacer(Modifier.width(6.dp))
                    Text(hint, style = MaterialTheme.typography.labelSmall, color = BrandInkSoft, modifier = Modifier.weight(1f))
                }
            }
            Spacer(Modifier.height(12.dp))
            StepperRow(L10n.t("search.min_days"), minStop, 1, 7) { minStop = it; if (maxStop < it) maxStop = it; userEdits++ }
            StepperRow(L10n.t("search.max_days"), maxStop, minStop, 7) { maxStop = it; userEdits++ }
            Spacer(Modifier.height(12.dp))
            LabeledField(
                L10n.t("search.max_delta"),
                maxDelta,
                { maxDelta = it.filter { c -> c.isDigit() || c == '.' }; userEdits++ },
                placeholder = L10n.t("search.max_delta_hint"),
                keyboardType = KeyboardType.Decimal,
            )
        }
        Spacer(Modifier.height(12.dp))

        JoyCard {
            Text(L10n.t("search.interests"), style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
            Spacer(Modifier.height(8.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                ALL_INTERESTS.forEach { (code, key) ->
                    InterestChip(L10n.t(key), code in interests) {
                        interests = if (code in interests) interests - code else interests + code
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            SwitchRow(L10n.t("search.redeye"), L10n.t("search.redeye_sub"), acceptRedEye) { acceptRedEye = it }
        }
        Spacer(Modifier.height(12.dp))
        ErrorBanner(error)
        if (error != null) Spacer(Modifier.height(10.dp))

        PrimaryButton(
            text = L10n.t("search.go"),
            loading = loading,
            enabled = originSel != null && destSel != null && departDate != null,
            onClick = {
                error = null
                val o = originSel!!
                val d = destSel!!
                if (o.cityId == d.cityId) {
                    error = L10n.t("loc.same_od")
                    return@PrimaryButton
                }
                loading = true
                scope.launch {
                    // §4.3：点「搜索方案」时强制保存一次完整快照（不等 debounce）。
                    persist()
                    val req = SearchRequest(
                        originLocation = o,
                        destinationLocation = d,
                        departureDate = departDateText,
                        minStopDays = minStop,
                        maxStopDays = maxStop,
                        maxAirfareDelta = maxDelta.toDoubleOrNull(),
                        preferences = SearchPreferences(
                            interests = interests.toList().ifEmpty { null },
                            acceptRedEye = acceptRedEye,
                            // 演示回退默认关闭：仅开发页开关开启时才允许无库存回退本地 fixture（结果标 MOCK）。
                            demoFixture = if (DemoFlags.demoFixtureFallback) true else null,
                        ),
                    )
                    when (val r = apiCall { Net.api.createSearch(req) }) {
                        is ApiResult.Ok -> nav.navigate(Routes.results(r.data.searchRunId))
                        is ApiResult.Err -> error = locationErrorText(r)
                    }
                    loading = false
                }
            },
        )
        Spacer(Modifier.height(28.dp))
    }

    if (showDatePicker) {
        // 日历只能选「今天 ~ 今天+365」：与后端 departureDate 不早于今天的校验一致，
        // 也让智能推算的恢复窗口（§5.2 优先级 1）不会被用户选到范外。
        val todayUtc = remember { LocalDate.now().toUtcMillis() }
        val horizonUtc = remember(todayUtc) {
            LocalDate.now().plusDays(SmartDepartureDateResolver.MAX_SELECTABLE_DAYS.toLong()).toUtcMillis()
        }
        val selectable = remember(todayUtc, horizonUtc) {
            object : SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis in todayUtc..horizonUtc
            }
        }
        val pickerState = rememberDatePickerState(
            initialSelectedDateMillis = departDate?.toUtcMillis() ?: todayUtc,
            selectableDates = selectable,
        )
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { millis ->
                        departIso = LocalDate.ofEpochDay(Math.floorDiv(millis, MILLIS_PER_DAY)).toIsoText()
                        suggestion = null // 手动改过即不再提示「建议」（§5.4）
                        userEdits++
                    }
                    showDatePicker = false
                }) { Text(L10n.t("common.ok")) }
            },
            dismissButton = { TextButton(onClick = { showDatePicker = false }) { Text(L10n.t("common.cancel")) } },
        ) {
            DatePicker(pickerState)
        }
    }
}

@Composable
private fun StepperRow(label: String, value: Int, min: Int, max: Int, onChange: (Int) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        TextButton(enabled = value > min, onClick = { onChange(value - 1) }) { Text("−") }
        Text(L10n.t("common.days_unit", value), style = MaterialTheme.typography.titleSmall, modifier = Modifier.width(48.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        TextButton(enabled = value < max, onClick = { onChange(value + 1) }) { Text("＋") }
    }
}

@Composable
private fun SwitchRow(title: String, subtitle: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(subtitle, style = MaterialTheme.typography.labelSmall)
        }
        Switch(checked, onChange, colors = SwitchDefaults.colors(checkedTrackColor = BrandPrimary))
    }
}

@Composable
private fun InterestChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(15.dp))
            .background(if (selected) BrandPrimary.copy(alpha = 0.12f) else com.yuanhe.layoverjoy.ui.theme.BrandLine.copy(alpha = 0.35f))
            .border(1.dp, if (selected) BrandPrimary else com.yuanhe.layoverjoy.ui.theme.BrandLine, RoundedCornerShape(15.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = if (selected) BrandPrimary else com.yuanhe.layoverjoy.ui.theme.BrandInk)
    }
}

/** Material3 日期选器用 UTC 毫秒；一天 = 86_400_000ms（不考虑跳秒，本场景精度足够）。 */
private const val MILLIS_PER_DAY = 86_400_000L

/** 等命名空间就绪的最长预算（冷启动补 userId）；超时则用默认值且不写盘。 */
private const val NAMESPACE_WAIT_MS = 2_000

/** 方案 §4.3：数值类修改的保存 debounce。 */
private const val SAVE_DEBOUNCE_MS = 300L

private fun LocalDate.toUtcMillis(): Long = this.toEpochDay() * MILLIS_PER_DAY

private fun LocalDate.toIsoText(): String = toString()

private fun String.parseDateOrNull(): LocalDate? =
    runCatching { if (isBlank()) null else LocalDate.parse(trim()) }.getOrNull()

/** 「建议」文案里的日期：中文 9月25日 / English Sep 25（与后端 ISO 契约无关，纯展示）。 */
private fun LocalDate.displayDate(): String = runCatching {
    if (L10n.current == AppLanguage.EN) format(DateTimeFormatter.ofPattern("MMM d", Locale.US))
    else format(DateTimeFormatter.ofPattern("M月d日", Locale.CHINA))
}.getOrElse { toString() }
