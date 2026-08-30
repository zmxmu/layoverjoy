package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.PlanDetailDto
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.Badge
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LoadingBlock
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.Routes
import com.yuanhe.layoverjoy.ui.SecondaryButton
import com.yuanhe.layoverjoy.ui.SectionTitle
import com.yuanhe.layoverjoy.ui.fmtDateTime
import com.yuanhe.layoverjoy.ui.fmtPrice
import com.yuanhe.layoverjoy.ui.theme.BrandAccent
import com.yuanhe.layoverjoy.ui.theme.BrandAmber
import com.yuanhe.layoverjoy.ui.theme.BrandBackground
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import com.yuanhe.layoverjoy.ui.theme.BrandDanger
import com.yuanhe.layoverjoy.ui.i18n.AppLanguage
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.data.ExplanationPayload
import android.util.Log
import com.yuanhe.layoverjoy.BuildConfig
import kotlinx.coroutines.launch

/** 置信度 → i18n key。 */
private val CONFIDENCE_KEY = mapOf(
    "CONFIRMED" to "conf.confirmed",
    "SANDBOX" to "conf.sandbox",
    "ESTIMATE" to "conf.estimate",
    "RULE_BASED" to "conf.rule_based",
    "USER_BUDGET" to "conf.user_budget",
    "UNKNOWN" to "conf.unknown",
)

/** 风险标记 → i18n key。 */
private val RISK_KEY = mapOf(
    "SEPARATE_TICKETS" to "risk.separate_tickets",
    "RECHECK_BAGGAGE" to "risk.recheck_baggage",
)

/** 方案详情：航段、JoyScore 构成、费用估算、Agent 解释、资格证据与城市包。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PlanDetailScreen(nav: NavController, planId: String) {
    val scope = rememberCoroutineScope()
    var detail by remember { mutableStateOf<PlanDetailDto?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var explaining by remember { mutableStateOf(false) }
    var autoRequested by remember { mutableStateOf(false) }

    suspend fun load() {
        when (val r = apiCall { Net.api.planDetail(planId, L10n.current.tag) }) {
            is ApiResult.Ok -> {
                detail = r.data
                // 解释快照语言与当前 UI 语言不一致（切换语言/旧缓存）时按当前语言重新生成
                val p = r.data.explanation?.payload
                if (p != null && (p.lang ?: "zh") != L10n.current.tag) {
                    apiCall { Net.api.createExplanation(planId, L10n.current.tag) }
                    when (val r2 = apiCall { Net.api.planDetail(planId, L10n.current.tag) }) {
                        is ApiResult.Ok -> detail = r2.data
                        is ApiResult.Err -> {}
                    }
                }
            }
            is ApiResult.Err -> error = r.message
        }
    }

    LaunchedEffect(planId, L10n.current) {
        load()
        // AI-11：无推荐时自动生成，不需点击；后端失败也返回丰富模板，页面不停错误态。
        val cur = detail
        if (cur != null && cur.explanation == null && !autoRequested) {
            autoRequested = true
            explaining = true
            apiCall { Net.api.createExplanation(planId, L10n.current.tag) }
            load()
            explaining = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = {
                Text(
                    detail?.stopoverCity?.let {
                        val name = if (L10n.current == AppLanguage.EN) it.cityNameEn.ifBlank { it.cityNameZh } else it.cityNameZh.ifBlank { it.cityNameEn }
                        L10n.t("detail.title_city", name)
                    } ?: L10n.t("detail.title"),
                )
            },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )

        val d = detail
        if (d == null) {
            if (error != null) ErrorBanner(error, Modifier.padding(20.dp)) else LoadingBlock(L10n.t("detail.loading"))
        } else {
            LazyColumn(Modifier.weight(1f).padding(horizontal = 20.dp)) {
                item {
                    Spacer(Modifier.height(8.dp))
                    ErrorBanner(error)
                    JoyCard {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("JoyScore", style = MaterialTheme.typography.labelSmall)
                                Text("${d.joyScore} / 100", style = MaterialTheme.typography.titleLarge, color = BrandPrimary, fontWeight = FontWeight.Bold)
                                Spacer(Modifier.height(4.dp))
                                // 净体验窗口唯一展示位置（14 号方案 §4）
                                val ec = d.experienceContext
                                if (ec != null) {
                                    Text(
                                        if (L10n.current == AppLanguage.EN) ec.windowLabelEn else ec.windowLabelZh,
                                        style = MaterialTheme.typography.titleMedium,
                                        fontWeight = FontWeight.SemiBold,
                                    )
                                    Text(
                                        if (L10n.current == AppLanguage.EN) ec.budgetNoteEn else ec.budgetNoteZh,
                                        style = MaterialTheme.typography.labelSmall,
                                        color = BrandInkSoft,
                                    )
                                } else {
                                    Text(L10n.t("detail.usable", "%.0f".format(d.usableHours), d.stayDays), style = MaterialTheme.typography.labelSmall)
                                }
                            }
                            Column(horizontalAlignment = Alignment.End) {
                                Text(fmtPrice(d.airfareTotal, d.currency), style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold)
                                Text(
                                    if (d.airfareDelta > 0) L10n.t("results.delta_up", "%.0f ${d.currency}".format(d.airfareDelta)) else if (d.airfareDelta < 0) L10n.t("results.delta_down", "%.0f ${d.currency}".format(-d.airfareDelta)) else L10n.t("results.delta_flat"),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (d.airfareDelta > 0) BrandAccent else BrandPrimary,
                                )
                            }
                        }
                        if (d.joyScoreBreakdown.isNotEmpty()) {
                            Spacer(Modifier.height(10.dp))
                            d.joyScoreBreakdown.forEach { c ->
                                Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                                    Text(c.label ?: c.key, style = MaterialTheme.typography.labelSmall, modifier = Modifier.weight(1f))
                                    Text(L10n.t("common.points_suffix", "%.0f".format(c.points)), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                                }
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            d.riskFlags.forEach { flag ->
                                Badge(RISK_KEY[flag]?.let { L10n.t(it) } ?: flag, color = BrandDanger, bg = BrandDanger.copy(alpha = 0.08f))
                            }
                        }
                    }
                }

                item { SectionTitle(L10n.t("detail.legs_title")) }
                item {
                    JoyCard {
                        d.legs.forEachIndexed { i, leg ->
                            if (i > 0) Spacer(Modifier.height(10.dp))
                            Text(L10n.t("common.leg_no", leg.legNo), style = MaterialTheme.typography.labelSmall, color = BrandPrimary, fontWeight = FontWeight.SemiBold)
                            Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
                                Text("${leg.origin} → ${leg.destination}", style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                Text(fmtPrice(leg.totalPrice, leg.currency), style = MaterialTheme.typography.bodyMedium, color = BrandPrimary, fontWeight = FontWeight.SemiBold)
                            }
                            Text(L10n.t("detail.leg_time", fmtDateTime(leg.departureAt), fmtDateTime(leg.arrivalAt)) + " · ${leg.carrier ?: ""} ${leg.flightNumber ?: ""}", style = MaterialTheme.typography.labelSmall)
                        }
                    }
                }

                item {
                    val whyCity = d.stopoverCity?.let { if (L10n.current == AppLanguage.EN) it.cityNameEn.ifBlank { it.cityNameZh } else it.cityNameZh.ifBlank { it.cityNameEn } } ?: ""
                    SectionTitle(if (whyCity.isBlank()) L10n.t("detail.why_title") else L10n.t("detail.why_title_city", whyCity))
                }
                item {
                    JoyCard {
                        val payload = d.explanation?.payload
                        // AI-10：模型元数据仅 Debug 日志，脱敏后输出。
                        if (BuildConfig.DEBUG) {
                            val meta = payload?.debugMeta
                            Log.d(
                                "LayoverJoyAI",
                                "plan=${planId.takeLast(8)} " +
                                    "request=${meta?.requestId?.takeLast(8) ?: ""} " +
                                    "provider=${meta?.provider ?: d.explanation?.provider ?: ""} " +
                                    "model=${meta?.modelId ?: ""} " +
                                    "latencyMs=${meta?.latencyMs ?: -1} " +
                                    "deployment=${meta?.deploymentIdTail ?: ""} " +
                                    "fallback=${meta?.fallbackReason ?: ""} " +
                                    "prompt=${meta?.promptVersion ?: ""}",
                            )
                        }
                        when {
                            payload != null && payload.schemaVersion == "2.0" -> RichNarrativeCard(payload)
                            payload != null -> {
                                Text(payload.summary, style = MaterialTheme.typography.bodyMedium)
                                if (payload.highlights.isNotEmpty()) {
                                    Spacer(Modifier.height(8.dp))
                                    payload.highlights.forEach { Text("· $it", style = MaterialTheme.typography.bodySmall) }
                                }
                            }
                            explaining -> NarrativeSkeleton()
                            else -> Text(L10n.t("detail.why_empty"), style = MaterialTheme.typography.bodySmall)
                        }
                        Spacer(Modifier.height(10.dp))
                        if (payload != null) {
                            Text(L10n.t("detail.smart_note"), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                            Spacer(Modifier.height(8.dp))
                            SecondaryButton(
                                text = L10n.t("detail.adjust_prefs"),
                                onClick = { nav.popBackStack(Routes.SEARCH, false) },
                            )
                        } else {
                            SecondaryButton(
                                text = if (explaining) L10n.t("detail.why_generating") else L10n.t("detail.why_generate"),
                                enabled = !explaining,
                                onClick = {
                                    explaining = true
                                    scope.launch {
                                        apiCall { Net.api.createExplanation(planId, L10n.current.tag) }
                                        load()
                                        explaining = false
                                    }
                                },
                            )
                        }
                    }
                }

                if (d.cityPack != null) {
                    val cityName = d.stopoverCity?.let { if (L10n.current == AppLanguage.EN) it.cityNameEn.ifBlank { it.cityNameZh } else it.cityNameZh.ifBlank { it.cityNameEn } } ?: ""
                    item {
                        SectionTitle(
                            if (cityName.isBlank()) L10n.t("detail.citypack_title", L10n.t("detail.citypack_fallback")) else L10n.t("detail.citypack_title", cityName),
                            trailing = L10n.t("detail.citypack_trailing"),
                        )
                    }
                    item {
                        JoyCard {
                            Text(d.cityPack!!.airportToCity, style = MaterialTheme.typography.bodySmall, color = BrandPrimary)
                            Spacer(Modifier.height(8.dp))
                            Text(L10n.t("detail.attractions"), style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
                            Text(d.cityPack!!.attractions.joinToString(if (L10n.current == AppLanguage.EN) ", " else "、"), style = MaterialTheme.typography.bodySmall)
                            Spacer(Modifier.height(6.dp))
                            Text(L10n.t("detail.areas"), style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
                            Text(d.cityPack!!.areas.joinToString(if (L10n.current == AppLanguage.EN) ", " else "、"), style = MaterialTheme.typography.bodySmall)
                            if (d.cityPack!!.tips.isNotEmpty()) {
                                Spacer(Modifier.height(6.dp))
                                d.cityPack!!.tips.forEach { Text("· $it", style = MaterialTheme.typography.labelSmall, color = BrandInkSoft) }
                            }
                        }
                    }
                }

                item { SectionTitle(L10n.t("detail.cost_title")) }
                item {
                    val cb = d.costBreakdown
                    JoyCard {
                        if (cb == null) {
                            Text(L10n.t("detail.cost_empty"), style = MaterialTheme.typography.bodySmall)
                        } else {
                            cb.items.forEach { item ->
                                Row(Modifier.fillMaxWidth().padding(vertical = 3.dp)) {
                                    Column(Modifier.weight(1f)) {
                                        Text(costKeyText(item.key), style = MaterialTheme.typography.bodySmall)
                                        Text(CONFIDENCE_KEY[item.confidence]?.let { L10n.t(it) } ?: item.confidence, style = MaterialTheme.typography.labelSmall, color = BrandAmber)
                                    }
                                    Text(fmtPrice(item.amount, cb.currency), style = MaterialTheme.typography.bodySmall)
                                }
                            }
                            Spacer(Modifier.height(6.dp))
                            Row(Modifier.fillMaxWidth()) {
                                Text(L10n.t("detail.cost_total"), style = MaterialTheme.typography.titleSmall, modifier = Modifier.weight(1f))
                                Text(fmtPrice(cb.total, cb.currency), style = MaterialTheme.typography.titleSmall, color = BrandPrimary, fontWeight = FontWeight.Bold)
                            }
                        }
                    }
                }

                item { SectionTitle(L10n.t("detail.eligibility_title")) }
                item {
                    val e = d.eligibility
                    JoyCard {
                        if (e == null) {
                            Text(L10n.t("detail.eligibility_empty"), style = MaterialTheme.typography.bodySmall)
                        } else {
                            Text(L10n.t("detail.eligibility_status", if (e.status == "ELIGIBLE") L10n.t("detail.eligibility_ok") else e.status), style = MaterialTheme.typography.bodyMedium, color = if (e.status == "ELIGIBLE") BrandPrimary else BrandDanger, fontWeight = FontWeight.SemiBold)
                            Spacer(Modifier.height(4.dp))
                            Text(L10n.t("detail.eligibility_rule", e.ruleId ?: "-", e.ruleVersion ?: "-"), style = MaterialTheme.typography.labelSmall)
                            Text(L10n.t("detail.eligibility_verified", e.verifiedAt?.take(10) ?: "-"), style = MaterialTheme.typography.labelSmall)
                            if (e.sourceUrl != null) Text(L10n.t("detail.eligibility_source", e.sourceUrl), style = MaterialTheme.typography.labelSmall, color = BrandPrimary)
                        }
                    }
                    Spacer(Modifier.height(8.dp))
                    InfoBanner(L10n.t("detail.disclaimer"))
                    Spacer(Modifier.height(16.dp))
                    SecondaryButton(L10n.t("detail.setup_monitor"), onClick = { nav.navigate(Routes.monitorSetup(planId)) })
                    Spacer(Modifier.height(8.dp))
                    PrimaryButton(L10n.t("detail.book_now"), onClick = { nav.navigate(Routes.booking(planId)) })
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
private fun costKeyText(key: String): String = when (key) {
    "LEG_1_AIRFARE" -> L10n.t("cost.leg1")
    "LEG_2_AIRFARE" -> L10n.t("cost.leg2")
    "BAGGAGE_FEES" -> L10n.t("cost.baggage")
    "HOTEL" -> L10n.t("cost.hotel")
    "AIRPORT_TRANSFER" -> L10n.t("cost.transfer")
    "VISA_FEE" -> L10n.t("cost.visa")
    "ACTIVITIES_FOOD" -> L10n.t("cost.activities")
    else -> key
}

/** v2 丰富解读卡（14 号方案 §5）：城市优势/小行程/便利度/取舍；不渲染任何模型元数据。 */
@Composable
private fun RichNarrativeCard(p: ExplanationPayload) {
    val en = L10n.current == AppLanguage.EN
    p.headline?.let { Text(it, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold) }
    Spacer(Modifier.height(6.dp))
    Text(p.summary, style = MaterialTheme.typography.bodyMedium)

    if (p.cityAdvantages.isNotEmpty()) {
        Spacer(Modifier.height(10.dp))
        Text(L10n.t("detail.advantages_title"), style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
        p.cityAdvantages.forEach { a ->
            Spacer(Modifier.height(4.dp))
            Text("• ${a.title}", style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
            Text(a.body, style = MaterialTheme.typography.bodySmall)
        }
    }

    if (p.miniPlan.isNotEmpty()) {
        Spacer(Modifier.height(10.dp))
        Text(L10n.t("detail.plan_title"), style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
        p.miniPlan.forEach { m ->
            Spacer(Modifier.height(6.dp))
            Row {
                Text(
                    when (m.slot) {
                        "ARRIVAL_DAY" -> L10n.t("detail.slot_arrival")
                        "DEPARTURE_DAY" -> L10n.t("detail.slot_departure")
                        else -> L10n.t("detail.slot_full")
                    },
                    style = MaterialTheme.typography.labelSmall,
                    color = BrandPrimary,
                    fontWeight = FontWeight.Bold,
                    modifier = Modifier.width(64.dp),
                )
                Column {
                    Text(m.title, style = MaterialTheme.typography.bodySmall, fontWeight = FontWeight.SemiBold)
                    Text(m.description, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }

    p.easeNarrative?.let { e ->
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(L10n.t("detail.ease_title"), style = MaterialTheme.typography.labelMedium, color = BrandInkSoft, modifier = Modifier.weight(1f))
            p.context?.ease?.let { ease ->
                Text("${ease.score}/100 · ${easeLevelText(ease.level, en)}", style = MaterialTheme.typography.labelMedium, color = BrandPrimary, fontWeight = FontWeight.Bold)
            }
        }
        Text(e.summary, style = MaterialTheme.typography.bodySmall)
        e.positives.forEach { Text("· $it", style = MaterialTheme.typography.labelSmall, color = BrandPrimary) }
        e.cautions.forEach { Text("· $it", style = MaterialTheme.typography.labelSmall, color = BrandAccent) }
    }

    p.tradeoff?.let { t ->
        Spacer(Modifier.height(10.dp))
        Text(L10n.t("detail.tradeoff_gain"), style = MaterialTheme.typography.labelMedium, color = BrandPrimary)
        Text(t.gain, style = MaterialTheme.typography.bodySmall)
        Spacer(Modifier.height(4.dp))
        Text(L10n.t("detail.tradeoff_sacrifice"), style = MaterialTheme.typography.labelMedium, color = BrandAccent)
        Text(t.sacrifice, style = MaterialTheme.typography.bodySmall)
    }

    p.practicalTip?.let {
        Spacer(Modifier.height(10.dp))
        Text("· $it", style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
    }
}

private fun easeLevelText(level: String, en: Boolean): String = when (level) {
    "EASY" -> if (en) "Easy" else "轻松"
    "SMOOTH" -> if (en) "Smooth" else "顺畅"
    "PLAN_CAREFULLY" -> if (en) "Plan carefully" else "需规划"
    else -> if (en) "Demanding" else "较折腾"
}

/** 与最终卡结构一致的 Skeleton（AI-11）。 */
@Composable
private fun NarrativeSkeleton() {
    val box = Modifier
        .fillMaxWidth()
        .height(14.dp)
        .clip(RoundedCornerShape(7.dp))
        .background(BrandInkSoft.copy(alpha = 0.15f))
    val tallBox = Modifier
        .fillMaxWidth()
        .height(48.dp)
        .clip(RoundedCornerShape(7.dp))
        .background(BrandInkSoft.copy(alpha = 0.15f))
    Column {
        box
        Spacer(Modifier.height(8.dp))
        box
        Spacer(Modifier.height(8.dp))
        tallBox
    }
}
