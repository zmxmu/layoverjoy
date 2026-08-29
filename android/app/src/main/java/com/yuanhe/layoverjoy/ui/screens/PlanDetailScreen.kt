package com.yuanhe.layoverjoy.ui.screens

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

    suspend fun load() {
        when (val r = apiCall { Net.api.planDetail(planId) }) {
            is ApiResult.Ok -> detail = r.data
            is ApiResult.Err -> error = r.message
        }
    }

    LaunchedEffect(planId) { load() }

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
                                Text(L10n.t("detail.usable", "%.0f".format(d.usableHours), d.stayDays), style = MaterialTheme.typography.labelSmall)
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

                item { SectionTitle(L10n.t("detail.why_title")) }
                item {
                    JoyCard {
                        val payload = d.explanation?.payload
                        if (payload != null) {
                            Text(payload.summary, style = MaterialTheme.typography.bodyMedium)
                            if (payload.highlights.isNotEmpty()) {
                                Spacer(Modifier.height(8.dp))
                                payload.highlights.forEach { Text("· $it", style = MaterialTheme.typography.bodySmall) }
                            }
                            Spacer(Modifier.height(6.dp))
                            // 推理来源诚实展示：Nosana 附模型/耗时/部署尾码，降级时明示模板。
                            val caption = if (d.explanation?.provider == "NOSANA") {
                                buildString {
                                    append(L10n.t("detail.why_nosana", payload?.modelId ?: d.explanation?.modelId ?: ""))
                                    payload?.latencyMs?.let { append(" · ").append(L10n.t("detail.why_latency", "%.1f".format(it / 1000.0))) }
                                    payload?.deploymentIdTail?.let { append(" · ").append(L10n.t("detail.why_deploy", it)) }
                                }
                            } else L10n.t("detail.why_template")
                            Text(
                                caption,
                                style = MaterialTheme.typography.labelSmall,
                                color = BrandInkSoft,
                            )
                        } else {
                            Text(L10n.t("detail.why_empty"), style = MaterialTheme.typography.bodySmall)
                        }
                        Spacer(Modifier.height(10.dp))
                        SecondaryButton(
                            text = if (explaining) L10n.t("detail.why_generating") else if (payload != null) L10n.t("detail.why_regenerate") else L10n.t("detail.why_generate"),
                            enabled = !explaining,
                            onClick = {
                                explaining = true
                                scope.launch {
                                    apiCall { Net.api.createExplanation(planId) }
                                    load()
                                    explaining = false
                                }
                            },
                        )
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
                            Text(d.cityPack!!.airportToCityZh, style = MaterialTheme.typography.bodySmall, color = BrandPrimary)
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
