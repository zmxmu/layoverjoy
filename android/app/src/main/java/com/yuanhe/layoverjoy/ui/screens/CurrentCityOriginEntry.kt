package com.yuanhe.layoverjoy.ui.screens

import android.Manifest
import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MyLocation
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.yuanhe.layoverjoy.data.Trace
import com.yuanhe.layoverjoy.data.catalog.LocationCatalog
import com.yuanhe.layoverjoy.data.catalog.LocationSelection
import com.yuanhe.layoverjoy.data.catalog.LocationSelectionMode
import com.yuanhe.layoverjoy.data.location.FusedCurrentCityLocator
import com.yuanhe.layoverjoy.data.location.LocationEvents
import com.yuanhe.layoverjoy.data.location.LocationPermissionCoordinator
import com.yuanhe.layoverjoy.data.location.LocationUiState
import com.yuanhe.layoverjoy.data.location.NearbyAirportMatcher
import com.yuanhe.layoverjoy.data.location.NearbyCandidate
import com.yuanhe.layoverjoy.data.location.describeOutcome
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandLine
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import kotlin.math.roundToInt
import kotlinx.coroutines.launch

/**
 * 出发城市页的「使用当前城市」入口（方案 §6）。
 *
 * 关键约束：
 * - **只在用户点击后**才请求 `ACCESS_COARSE_LOCATION`，App 启动与进入本页都不弹窗；
 * - 定位成功也**不自动提交搜索**：先弹确认面板，由用户选择机场或全市机场；
 * - 任一降级分支（拒绝 / 服务关闭 / 超时 / Play 服务不可用 / 无附近城市）都必须保留手动选择可用。
 *
 * @param onConfirm 用户确认后的地点选择，第二参数为选择来源标签（`CURRENT_LOCATION`）。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun CurrentCityOriginEntry(onConfirm: (LocationSelection, String) -> Unit) {
    val context = LocalContext.current
    val activity = remember(context) { context.findActivity() }
    val scope = rememberCoroutineScope()

    val locator = remember { FusedCurrentCityLocator(context.applicationContext) }
    val matcher = remember {
        NearbyAirportMatcher(
            cities = { LocationCatalog.cities() },
            popularityRank = { LocationCatalog.popularityRank(it) },
        )
    }
    val coordinator = remember(locator, matcher) {
        LocationPermissionCoordinator(
            hasCoarsePermission = { locator.hasCoarsePermission() },
            isServiceEnabled = { locator.locationServicesEnabled() },
            isServiceUnavailable = { locator.playServicesUnavailable() },
            locate = { locator.locateOnce().also { Trace.event("location_outcome", "outcome" to describeOutcome(it)) } },
            match = { matcher.match(it) },
            onEvent = { Trace.event(it) },
        )
    }

    // 旋转屏幕/导航重建只恢复「结果态」：进行中态与 Matched 负载都不跨重建保留，
    // 因此既不会永久 loading，也不会在重组时重复弹权限框。
    var savedPhase by rememberSaveable { mutableStateOf("Idle") }
    var uiState by remember { mutableStateOf(LocationUiState.fromSavedName(savedPhase)) }
    var matched by remember { mutableStateOf<LocationUiState.Matched?>(null) }
    var chosenAirport by remember { mutableStateOf<String?>(null) }

    fun applyState(next: LocationUiState) {
        uiState = next
        savedPhase = next.savedName()
        if (next is LocationUiState.Matched) {
            matched = next
            chosenAirport = next.candidates.firstOrNull()?.airport?.iata
        }
    }

    fun runLocate() {
        applyState(LocationUiState.Locating)
        scope.launch { applyState(coordinator.locateAndMatch()) }
    }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        // rationale 必须在回调里读：它区分「拒绝」与「永久拒绝」两条降级路径。
        val showRationale = activity?.shouldShowRequestPermissionRationale(Manifest.permission.ACCESS_COARSE_LOCATION) ?: false
        scope.launch { applyState(coordinator.onPermissionResult(granted, showRationale)) }
    }

    val startLocate: () -> Unit = {
        matched = null
        Trace.event(LocationEvents.CLICKED)
        when (val pre = coordinator.precheck()) {
            // 预检已给出终态：Play 服务不可用 / 定位服务关闭。
            null -> if (locator.hasCoarsePermission()) runLocate() else {
                applyState(LocationUiState.RequestingPermission)
                permissionLauncher.launch(Manifest.permission.ACCESS_COARSE_LOCATION)
            }
            else -> applyState(pre)
        }
    }

    Column(Modifier.padding(top = 12.dp)) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(14.dp))
                .background(BrandLine.copy(alpha = 0.18f))
                .clickable(enabled = !uiState.busy) { startLocate() }
                .padding(horizontal = 14.dp, vertical = 12.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Default.MyLocation, null, tint = BrandPrimary)
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                Text(L10n.t("loc.use_current_city"), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                Text(
                    if (uiState == LocationUiState.Locating) L10n.t("loc.locating") else L10n.t("loc.use_current_city_sub"),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (uiState == LocationUiState.Locating) BrandPrimary else BrandInkSoft,
                )
            }
            if (uiState.busy) {
                CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = BrandPrimary)
            }
        }
        // 用途说明常驻（§6.2 第 2 条）：一次说清，不额外弹窗打断。
        Text(
            L10n.t("loc.location_purpose"),
            style = MaterialTheme.typography.labelSmall,
            color = BrandInkSoft,
            modifier = Modifier.padding(start = 4.dp, top = 6.dp),
        )

        val notice = statusText(uiState)
        if (notice != null) {
            Spacer(Modifier.height(6.dp))
            Text(notice, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.error)
            Spacer(Modifier.height(2.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                val state = uiState
                when {
                    state is LocationUiState.PermissionDenied && state.canAskAgain ->
                        TextButton(onClick = startLocate) { Text(L10n.t("common.retry"), color = BrandPrimary) }
                    // 永久拒绝：系统不再弹框，只能引导去应用设置。
                    state is LocationUiState.PermissionDenied ->
                        TextButton(onClick = { openAppSettings(context) }) { Text(L10n.t("loc.open_settings"), color = BrandPrimary) }
                    state == LocationUiState.LocationDisabled ->
                        TextButton(onClick = { openLocationSettings(context) }) { Text(L10n.t("loc.enable_location"), color = BrandPrimary) }
                    state == LocationUiState.TimedOut ->
                        TextButton(onClick = startLocate) { Text(L10n.t("common.retry"), color = BrandPrimary) }
                    // Unavailable / NoNearbyCity：只提示手动选择，不给无效重试。
                }
                TextButton(onClick = { applyState(LocationUiState.Idle); matched = null }) {
                    Text(L10n.t("loc.continue_manual"), color = BrandInkSoft)
                }
            }
        }
    }

    // 匹配结果确认面板：定位成功后仍需用户确认（不自动提交搜索）。
    matched?.let { m ->
        ModalBottomSheet(onDismissRequest = { matched = null }, sheetState = rememberModalBottomSheetState()) {
            Column(Modifier.padding(horizontal = 24.dp).padding(bottom = 32.dp)) {
                Text(
                    m.city?.let { L10n.t("loc.located_city", cityName(it)) } ?: L10n.t("loc.nearby_airports"),
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    if (m.city == null) L10n.t("loc.confirm_candidates_sub") else L10n.t("loc.recommended_airports"),
                    style = MaterialTheme.typography.labelMedium,
                    color = BrandInkSoft,
                )
                Spacer(Modifier.height(8.dp))
                m.candidates.forEach { candidate ->
                    val code = candidate.airport.iata
                    Row(
                        Modifier.fillMaxWidth().selectable(selected = chosenAirport == code, onClick = { chosenAirport = code }),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = chosenAirport == code, onClick = { chosenAirport = code })
                        Column(Modifier.weight(1f)) {
                            Text(
                                candidate.displayTitle(),
                                style = MaterialTheme.typography.bodyMedium,
                            )
                            Text(
                                "$code · ${L10n.t("loc.distance_approx", candidate.distanceKm.roundToInt())}",
                                style = MaterialTheme.typography.labelSmall,
                                color = BrandInkSoft,
                            )
                        }
                    }
                }
                Spacer(Modifier.height(14.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton(onClick = {
                        val picked = m.candidates.firstOrNull { it.airport.iata == chosenAirport } ?: m.candidates.firstOrNull()
                        if (picked != null) {
                            matched = null
                            coordinator.onOriginConfirmed()
                            onConfirm(
                                LocationSelection(picked.city.cityId, LocationSelectionMode.AIRPORT, picked.airport.iata),
                                LocationEvents.SOURCE_CURRENT_LOCATION,
                            )
                        }
                    }) { Text(L10n.t("loc.use_recommended"), color = BrandPrimary, textAlign = TextAlign.Start) }
                    val matchedCity = m.city
                    if (matchedCity != null) {
                        TextButton(onClick = {
                            matched = null
                            coordinator.onOriginConfirmed()
                            onConfirm(
                                LocationSelection(matchedCity.cityId, LocationSelectionMode.ALL_AIRPORTS),
                                LocationEvents.SOURCE_CURRENT_LOCATION,
                            )
                        }) {
                            Text(
                                "${L10n.t("loc.all_airports")}（${matchedCity.airports.joinToString(" / ") { it.iata }}）",
                                color = BrandPrimary,
                                textAlign = TextAlign.Start,
                            )
                        }
                    }
                }
            }
        }
    }
}

/** 各降级终态的提示文案；Idle / 请求中 / 定位中 / 已匹配 返回 null（不占位）。 */
@Composable
private fun statusText(state: LocationUiState): String? = when (state) {
    is LocationUiState.PermissionDenied -> L10n.t("loc.err_permission_denied")
    LocationUiState.LocationDisabled -> L10n.t("loc.err_service_disabled")
    LocationUiState.TimedOut -> L10n.t("loc.err_timeout")
    LocationUiState.Unavailable -> L10n.t("loc.err_play_services")
    LocationUiState.NoNearbyCity -> L10n.t("loc.err_no_nearby")
    else -> null
}

private fun NearbyCandidate.displayTitle(): String = "${cityName(city)} · ${airportName(airport)}"

private fun openLocationSettings(context: Context) {
    runCatching {
        context.startActivity(Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

private fun openAppSettings(context: Context) {
    runCatching {
        context.startActivity(
            Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", context.packageName, null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        )
    }
}

private fun Context.findActivity(): Activity? {
    var ctx: Context = this
    while (ctx is ContextWrapper) {
        if (ctx is Activity) return ctx
        ctx = ctx.baseContext
    }
    return null
}
