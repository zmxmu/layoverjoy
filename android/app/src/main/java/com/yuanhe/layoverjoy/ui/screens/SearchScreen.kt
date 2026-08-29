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
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.SearchPrefill
import com.yuanhe.layoverjoy.data.SearchPreferences
import com.yuanhe.layoverjoy.data.SearchRequest
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.Routes
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import kotlinx.coroutines.launch
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

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

/** 搜索页：输入起终点、日期与偏好，创建异步搜索编排。 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun SearchScreen(nav: NavController) {
    val scope = rememberCoroutineScope()

    var origin by remember { mutableStateOf("SIN") }
    // 首页灵感卡点击后的一次性预填（取走即清空）。
    var destination by remember { mutableStateOf(SearchPrefill.takeDestination() ?: "PVG") }
    var departMillis by remember { mutableLongStateOf(defaultDepartMillis()) }
    var showDatePicker by remember { mutableStateOf(false) }
    var minStop by remember { mutableIntStateOf(1) }
    var maxStop by remember { mutableIntStateOf(3) }
    var maxDelta by remember { mutableStateOf("") }
    var interests by remember { mutableStateOf(setOf<String>()) }
    var acceptRedEye by remember { mutableStateOf(true) }
    var demoFixture by remember { mutableStateOf(true) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val departDateText = remember(departMillis) { utcDate(departMillis) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(20.dp))
        Text(L10n.t("search.title"), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(L10n.t("search.subtitle"), style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(16.dp))

        JoyCard {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                LabeledField(L10n.t("search.origin"), origin, { origin = it.uppercase().take(4) }, placeholder = "SIN", modifier = Modifier.weight(1f))
                LabeledField(L10n.t("search.destination"), destination, { destination = it.uppercase().take(4) }, placeholder = "PVG", modifier = Modifier.weight(1f))
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(L10n.t("search.depart_date"), style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
                    Spacer(Modifier.height(4.dp))
                    Text(departDateText, style = MaterialTheme.typography.titleSmall)
                }
                TextButton(onClick = { showDatePicker = true }) { Text(L10n.t("search.change"), color = BrandPrimary) }
            }
            Spacer(Modifier.height(12.dp))
            StepperRow(L10n.t("search.min_days"), minStop, 1, 7) { minStop = it; if (maxStop < it) maxStop = it }
            StepperRow(L10n.t("search.max_days"), maxStop, minStop, 7) { maxStop = it }
            Spacer(Modifier.height(12.dp))
            LabeledField(
                L10n.t("search.max_delta"),
                maxDelta,
                { maxDelta = it.filter { c -> c.isDigit() || c == '.' } },
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
            Spacer(Modifier.height(10.dp))
            SwitchRow(L10n.t("search.demo_fallback"), L10n.t("search.demo_fallback_sub"), demoFixture) { demoFixture = it }
        }
        Spacer(Modifier.height(12.dp))
        ErrorBanner(error)
        if (error != null) Spacer(Modifier.height(10.dp))

        PrimaryButton(
            text = L10n.t("search.go"),
            loading = loading,
            enabled = origin.isNotBlank() && destination.isNotBlank(),
            onClick = {
                error = null
                loading = true
                scope.launch {
                    val req = SearchRequest(
                        origin = origin.trim(),
                        destination = destination.trim(),
                        departureDate = departDateText,
                        minStopDays = minStop,
                        maxStopDays = maxStop,
                        maxAirfareDelta = maxDelta.toDoubleOrNull(),
                        preferences = SearchPreferences(
                            interests = interests.toList().ifEmpty { null },
                            acceptRedEye = acceptRedEye,
                            demoFixture = demoFixture,
                        ),
                    )
                    when (val r = apiCall { Net.api.createSearch(req) }) {
                        is ApiResult.Ok -> nav.navigate(Routes.results(r.data.searchRunId))
                        is ApiResult.Err -> error = r.message
                    }
                    loading = false
                }
            },
        )
        Spacer(Modifier.height(28.dp))
    }

    if (showDatePicker) {
        val pickerState = rememberDatePickerState(initialSelectedDateMillis = departMillis)
        DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = {
                TextButton(onClick = {
                    pickerState.selectedDateMillis?.let { departMillis = it }
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

private fun defaultDepartMillis(): Long = System.currentTimeMillis() + 21L * 24 * 3600 * 1000

private fun utcDate(millis: Long): String {
    val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US)
    fmt.timeZone = TimeZone.getTimeZone("UTC")
    return fmt.format(Date(millis))
}
