package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.BookingDto
import com.yuanhe.layoverjoy.data.MonitorDto
import com.yuanhe.layoverjoy.data.MonitorStatusInput
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.Badge
import com.yuanhe.layoverjoy.ui.EmptyBlock
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.Routes
import com.yuanhe.layoverjoy.ui.SectionTitle
import com.yuanhe.layoverjoy.ui.bookingStatusColor
import com.yuanhe.layoverjoy.ui.bookingStatusText
import com.yuanhe.layoverjoy.ui.fmtDateTime
import com.yuanhe.layoverjoy.ui.fmtPrice
import com.yuanhe.layoverjoy.ui.theme.BrandDanger
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import com.yuanhe.layoverjoy.ui.i18n.L10n
import kotlinx.coroutines.launch

/** 行程页：方案监控 + 已预订订单。 */
@Composable
fun TripsScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var monitors by remember { mutableStateOf<List<MonitorDto>>(emptyList()) }
    var bookings by remember { mutableStateOf<List<BookingDto>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var pendingDelete by remember { mutableStateOf<MonitorDto?>(null) }

    suspend fun load() {
        error = null
        when (val m = apiCall { Net.api.monitors(L10n.current.tag) }) {
            is ApiResult.Ok -> monitors = m.data.monitors
            is ApiResult.Err -> error = m.message
        }
        when (val b = apiCall { Net.api.bookings() }) {
            is ApiResult.Ok -> bookings = b.data.bookings
            is ApiResult.Err -> if (error == null) error = b.message
        }
    }

    LaunchedEffect(Unit) { load() }

    // 从订单详情页（支付/退款/刷新后）返回时自动拉取最新状态，保证列表与详情一致。
    val lifecycleOwner = LocalLifecycleOwner.current
    DisposableEffect(lifecycleOwner) {
        val observer = LifecycleEventObserver { _, event ->
            if (event == Lifecycle.Event.ON_RESUME) scope.launch { load() }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
        item {
            Spacer(Modifier.height(20.dp))
            Text(L10n.t("trips.title"), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(4.dp))
            TextButton(onClick = { nav.navigate(Routes.NOTIFICATIONS) }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
                Text(L10n.t("trips.notifications"), color = BrandPrimary, style = MaterialTheme.typography.labelMedium)
            }
            ErrorBanner(error)
        }

        item { SectionTitle(L10n.t("trips.monitors")) }
        if (monitors.isEmpty()) {
            item { EmptyBlock(L10n.t("trips.no_monitors")) }
        } else {
            items(monitors, key = { it.monitorId }) { m ->
                MonitorCard(m, onPauseToggle = {
                    scope.launch {
                        val next = if (m.status == "ACTIVE") "PAUSED" else "ACTIVE"
                        apiCall { Net.api.setMonitorStatus(m.monitorId, MonitorStatusInput(next)) }
                        load()
                    }
                }, onDelete = { pendingDelete = m })
            }
        }

        item { SectionTitle(L10n.t("trips.booked")) }
        if (bookings.isEmpty()) {
            item {
                EmptyBlock(L10n.t("trips.no_bookings"))
                Spacer(Modifier.height(24.dp))
            }
        } else {
            items(bookings, key = { it.bookingId }) { b -> BookingCard(b) { nav.navigate(Routes.bookingStatus(b.bookingId)) } }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }

    // 删除监控：确认后调用后端删除接口（物理删除，不再轮询）。
    pendingDelete?.let { m ->
        AlertDialog(
            onDismissRequest = { pendingDelete = null },
            title = { Text(L10n.t("common.delete"), style = MaterialTheme.typography.titleSmall) },
            text = { Text(L10n.t("trips.delete_confirm"), style = MaterialTheme.typography.bodySmall) },
            confirmButton = {
                TextButton(onClick = {
                    pendingDelete = null
                    scope.launch {
                        apiCall { Net.api.deleteMonitor(m.monitorId) }
                        load()
                    }
                }) { Text(L10n.t("common.delete"), color = BrandDanger) }
            },
            dismissButton = {
                TextButton(onClick = { pendingDelete = null }) { Text(L10n.t("common.cancel"), color = BrandInkSoft) }
            },
        )
    }
}

/** 监控卡：暂停/恢复 + 删除（删除为物理移除，不再轮询）。 */
@Composable
private fun MonitorCard(m: MonitorDto, onPauseToggle: () -> Unit, onDelete: () -> Unit) {
    JoyCard(Modifier.padding(vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(m.routeLabel, style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
            Badge(if (m.status == "ACTIVE") L10n.t("trips.monitor_active") else L10n.t("trips.monitor_paused"), color = if (m.status == "ACTIVE") BrandPrimary else BrandInkSoft, bg = if (m.status == "ACTIVE") BrandPrimary.copy(alpha = 0.1f) else BrandInkSoft.copy(alpha = 0.08f))
        }
        Spacer(Modifier.height(6.dp))
        Text(
            buildString {
                m.targetAirfare?.let { append(L10n.t("trips.target_fare", it)) }
                m.minJoyScore?.let { if (isNotEmpty()) append(" · "); append(L10n.t("trips.min_joy", it)) }
                if (isEmpty()) append(L10n.t("trips.no_trigger"))
            },
            style = MaterialTheme.typography.bodySmall,
        )
        Text(
            if (m.lastCheckedAt != null) L10n.t("trips.last_checked", fmtDateTime(m.lastCheckedAt!!)) else L10n.t("trips.first_check"),
            style = MaterialTheme.typography.labelSmall,
            color = BrandInkSoft,
        )
        if (m.lastTriggeredAt != null) {
            Text(L10n.t("trips.last_triggered", fmtDateTime(m.lastTriggeredAt!!)), style = MaterialTheme.typography.labelSmall, color = BrandPrimary)
        }
        Spacer(Modifier.height(8.dp))
        Row {
            TextButton(onClick = onPauseToggle) { Text(if (m.status == "ACTIVE") L10n.t("trips.pause") else L10n.t("trips.resume"), color = BrandPrimary) }
            TextButton(onClick = onDelete) { Text(L10n.t("common.delete"), color = BrandDanger) }
        }
    }
}

/** 已预订订单卡：点击直达订单详情页（支付/退款/出票等操作都在详情页完成，流程闭环）。 */
@Composable
private fun BookingCard(b: BookingDto, onClick: () -> Unit) {
    val color = bookingStatusColor(b.status)
    JoyCard(Modifier.padding(vertical = 6.dp).clickable(onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(bookingStatusText(b.status), style = MaterialTheme.typography.titleSmall, color = color, fontWeight = FontWeight.SemiBold)
                Text(L10n.t("trips.created_at", fmtDateTime(b.createdAt)), style = MaterialTheme.typography.labelSmall)
                if (b.expiresAt != null && b.status == "PAYMENT_PENDING") {
                    Text(L10n.t("trips.pay_window", fmtDateTime(b.expiresAt!!)), style = MaterialTheme.typography.labelSmall, color = color)
                }
            }
            Column(horizontalAlignment = Alignment.End) {
                Text(fmtPrice(b.acceptedTotal, b.currency), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                Text(L10n.t("trips.view_detail"), style = MaterialTheme.typography.labelSmall, color = BrandPrimary, textAlign = TextAlign.End)
            }
        }
    }
}
