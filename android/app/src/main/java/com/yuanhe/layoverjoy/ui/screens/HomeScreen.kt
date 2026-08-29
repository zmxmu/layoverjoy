package com.yuanhe.layoverjoy.ui.screens

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
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.data.LocalDemoData
import com.yuanhe.layoverjoy.ui.Badge
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.Routes
import com.yuanhe.layoverjoy.ui.SectionTitle
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.theme.BrandAccent
import com.yuanhe.layoverjoy.ui.theme.BrandAmber
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary

/**
 * 首页。契约要求：仅使用本地数据展示灵感与 Agent 动态，
 * 不请求网络、不上传任何证件信息；真实搜索从“探索”页发起。
 */
@Composable
fun HomeScreen(nav: NavController) {
    LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
        item {
            Spacer(Modifier.height(20.dp))
            Text(L10n.t("home.title"), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Spacer(Modifier.height(6.dp))
            Text(
                L10n.t("home.demo_note"),
                style = MaterialTheme.typography.labelSmall,
            )
            Spacer(Modifier.height(16.dp))
        }

        item { SectionTitle(L10n.t("home.cities"), trailing = L10n.t("home.local_data")) }
        items(LocalDemoData.cities) { city ->
            JoyCard(modifier = Modifier.padding(vertical = 6.dp)) {
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
            JoyCard {
                LocalDemoData.agentActivities.forEach { a ->
                    Row(Modifier.fillMaxWidth().padding(vertical = 5.dp)) {
                        Text(a.time, style = MaterialTheme.typography.labelSmall, color = BrandAmber, modifier = Modifier.width(64.dp))
                        Text(a.text, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }

        item {
            Spacer(Modifier.height(16.dp))
            JoyCard {
                Text(L10n.t("home.cta_title"), style = MaterialTheme.typography.titleSmall)
                Spacer(Modifier.height(4.dp))
                Text(
                    L10n.t("home.cta_body"),
                    style = MaterialTheme.typography.bodySmall,
                )
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
