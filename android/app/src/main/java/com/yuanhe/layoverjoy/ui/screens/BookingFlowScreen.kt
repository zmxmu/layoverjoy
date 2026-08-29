package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
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
import com.yuanhe.layoverjoy.data.CompositeOrderRequest
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.PassengerInput
import com.yuanhe.layoverjoy.data.PlanDetailDto
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.Badge
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.LoadingBlock
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.SecondaryButton
import com.yuanhe.layoverjoy.ui.SectionTitle
import com.yuanhe.layoverjoy.ui.bookingStatusColor
import com.yuanhe.layoverjoy.ui.bookingStatusText
import com.yuanhe.layoverjoy.ui.fmtDateTime
import com.yuanhe.layoverjoy.ui.fmtPrice
import com.yuanhe.layoverjoy.ui.theme.BrandAccent
import com.yuanhe.layoverjoy.ui.theme.BrandBackground
import com.yuanhe.layoverjoy.ui.theme.BrandDanger
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import com.yuanhe.layoverjoy.ui.i18n.L10n
import kotlinx.coroutines.launch

/**
 * 预订全流程（模拟）：乘客与风险确认 → 确认订单 → 状态机操作。
 * 契约：Order/Pay 绝不自动重放；结果不明确只查询；模拟退款标注无真实资金交易。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookingFlowScreen(nav: NavController, planId: String) {
    val scope = rememberCoroutineScope()

    var phase by remember { mutableIntStateOf(0) } // 0 表单, 1 确认, 2 状态机
    var detail by remember { mutableStateOf<PlanDetailDto?>(null) }
    var booking by remember { mutableStateOf<BookingDto?>(null) }
    var givenName by remember { mutableStateOf("") }
    var familyName by remember { mutableStateOf("") }
    var riskAck by remember { mutableStateOf(false) }
    var injectLegBFailure by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }

    suspend fun refreshBooking(id: String) {
        when (val r = apiCall { Net.api.booking(id) }) {
            is ApiResult.Ok -> booking = r.data.booking
            is ApiResult.Err -> error = r.message
        }
    }

    LaunchedEffect(planId) {
        when (val r = apiCall { Net.api.planDetail(planId) }) {
            is ApiResult.Ok -> detail = r.data
            is ApiResult.Err -> error = r.message
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(if (phase < 2) L10n.t("booking.title") else L10n.t("booking.title_status")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )

        val d = detail
        if (d == null) {
            ErrorBanner(error, Modifier.padding(20.dp))
            if (error == null) LoadingBlock(L10n.t("detail.loading"))
            return@Column
        }

        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
            Spacer(Modifier.height(8.dp))
            ErrorBanner(error)
            notice?.let { Spacer(Modifier.height(8.dp)); InfoBanner(it) }
            Spacer(Modifier.height(8.dp))

            when (phase) {
                0 -> {
                    SectionTitle(L10n.t("booking.passengers_title"))
                    JoyCard {
                        LabeledField(L10n.t("booking.given_name"), givenName, { givenName = it.uppercase() }, placeholder = "SAN")
                        Spacer(Modifier.height(10.dp))
                        LabeledField(L10n.t("booking.family_name"), familyName, { familyName = it.uppercase() }, placeholder = "ZHANG")
                        Spacer(Modifier.height(8.dp))
                        Text(L10n.t("booking.passenger_note"), style = MaterialTheme.typography.labelSmall)
                    }
                    Spacer(Modifier.height(12.dp))
                    SectionTitle(L10n.t("booking.risk_title"))
                    JoyCard {
                        RiskCheckItem(riskAck, { riskAck = it })
                        Spacer(Modifier.height(10.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(injectLegBFailure, { injectLegBFailure = it }, colors = CheckboxDefaults.colors(checkedColor = BrandDanger))
                            Column(Modifier.weight(1f)) {
                                Text(L10n.t("booking.inject_title"), style = MaterialTheme.typography.bodySmall, color = BrandDanger)
                                Text(L10n.t("booking.inject_sub"), style = MaterialTheme.typography.labelSmall)
                            }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton(
                        text = L10n.t("booking.next_confirm"),
                        enabled = riskAck,
                        onClick = { error = null; phase = 1 },
                    )
                }
                1 -> {
                    SectionTitle(L10n.t("booking.confirm_title"))
                    JoyCard {
                        d.legs.forEach { leg ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                                Text(L10n.t("common.leg_no", leg.legNo) + " ${leg.origin} → ${leg.destination}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                Text(fmtPrice(leg.totalPrice, leg.currency), style = MaterialTheme.typography.bodyMedium)
                            }
                            Text("${leg.carrier ?: ""} ${leg.flightNumber ?: ""} · ${fmtDateTime(leg.departureAt)}", style = MaterialTheme.typography.labelSmall)
                            Spacer(Modifier.height(4.dp))
                        }
                        Spacer(Modifier.height(6.dp))
                        Row(Modifier.fillMaxWidth()) {
                            Text(L10n.t("booking.total"), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                            Text(fmtPrice(d.airfareTotal, d.currency), style = MaterialTheme.typography.titleSmall, color = BrandPrimary, fontWeight = FontWeight.Bold)
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    InfoBanner(L10n.t("booking.separate_note"))
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton(
                        text = L10n.t("booking.create_orders"),
                        loading = loading,
                        onClick = {
                            loading = true
                            error = null
                            notice = null
                            scope.launch {
                                val req = CompositeOrderRequest(
                                    planId = planId,
                                    riskAckVersion = 1,
                                    passengers = if (givenName.isNotBlank() || familyName.isNotBlank()) {
                                        listOf(PassengerInput(givenName.ifBlank { null }, familyName.ifBlank { null }))
                                    } else null,
                                    legBFailure = if (injectLegBFailure) true else null,
                                )
                                when (val r = apiCall { Net.api.compositeOrder(req) }) {
                                    is ApiResult.Ok -> {
                                        booking = r.data.booking
                                        phase = 2
                                    }
                                    is ApiResult.Err -> {
                                        error = r.message
                                        if (r.code == "PARTIAL_BOOKING") {
                                            notice = L10n.t("booking.partial_notice")
                                            // 后端在错误细节里返回 intentId，用它加载部分订单并进入状态机页。
                                            val intentId = (r.details?.get("intentId") as? kotlinx.serialization.json.JsonPrimitive)?.content
                                            if (intentId != null) {
                                                when (val g = apiCall { Net.api.booking(intentId) }) {
                                                    is ApiResult.Ok -> {
                                                        booking = g.data.booking
                                                        phase = 2
                                                    }
                                                    is ApiResult.Err -> { /* 保留错误提示 */ }
                                                }
                                            }
                                        }
                                    }
                                }
                                loading = false
                            }
                        },
                    )
                    Spacer(Modifier.height(8.dp))
                    SecondaryButton(L10n.t("booking.back_edit"), onClick = { phase = 0 })
                }
                else -> {
                    val b = booking
                    if (b == null) {
                        LoadingBlock()
                    } else {
                        val color = bookingStatusColor(b.status)
                        SectionTitle(L10n.t("booking.order_status"))
                        JoyCard {
                            Text(bookingStatusText(b.status), style = MaterialTheme.typography.titleMedium, color = color, fontWeight = FontWeight.Bold)
                            Spacer(Modifier.height(6.dp))
                            Row {
                                Badge(b.sourceEnvironment, color = BrandInkSoft, bg = BrandInkSoft.copy(alpha = 0.08f))
                                Spacer(Modifier.width(6.dp))
                                Badge(L10n.t("booking.sim_no_charge"), color = BrandInkSoft, bg = BrandInkSoft.copy(alpha = 0.08f))
                            }
                            Spacer(Modifier.height(8.dp))
                            b.orders.forEach { o ->
                                Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                                    Text(L10n.t("booking.leg_order", o.legNo), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                                    Text(o.status, style = MaterialTheme.typography.bodySmall, color = BrandInkSoft)
                                    Text(o.orderNoLast4?.let { L10n.t("booking.leg_last4", it) } ?: "", style = MaterialTheme.typography.bodySmall, color = BrandInkSoft)
                                }
                            }
                            if (b.expiresAt != null) {
                                Text(L10n.t("trips.pay_window", fmtDateTime(b.expiresAt!!)), style = MaterialTheme.typography.labelSmall, color = BrandAccent)
                            }
                        }
                        Spacer(Modifier.height(16.dp))

                        when (b.status) {
                            "PAYMENT_PENDING" -> {
                                PrimaryButton(
                                    text = L10n.t("booking.mock_pay"),
                                    loading = loading,
                                    onClick = {
                                        loading = true
                                        scope.launch {
                                            when (val r = apiCall { Net.api.mockPay(b.bookingId) }) {
                                                is ApiResult.Ok -> booking = r.data.booking
                                                is ApiResult.Err -> {
                                                    error = r.message
                                                    refreshBooking(b.bookingId)
                                                }
                                            }
                                            loading = false
                                        }
                                    },
                                )
                                Spacer(Modifier.height(10.dp))
                                Text(L10n.t("booking.no_auto_retry"), style = MaterialTheme.typography.labelSmall)
                            }
                            "PARTIAL_ORDER" -> {
                                InfoBanner(L10n.t("booking.partial_banner"))
                                Spacer(Modifier.height(10.dp))
                                SecondaryButton(
                                    text = if (loading) L10n.t("common.processing") else L10n.t("booking.mock_refund"),
                                    enabled = !loading,
                                    onClick = {
                                        loading = true
                                        scope.launch {
                                            when (val r = apiCall { Net.api.mockRefund(b.bookingId) }) {
                                                is ApiResult.Ok -> booking = r.data.booking
                                                is ApiResult.Err -> error = r.message
                                            }
                                            loading = false
                                        }
                                    },
                                )
                            }
                            "COMPLETED" -> {
                                InfoBanner(L10n.t("booking.completed_banner"))
                                Spacer(Modifier.height(10.dp))
                                SecondaryButton(
                                    text = if (loading) L10n.t("common.processing") else L10n.t("booking.mock_refund"),
                                    enabled = !loading,
                                    onClick = {
                                        loading = true
                                        scope.launch {
                                            when (val r = apiCall { Net.api.mockRefund(b.bookingId) }) {
                                                is ApiResult.Ok -> booking = r.data.booking
                                                is ApiResult.Err -> error = r.message
                                            }
                                            loading = false
                                        }
                                    },
                                )
                            }
                            "SIMULATED_REFUNDED", "SIMULATED_REFUND_PENDING" -> {
                                InfoBanner(L10n.t("booking.refunded_banner"))
                            }
                            else -> {
                                SecondaryButton(L10n.t("common.refresh"), onClick = { scope.launch { refreshBooking(b.bookingId) } })
                            }
                        }
                        Spacer(Modifier.height(24.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun RiskCheckItem(checked: Boolean, onChecked: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.Top) {
        Checkbox(checked, onChecked, colors = CheckboxDefaults.colors(checkedColor = BrandPrimary))
        Column {
            Text(L10n.t("booking.risk_ack"), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
            Text(L10n.t("booking.risk1"), style = MaterialTheme.typography.bodySmall)
            Text(L10n.t("booking.risk2"), style = MaterialTheme.typography.bodySmall)
            Text(L10n.t("booking.risk4"), style = MaterialTheme.typography.bodySmall)
        }
    }
}
