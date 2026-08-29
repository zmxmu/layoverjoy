package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.BookingDto
import com.yuanhe.layoverjoy.data.LocalDemoData
import com.yuanhe.layoverjoy.data.Net
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
import com.yuanhe.layoverjoy.ui.theme.BrandAmber
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary

/**
 * 首页 = 漏斗入口：灵感卡/CTA 均可一键进入真实搜索（预填目的地），登录用户顶部展示真实行程状态。
 * 契约不变：首页自身不发网络请求展示灵感内容（仅登录用户的"继续行程"卡按需拉取本人数据）。
 */
@Composable
fun HomeScreen(nav: NavController, appState: AppStateViewModel) {
    var latestBooking by remember { mutableStateOf<BookingDto?>(null) }
    var unread by remember { mutableIntStateOf(0) }

    // 登录用户的"继续行程"卡：最新预订状态 + 未读通知数（真实数据）。
    LaunchedEffect(appState.isLoggedIn) {
        if (!appState.isLoggedIn) {
            latestBooking = null
            unread = 0
            return@LaunchedEffect
        }
        latestBooking = when (val r = apiCall { Net.api.bookings() }) {
            is ApiResult.Ok -> r.data.bookings.maxByOrNull { it.createdAt }
            else -> null
        }
        unread = when (val r = apiCall { Net.api.notifications("true") }) {
            is ApiResult.Ok -> r.data.notifications.size
            else -> 0
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
                    Text(L10n.t("home.cta_action"), style = MaterialTheme.typography.labelMedium, color = BrandPrimary)
                }
            }
        }

        item {
            Spacer(Modifier.height(12.dp))
            SectionTitle(L10n.t("home.cities"), trailing = L10n.t("home.cities_sub"))
        }
        items(LocalDemoData.cities) { city ->
            // 灵感即可行动：点击预填目的地并进入探索页（未登录则先登录再回跳）。
            JoyCard(modifier = Modifier.padding(vertical = 6.dp).clickable {
                SearchPrefill.destination = city.iata
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

        item { SectionTitle(L10n.t("home.agent_feed")) }
        item {
            JoyCard(modifier = Modifier.clickable { guardedNavigate(nav, appState, Routes.NOTIFICATIONS) }) {
                LocalDemoData.agentActivities.forEach { a ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                        Text(a.time, style = MaterialTheme.typography.labelSmall, color = BrandAmber, modifier = Modifier.width(64.dp))
                        Text(a.text, style = MaterialTheme.typography.bodySmall)
                    }
                }
                Spacer(Modifier.height(4.dp))
                Text(L10n.t("home.feed_hint"), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
            }
        }

        item {
            Spacer(Modifier.height(16.dp))
            JoyCard(modifier = Modifier.clickable { guardedNavigate(nav, appState, Routes.SEARCH) }) {
                Text(L10n.t("home.cta_title"), style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(4.dp))
                Text(
                    L10n.t("home.cta_body"),
                    style = MaterialTheme.typography.bodySmall,
                )
                Spacer(Modifier.height(8.dp))
                Text(L10n.t("home.cta_action"), style = MaterialTheme.typography.labelMedium, color = BrandPrimary, fontWeight = FontWeight.Medium)
            }
        }
    }
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
