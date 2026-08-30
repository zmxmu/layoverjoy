package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.BookingDto
import com.yuanhe.layoverjoy.data.HomeOpportunityResponse
import com.yuanhe.layoverjoy.data.LocalDemoData
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.OpportunityDetail
import com.yuanhe.layoverjoy.data.SearchPrefill
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.AppStateViewModel
import com.yuanhe.layoverjoy.ui.Badge
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.Routes
import com.yuanhe.layoverjoy.ui.SectionTitle
import com.yuanhe.layoverjoy.ui.bookingStatusColor
import com.yuanhe.layoverjoy.ui.bookingStatusText
import com.yuanhe.layoverjoy.ui.fmtPrice
import com.yuanhe.layoverjoy.ui.guardedNavigate
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.theme.BrandAccent
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandLine
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope

/**
 * 首页三层（11-执行方案 §3.2）：继续你的行程 → 我的最佳中转机会 → 精选中转灵感。
 * 机会卡只读后端已落库的搜索结果；灵感区保持本地示例并可点击预填搜索。
 */
@Composable
fun HomeScreen(nav: NavController, appState: AppStateViewModel) {
    var latestBooking by remember { mutableStateOf<BookingDto?>(null) }
    var unread by remember { mutableIntStateOf(0) }
    // null = 加载中（骨架占位）；Err 降级为 EMPTY 样式，不影响其余区域。
    var opportunity by remember { mutableStateOf<ApiResult<HomeOpportunityResponse>?>(null) }

    // 登录后并行拉取：预订、未读通知、机会卡，互不阻塞、互不拖累。
    LaunchedEffect(appState.isLoggedIn) {
        if (!appState.isLoggedIn) {
            latestBooking = null
            unread = 0
            opportunity = null
            return@LaunchedEffect
        }
        coroutineScope {
            val bookings = async { apiCall { Net.api.bookings() } }
            val notifications = async { apiCall { Net.api.notifications("true") } }
            val opp = async { apiCall { Net.api.homeOpportunity() } }
            latestBooking = when (val r = bookings.await()) {
                is ApiResult.Ok -> r.data.bookings.maxByOrNull { it.createdAt }
                else -> null
            }
            unread = when (val r = notifications.await()) {
                is ApiResult.Ok -> r.data.notifications.size
                else -> 0
            }
            opportunity = opp.await()
        }
    }

    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Spacer(Modifier.height(20.dp))
            Text(L10n.t("home.title"), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(16.dp))
        }

        item {
            SectionTitle(L10n.t("home.continue_title"))
            if (appState.isLoggedIn) {
                JoyCard(modifier = Modifier.clickable { guardedNavigate(nav, appState, Routes.TRIPS) }) {
                    val b = latestBooking
                    if (b != null) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(fmtPrice(b.acceptedTotal, b.currency), style = MaterialTheme.typography.titleMedium, modifier = Modifier.weight(1f))
                            Badge(bookingStatusText(b.status), color = bookingStatusColor(b.status), bg = bookingStatusColor(b.status).copy(alpha = 0.1f))
                        }
                    } else {
                        Text(L10n.t("home.continue_no_booking"), style = MaterialTheme.typography.bodySmall, color = BrandInkSoft)
                    }
                    if (unread > 0) {
                        Spacer(Modifier.height(4.dp))
                        TextButton(onClick = { guardedNavigate(nav, appState, Routes.NOTIFICATIONS) }, contentPadding = PaddingValues(0.dp)) {
                            Text(L10n.t("home.continue_unread", unread), color = BrandPrimary, style = MaterialTheme.typography.labelMedium)
                        }
                    }
                }
            } else {
                // 游客：登录引导卡，登录后直达探索页。
                JoyCard(modifier = Modifier.clickable { guardedNavigate(nav, appState, Routes.SEARCH) }) {
                    Text(L10n.t("home.continue_guest"), style = MaterialTheme.typography.bodySmall)
                    Spacer(Modifier.height(4.dp))
                    Text(L10n.t("home.opportunity_search"), style = MaterialTheme.typography.labelMedium, color = BrandPrimary)
                }
            }
        }

        item {
            Spacer(Modifier.height(12.dp))
            HomeOpportunityCard(nav, appState, opportunity)
        }

        item {
            Spacer(Modifier.height(12.dp))
            SectionTitle(L10n.t("home.cities"), trailing = L10n.t("home.cities_sub"))
        }
        items(LocalDemoData.cities) { city ->
            // 灵感即可行动：点击预填目的地并进入探索页（未登录则先登录再回跳）。
            JoyCard(modifier = Modifier.padding(vertical = 6.dp).clickable {
                SearchPrefill.destinationCityId = city.cityId
                guardedNavigate(nav, appState, Routes.SEARCH)
            }) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("${city.cityNameZh} · ${city.cityNameEn}", style = MaterialTheme.typography.titleMedium)
                        Spacer(Modifier.height(4.dp))
                        Text(city.entryLabel, style = MaterialTheme.typography.bodySmall, color = BrandPrimary, fontWeight = FontWeight.Medium)
                    }
                    JoyScoreRing(city.joyScore)
                }
                Spacer(Modifier.height(10.dp))
                Text(city.highlight, style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(10.dp))
                Row {
                    Badge(L10n.t("common.days_badge", city.stayDays), color = BrandAccent, bg = BrandAccent.copy(alpha = 0.1f))
                    Spacer(Modifier.width(8.dp))
                    Badge(city.countryCode, color = BrandInkSoft, bg = BrandInkSoft.copy(alpha = 0.08f))
                }
            }
        }
    }
}

/** 「我的最佳中转机会」：覆盖 加载中/缺证件/空/就绪/过期/网络失败 全部状态（11-执行方案 §4）。 */
@Composable
private fun HomeOpportunityCard(nav: NavController, appState: AppStateViewModel, result: ApiResult<HomeOpportunityResponse>?) {
    SectionTitle(L10n.t("home.opportunity_title"))
    when {
        // 未登录：沿用上方游客引导卡，不重复一张卡。
        !appState.isLoggedIn -> return
        // 加载中：等高骨架占位，避免首页跳动。
        result == null -> JoyCard {
            repeat(3) {
                Box(Modifier.fillMaxWidth().height(18.dp).clip(RoundedCornerShape(6.dp)).background(BrandLine.copy(alpha = 0.35f)))
                Spacer(Modifier.height(10.dp))
            }
        }
        // 网络失败：降级为 EMPTY 样式，保留搜索入口，绝不白屏。
        result is ApiResult.Err -> OpportunityActionCard(
            body = L10n.t("home.opportunity_empty"),
            cta = L10n.t("home.opportunity_search"),
            onClick = { guardedNavigate(nav, appState, Routes.SEARCH) },
        )
        else -> {
            val resp = (result as ApiResult.Ok).data
            when (resp.state) {
                "NEEDS_DOCUMENT" -> OpportunityActionCard(
                    body = L10n.t("home.opportunity_needs_document"),
                    cta = L10n.t("home.opportunity_add_document"),
                    onClick = { guardedNavigate(nav, appState, Routes.DOCUMENTS) },
                )
                "READY", "STALE" -> resp.opportunity?.let { OpportunityReadyCard(nav, appState, it, resp.eligibleHubCount, resp.state == "STALE") }
                    ?: OpportunityActionCard(
                        body = L10n.t("home.opportunity_empty"),
                        cta = L10n.t("home.opportunity_search"),
                        onClick = { guardedNavigate(nav, appState, Routes.SEARCH) },
                    )
                else -> OpportunityActionCard(
                    body = L10n.t("home.opportunity_empty"),
                    cta = L10n.t("home.opportunity_search"),
                    onClick = { guardedNavigate(nav, appState, Routes.SEARCH) },
                )
            }
        }
    }
}

/** NEEDS_DOCUMENT / EMPTY / 网络失败共用的行动卡：文案 + 全行可点 CTA（≥48dp）。 */
@Composable
private fun OpportunityActionCard(body: String, cta: String, onClick: () -> Unit) {
    JoyCard(modifier = Modifier.clickable(onClick = onClick)) {
        Text(body, style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(10.dp))
        Box(
            Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(12.dp)).background(BrandPrimary.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(cta, color = BrandPrimary, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
        }
    }
}

/** READY / STALE：路线、资格与来源徽章、四项核心指标、辅助证据、全行 CTA。 */
@Composable
private fun OpportunityReadyCard(
    nav: NavController,
    appState: AppStateViewModel,
    o: OpportunityDetail,
    eligibleHubCount: Int?,
    stale: Boolean,
) {
    JoyCard(modifier = Modifier.clickable { nav.navigate(Routes.planDetail(o.planId)) }) {
        // 路线：紧凑机场代码 + 中转停留胶囊，不用大箭头。
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(o.origin, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.width(8.dp))
            Box(Modifier.weight(1f).height(1.dp).background(BrandLine))
            Spacer(Modifier.width(8.dp))
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(o.hub, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, color = BrandPrimary)
                Spacer(Modifier.height(2.dp))
                Badge(L10n.t("common.days_badge", o.stayDays), color = BrandAccent, bg = BrandAccent.copy(alpha = 0.1f))
            }
            Spacer(Modifier.width(8.dp))
            Box(Modifier.weight(1f).height(1.dp).background(BrandLine))
            Spacer(Modifier.width(8.dp))
            Text(o.destination, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
        }
        Spacer(Modifier.height(10.dp))

        Row(verticalAlignment = Alignment.CenterVertically) {
            Badge(L10n.t("home.opportunity_eligible"), color = BrandPrimary, bg = BrandPrimary.copy(alpha = 0.1f))
            Spacer(Modifier.width(8.dp))
            Badge(providerLabel(o), color = BrandInkSoft, bg = BrandInkSoft.copy(alpha = 0.08f))
            if (stale) {
                Spacer(Modifier.width(8.dp))
                Badge(L10n.t("home.opportunity_stale"), color = BrandAccent, bg = BrandAccent.copy(alpha = 0.12f))
            }
        }
        Spacer(Modifier.height(12.dp))

        // 核心指标：价格差与可玩时间在视觉主位；窄屏自动降为纵向。
        MetricsGrid(o)
        Spacer(Modifier.height(10.dp))

        if (eligibleHubCount != null && eligibleHubCount > 0) {
            Text(L10n.t("home.opportunity_unlocked_count", eligibleHubCount), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
            Spacer(Modifier.height(8.dp))
        }
        Box(
            Modifier.fillMaxWidth().height(48.dp).clip(RoundedCornerShape(12.dp)).background(BrandPrimary.copy(alpha = 0.1f)),
            contentAlignment = Alignment.Center,
        ) {
            Text(L10n.t("home.opportunity_view"), color = BrandPrimary, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Medium)
        }
    }
}

/** 指标优先级固定：资格已在徽章；此处为 机票总价 / 差价 / 可玩时间 / JoyScore。 */
@Composable
private fun MetricsGrid(o: OpportunityDetail) {
    val items = buildList {
        o.airfareTotal?.let { add(L10n.t("home.opportunity_airfare_total", fmtPrice(it, o.currency))) }
        o.airfareDelta?.let { d ->
            add(
                if (d >= 0) L10n.t("home.opportunity_more_than_direct", fmtPrice(d, o.currency))
                else L10n.t("home.opportunity_less_than_direct", fmtPrice(-d, o.currency)),
            )
        }
        add(L10n.t("home.opportunity_usable_days", "%.1f".format(o.usableHours / 24)))
        add("JoyScore ${o.joyScore}")
    }
    androidx.compose.foundation.layout.BoxWithConstraints {
        if (maxWidth < 340.dp) {
            Column { items.forEach { MetricLine(it) } }
        } else {
            items.chunked(2).forEach { pair ->
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    pair.forEach { MetricLine(it, Modifier.weight(1f)) }
                }
            }
        }
    }
}

@Composable
private fun MetricLine(text: String, modifier: Modifier = Modifier) {
    Text(text, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium, modifier = modifier.padding(vertical = 3.dp), textAlign = TextAlign.Start)
}

/** Provider 标签规则（11-执行方案 §5.4）：生产/沙箱/演示样本必须如实区分。 */
private fun providerLabel(o: OpportunityDetail): String = when {
    o.sourceProvider == "ATLAS_PRODUCTION" && !o.isSimulated -> L10n.t("home.provider_atlas")
    o.sourceProvider == "ATLAS_SANDBOX" -> L10n.t("home.provider_atlas_sandbox")
    else -> L10n.t("home.provider_demo")
}

/** JoyScore 圆环（简化版）。 */
@Composable
fun JoyScoreRing(score: Int, size: Int = 56) {
    androidx.compose.foundation.layout.Box(
        Modifier.height(size.dp).width(size.dp),
        contentAlignment = Alignment.Center,
    ) {
        androidx.compose.foundation.Canvas(Modifier.fillMaxSize()) {
            val stroke = 6.dp.toPx()
            val pad = stroke / 2
            val arcSize = androidx.compose.ui.geometry.Size(this.size.width - stroke, this.size.height - stroke)
            drawArc(
                color = com.yuanhe.layoverjoy.ui.theme.BrandLine,
                startAngle = 0f,
                sweepAngle = 360f,
                useCenter = false,
                topLeft = androidx.compose.ui.geometry.Offset(pad, pad),
                size = arcSize,
                style = androidx.compose.ui.graphics.drawscope.Stroke(stroke),
            )
            drawArc(
                color = BrandPrimary,
                startAngle = -90f,
                sweepAngle = 360f * (score.coerceIn(0, 100) / 100f),
                useCenter = false,
                topLeft = androidx.compose.ui.geometry.Offset(pad, pad),
                size = arcSize,
                style = androidx.compose.ui.graphics.drawscope.Stroke(stroke, cap = androidx.compose.ui.graphics.StrokeCap.Round),
            )
        }
        Text("$score", style = MaterialTheme.typography.titleSmall, color = BrandPrimary, fontWeight = FontWeight.Bold)
    }
}
