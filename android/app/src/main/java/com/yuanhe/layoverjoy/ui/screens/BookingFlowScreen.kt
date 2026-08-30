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
import com.yuanhe.layoverjoy.data.ConfirmPriceRequest
import com.yuanhe.layoverjoy.data.DemoFlags
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.PassengerInput
import com.yuanhe.layoverjoy.data.PayRequest
import com.yuanhe.layoverjoy.data.PlanDetailDto
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.Badge
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.apiErrorText
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.LoadingBlock
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.SecondaryButton
import com.yuanhe.layoverjoy.ui.SectionTitle
import com.yuanhe.layoverjoy.ui.bookingStatusColor
import com.yuanhe.layoverjoy.ui.bookingStatusText
import com.yuanhe.layoverjoy.ui.cityDisplayName
import com.yuanhe.layoverjoy.ui.fmtDateTime
import com.yuanhe.layoverjoy.ui.fmtPrice
import com.yuanhe.layoverjoy.ui.legStatusText
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
 *
 * [initialBookingId] 非空时为“订单详情”模式（行程页点击已预订订单直达）：
 * 先按订单 id 拉取状态，再按其 planId 补拉方案摘要，直接落在状态机页。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BookingFlowScreen(nav: NavController, planId: String, initialBookingId: String? = null) {
    val scope = rememberCoroutineScope()
    val statusMode = !initialBookingId.isNullOrBlank()

    var phase by remember { mutableIntStateOf(if (statusMode) 2 else 0) } // 0 表单, 1 确认, 2 状态机
    var detail by remember { mutableStateOf<PlanDetailDto?>(null) }
    var booking by remember { mutableStateOf<BookingDto?>(null) }
    var givenName by remember { mutableStateOf("") }
    var familyName by remember { mutableStateOf("") }
    var riskAck by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var notice by remember { mutableStateOf<String?>(null) }

    suspend fun refreshBooking(id: String) {
        when (val r = apiCall { Net.api.booking(id) }) {
            is ApiResult.Ok -> booking = r.data.booking
            is ApiResult.Err -> error = apiErrorText(r)
        }
    }

    LaunchedEffect(planId, initialBookingId) {
        if (statusMode) {
            // 订单详情直达：先拿订单状态，再用订单关联的 planId 补拉方案（失败不阻塞状态页）。
            when (val r = apiCall { Net.api.booking(initialBookingId!!) }) {
                is ApiResult.Ok -> {
                    booking = r.data.booking
                    phase = 2
                    val pid = r.data.booking.planId
                    if (pid.isNotBlank()) {
                        when (val p = apiCall { Net.api.planDetail(pid, L10n.current.tag) }) {
                            is ApiResult.Ok -> detail = p.data
                            is ApiResult.Err -> { /* 方案摘要缺失不影响订单状态页 */ }
                        }
                    }
                }
                is ApiResult.Err -> error = apiErrorText(r)
            }
        } else {
            when (val r = apiCall { Net.api.planDetail(planId, L10n.current.tag) }) {
                is ApiResult.Ok -> detail = r.data
                is ApiResult.Err -> error = apiErrorText(r)
            }
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(if (phase < 2) L10n.t("booking.title") else L10n.t("booking.title_status")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )

        val d = detail
        // 订单详情模式下方案摘要可缺：状态机页不依赖它，不能被加载闸门卡住。
        if (d == null && !statusMode) {
            ErrorBanner(error, Modifier.padding(20.dp))
            if (error == null) LoadingBlock(L10n.t("detail.loading"))
            return@Column
        }
        if (statusMode && booking == null) {
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
                    }
                    Spacer(Modifier.height(16.dp))
                    PrimaryButton(
                        text = L10n.t("booking.next_confirm"),
                        enabled = riskAck,
                        onClick = { error = null; phase = 1 },
                    )
                }
                1 -> {
                    // 确认页依赖方案摘要；详情直达模式不会进入本相位，摘要缺失时直接退出。
                    val dd = d ?: return@Column
                    SectionTitle(L10n.t("booking.confirm_title"))
                    Spacer(Modifier.height(8.dp))
                    EligibilityRiskNotice(dd.eligibility?.status)
                    JoyCard {
                        dd.legs.forEach { leg ->
                            Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                                Text(L10n.t("common.leg_no", leg.legNo) + " ${cityDisplayName(leg.origin)} → ${cityDisplayName(leg.destination)}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
                                Text(fmtPrice(leg.totalPrice, leg.currency), style = MaterialTheme.typography.bodyMedium)
                            }
                            Text("${leg.carrier ?: ""} ${leg.flightNumber ?: ""} · ${fmtDateTime(leg.departureAt)}", style = MaterialTheme.typography.labelSmall)
                            Spacer(Modifier.height(4.dp))
                        }
                        Spacer(Modifier.height(6.dp))
                        Row(Modifier.fillMaxWidth()) {
                            Text(L10n.t("booking.total"), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                            Text(fmtPrice(dd.airfareTotal, dd.currency), style = MaterialTheme.typography.titleSmall, color = BrandPrimary, fontWeight = FontWeight.Bold)
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
                                    legBFailure = if (DemoFlags.injectLegBFailure) true else null,
                                )
                                when (val r = apiCall { Net.api.compositeOrder(req) }) {
                                    is ApiResult.Ok -> {
                                        booking = r.data.booking
                                        phase = 2
                                    }
                                    is ApiResult.Err -> {
                                        error = apiErrorText(r)
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
                        EligibilityRiskNotice(b.eligibilityNotice?.decision ?: d?.eligibility?.status)
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
                                    Text(legStatusText(o.legState.ifEmpty { o.status }), style = MaterialTheme.typography.bodySmall, color = BrandInkSoft)
                                    Text(o.orderNoLast4?.let { L10n.t("booking.leg_last4", it) } ?: "", style = MaterialTheme.typography.bodySmall, color = BrandInkSoft)
                                }
                            }
                            if (b.expiresAt != null) {
                                Text(L10n.t("trips.pay_window", fmtDateTime(b.expiresAt!!)), style = MaterialTheme.typography.labelSmall, color = BrandAccent)
                            }
                        }
                        Spacer(Modifier.height(16.dp))

                        when (b.status) {
                            "PRICE_CONFIRMATION_REQUIRED" -> {
                                // 涨价检查点：展示原价/新价/差额/报价有效期，用户明确确认后才继续（绝不自动下单）。
                                val pc = b.priceConfirmation
                                JoyCard {
                                    Text(L10n.t("booking.price_changed_title"), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                    Spacer(Modifier.height(6.dp))
                                    if (pc != null) {
                                        Text(L10n.t("booking.price_old", fmtPrice(pc.previousTotal ?: b.acceptedTotal, pc.currency.ifEmpty { b.currency })), style = MaterialTheme.typography.bodySmall)
                                        Text(L10n.t("booking.price_new", fmtPrice(pc.newTotal, pc.currency.ifEmpty { b.currency })), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, color = BrandAccent)
                                        Text(L10n.t("booking.price_delta", "%.2f".format(pc.delta)), style = MaterialTheme.typography.bodySmall, color = BrandInkSoft)
                                        pc.offerExpiresAt?.let { Text(L10n.t("booking.offer_valid_until", fmtDateTime(it)), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft) }
                                    }
                                }
                                Spacer(Modifier.height(10.dp))
                                PrimaryButton(
                                    text = if (pc != null) L10n.t("booking.price_confirm_btn", fmtPrice(pc.newTotal, pc.currency.ifEmpty { b.currency })) else L10n.t("booking.price_confirm_fallback"),
                                    loading = loading,
                                    onClick = {
                                        loading = true
                                        scope.launch {
                                            val target = pc?.newTotal ?: b.acceptedTotal
                                            when (val r = apiCall { Net.api.confirmPrice(b.bookingId, ConfirmPriceRequest(target, pc?.currency)) }) {
                                                is ApiResult.Ok -> booking = r.data.booking
                                                is ApiResult.Err -> {
                                                    error = apiErrorText(r)
                                                    refreshBooking(b.bookingId)
                                                }
                                            }
                                            loading = false
                                        }
                                    },
                                )
                                Spacer(Modifier.height(8.dp))
                                Text(L10n.t("booking.price_confirm_note"), style = MaterialTheme.typography.labelSmall)
                            }
                            "PAYMENT_PENDING" -> {
                                if (b.isSandboxPayment) {
                                    // Sandbox 付款摘要：航班/金额/币种/支付截止/涨价标识 + 含准确金额的确认按钮。
                                    val payTotal = b.orders.mapNotNull { it.amount }.sum().takeIf { it > 0 } ?: b.acceptedTotal
                                    val payCurrency = b.orders.firstNotNullOfOrNull { it.currency } ?: b.currency
                                    val deadline = b.orders.firstNotNullOfOrNull { it.paymentDeadlineAt }
                                    JoyCard {
                                        Text(L10n.t("booking.pay_summary_title"), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                        Spacer(Modifier.height(6.dp))
                                        Row {
                                            Badge(L10n.t("home.provider_atlas"), color = BrandAccent, bg = BrandAccent.copy(alpha = 0.10f))
                                            Spacer(Modifier.width(6.dp))
                                            if (b.priceIncreased) Badge(L10n.t("booking.price_increased_badge"), color = BrandDanger, bg = BrandDanger.copy(alpha = 0.10f))
                                        }
                                        Spacer(Modifier.height(8.dp))
                                        b.orders.forEach { o ->
                                            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                                                Text(L10n.t("booking.leg_order", o.legNo), style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
                                                Text(o.amount?.let { fmtPrice(it, o.currency ?: payCurrency) } ?: "--", style = MaterialTheme.typography.bodySmall)
                                            }
                                        }
                                        Spacer(Modifier.height(4.dp))
                                        Row(Modifier.fillMaxWidth()) {
                                            Text(L10n.t("booking.pay_total"), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                                            Text(fmtPrice(payTotal, payCurrency), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Bold)
                                        }
                                        deadline?.let { Text(L10n.t("booking.pay_deadline", fmtDateTime(it)), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft) }
                                        Spacer(Modifier.height(4.dp))
                                        Text(L10n.t("booking.sandbox_pay_note"), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                                    }
                                    Spacer(Modifier.height(10.dp))
                                    PrimaryButton(
                                        // 付款按钮必须包含准确金额与币种，禁止含糊文案。
                                        text = L10n.t("booking.sandbox_pay_amount", payCurrency, "%.2f".format(payTotal)),
                                        loading = loading,
                                        onClick = {
                                            loading = true
                                            scope.launch {
                                                val tokens = b.orders.mapNotNull { it.paymentConfirmationId }
                                                when (val r = apiCall { Net.api.pay(b.bookingId, PayRequest(tokens)) }) {
                                                    is ApiResult.Ok -> booking = r.data.booking
                                                    is ApiResult.Err -> {
                                                        error = apiErrorText(r)
                                                        refreshBooking(b.bookingId)
                                                    }
                                                }
                                                loading = false
                                            }
                                        },
                                    )
                                    Spacer(Modifier.height(8.dp))
                                    Text(L10n.t("booking.no_auto_retry"), style = MaterialTheme.typography.labelSmall)
                                } else {
                                    PrimaryButton(
                                        text = L10n.t("booking.mock_pay"),
                                        loading = loading,
                                        onClick = {
                                            loading = true
                                            scope.launch {
                                                when (val r = apiCall { Net.api.mockPay(b.bookingId) }) {
                                                    is ApiResult.Ok -> booking = r.data.booking
                                                    is ApiResult.Err -> {
                                                        error = apiErrorText(r)
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
                            }
                            "TICKETING_IN_PROGRESS" -> {
                                // TICKETING_PENDING 不是失败：展示“出票处理中”，允许稍后刷新。
                                InfoBanner(L10n.t("booking.ticketing_banner"))
                                Spacer(Modifier.height(10.dp))
                                SecondaryButton(
                                    text = if (loading) L10n.t("common.processing") else L10n.t("booking.ticketing_refresh"),
                                    enabled = !loading,
                                    onClick = {
                                        loading = true
                                        scope.launch {
                                            when (val r = apiCall { Net.api.refreshTicketing(b.bookingId) }) {
                                                is ApiResult.Ok -> booking = r.data.booking
                                                is ApiResult.Err -> error = apiErrorText(r)
                                            }
                                            loading = false
                                        }
                                    },
                                )
                            }
                            "PARTIAL_ORDER" -> {
                                // 隐藏终态：正常演示不会到达（仅开发页开关可注入）；文案不暴露内部实现。
                                InfoBanner(L10n.t("booking.partial_support"))
                            }
                            "COMPLETED" -> {
                                InfoBanner(if (b.isSandboxPayment) L10n.t("booking.sandbox_completed_banner") else L10n.t("booking.completed_banner"))
                                // Sandbox 测试出票结果：订单号 / PNR / 测试票号（明确标注无真实扣款）。
                                val ticketed = b.orders.filter { it.orderNo != null || it.pnrList.isNotEmpty() || it.ticketNumbers.isNotEmpty() }
                                if (ticketed.isNotEmpty()) {
                                    Spacer(Modifier.height(10.dp))
                                    JoyCard {
                                        Text(L10n.t("booking.ticket_title"), style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
                                        Spacer(Modifier.height(6.dp))
                                        ticketed.forEach { o ->
                                            Text(L10n.t("booking.leg_order", o.legNo), style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                                            o.orderNo?.let { Text(L10n.t("booking.ticket_order_no", it), style = MaterialTheme.typography.bodySmall) }
                                            if (o.pnrList.isNotEmpty()) Text(L10n.t("booking.ticket_pnr", o.pnrList.joinToString(", ")), style = MaterialTheme.typography.bodySmall)
                                            if (o.ticketNumbers.isNotEmpty()) Text(L10n.t("booking.ticket_no", o.ticketNumbers.joinToString(", ")), style = MaterialTheme.typography.bodySmall)
                                            Spacer(Modifier.height(4.dp))
                                        }
                                        Text(L10n.t("booking.sandbox_ticket_note"), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                                    }
                                }
                                // 商业化产品形态：正常完成的订单不提供应用内退款入口（售后走客服渠道）。
                                // 补偿/模拟退款能力仅保留在后端与开发页开关注入的隐藏终态，不在主流程展示。
                            }
                            "SIMULATED_REFUNDED", "SIMULATED_REFUND_PENDING", "REFUNDED_SIMULATED", "REFUND_PENDING_SIMULATED" -> {
                                InfoBanner(L10n.t("booking.refunded_banner"))
                                Spacer(Modifier.height(6.dp))
                                // UI 必须明示：这是模拟退款，Atlas 没有真实退款发生。
                                Text(L10n.t("booking.refund_simulated_note"), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                            }
                            "MANUAL_REVIEW", "MANUAL_ACTION_REQUIRED" -> {
                                InfoBanner(L10n.t("booking.unknown_query_note"))
                                Spacer(Modifier.height(10.dp))
                                SecondaryButton(L10n.t("common.refresh"), onClick = { scope.launch { refreshBooking(b.bookingId) } })
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

/**
 * 入境资格风险提示（非阻断）：仅当状态为需补资料/需人工核对/不适用时展示；
 * 免签“条件匹配”属正常路径不提示。不阻断下单，最终决定权在边检/领馆/航司。
 */
@Composable
private fun EligibilityRiskNotice(status: String?) {
    if (status == null) return
    val label = when (status) {
        "NEEDS_INFO" -> L10n.t("elig.badge_needs_info")
        "NEEDS_REVIEW" -> L10n.t("elig.badge_needs_review")
        "INELIGIBLE" -> L10n.t("elig.badge_ineligible")
        else -> return
    }
    InfoBanner(L10n.t("booking.eligibility_risk", label))
    Spacer(Modifier.height(10.dp))
}
