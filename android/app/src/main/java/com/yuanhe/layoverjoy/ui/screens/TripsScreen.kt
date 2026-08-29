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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
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

    suspend fun load() {
        error = null
        when (val m = apiCall { Net.api.monitors() }) {
            is ApiResult.Ok -> monitors = m.data.monitors
            is ApiResult.Err -> error = m.message
        }
        when (val b = apiCall { Net.api.bookings() }) {
            is ApiResult.Ok -> bookings = b.data.bookings
            is ApiResult.Err -> if (error == null) error = b.message
        }
    }

    LaunchedEffect(Unit) { load() }

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
                }, onStop = {
                    scope.launch {
                        apiCall { Net.api.setMonitorStatus(m.monitorId, MonitorStatusInput("STOPPED")) }
                        load()
                    }
                })
            }
        }

        item { SectionTitle(L10n.t("trips.booked")) }
        if (bookings.isEmpty()) {
            item {
                EmptyBlock(L10n.t("trips.no_bookings"))
                Spacer(Modifier.height(24.dp))
            }
        } else {
            items(bookings, key = { it.bookingId }) { b -> BookingCard(b) }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun MonitorCard(m: MonitorDto, onPauseToggle: () -> Unit, onStop: () -> Unit) {
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
            TextButton(onClick = onStop) { Text(L10n.t("trips.stop"), color = BrandInkSoft) }
        }
    }
}

@Composable
private fun BookingCard(b: BookingDto) {
    var expanded by remember { mutableStateOf(false) }
    val color = bookingStatusColor(b.status)
    JoyCard(Modifier.padding(vertical = 6.dp).clickable { expanded = !expanded }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(bookingStatusText(b.status), style = MaterialTheme.typography.titleSmall, color = color, fontWeight = FontWeight.SemiBold)
                Text(L10n.t("trips.created_at", fmtDateTime(b.createdAt)), style = MaterialTheme.typography.labelSmall)
            }
            Text(fmtPrice(b.acceptedTotal, b.currency), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
        }
        if (expanded) {
            Spacer(Modifier.height(10.dp))
            b.orders.forEach { o ->
                Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                    Text(L10n.t("trips.leg_order", o.legNo), style = MaterialTheme.typography.labelSmall, modifier = Modifier.weight(1f))
                    Text(o.status, style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                    Text(o.orderNoLast4?.let { L10n.t("trips.order_last4", it) } ?: "", style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                }
            }
            if (b.expiresAt != null && b.status == "PAYMENT_PENDING") {
                Text(L10n.t("trips.pay_window", fmtDateTime(b.expiresAt!!)), style = MaterialTheme.typography.labelSmall, color = color)
            }
            if (b.status == "PAYMENT_PENDING" || b.status == "PARTIAL_ORDER" || b.status == "COMPLETED" || b.status == "SIMULATED_REFUNDED") {
                Text(L10n.t("trips.review_only"), style = MaterialTheme.typography.labelSmall)
            }
        }
    }
}
