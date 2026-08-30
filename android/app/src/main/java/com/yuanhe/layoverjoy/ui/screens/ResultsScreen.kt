package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.CircularProgressIndicator
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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.EligibilityDto
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.PlanDto
import com.yuanhe.layoverjoy.data.PlansResponse
import com.yuanhe.layoverjoy.data.SearchStatusResponse
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.Badge
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.Routes
import com.yuanhe.layoverjoy.ui.SectionTitle
import com.yuanhe.layoverjoy.ui.cityDisplayName
import com.yuanhe.layoverjoy.ui.cityNameById
import com.yuanhe.layoverjoy.ui.fmtDateTime
import com.yuanhe.layoverjoy.ui.fmtPrice
import com.yuanhe.layoverjoy.ui.theme.BrandAccent
import com.yuanhe.layoverjoy.ui.theme.BrandBackground
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import com.yuanhe.layoverjoy.ui.i18n.AppLanguage
import com.yuanhe.layoverjoy.ui.i18n.L10n
import kotlinx.coroutines.delay

/** 漏斗状态 → i18n key。 */
private val FUNNEL_STATUS_KEY = mapOf(
    "COMPLETED" to "funnel.completed",
    "ELIGIBLE" to "funnel.eligible",
    "INELIGIBLE" to "funnel.ineligible",
    "NEEDS_INFO" to "funnel.needs_info",
    "NEEDS_REVIEW" to "funnel.needs_review",
    "NO_INVENTORY" to "funnel.no_inventory",
    "EXPERIENCE_REJECTED" to "funnel.experience_rejected",
    "FAILED" to "funnel.failed",
)

/** 结果页：轮询搜索编排状态，完成后展示直飞基准与 Stopover 方案。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ResultsScreen(nav: NavController, runId: String) {
    var status by remember { mutableStateOf<SearchStatusResponse?>(null) }
    var plans by remember { mutableStateOf<PlansResponse?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf(false) }

    LaunchedEffect(runId) {
        while (!done) {
            when (val r = apiCall { Net.api.searchStatus(runId) }) {
                is ApiResult.Ok -> {
                    status = r.data
                    val terminal = r.data.status == "COMPLETED" || r.data.status == "FAILED"
                    if (terminal) {
                        done = true
                        if (r.data.status == "COMPLETED") {
                            when (val p = apiCall { Net.api.searchPlans(runId) }) {
                                is ApiResult.Ok -> plans = p.data
                                is ApiResult.Err -> error = locationErrorText(p)
                            }
                        }
                    }
                }
                is ApiResult.Err -> {
                    error = locationErrorText(r)
                    done = true
                }
            }
            if (!done) delay(1500)
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(L10n.t("results.title")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )

        if (!done) {
            Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                CircularProgressIndicator(color = BrandPrimary)
                Spacer(Modifier.height(16.dp))
                Text(L10n.t("results.agent_working"), style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.height(8.dp))
                status?.let { s ->
                    Text(
                        L10n.t("results.progress", s.counts.candidates, s.funnel.count { it.status == "COMPLETED" }),
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        } else {
            LazyColumn(Modifier.fillMaxSize().padding(horizontal = 20.dp)) {
                item {
                    ErrorBanner(error)
                    status?.let { s ->
                        if (s.resultStatus == "FAILED" && s.counts.keptPlans == 0) {
                            Spacer(Modifier.height(8.dp))
                            // LOC-06：无库存不显示“城市不支持”；按漏斗原因区分文案。
                            val noInventory = s.funnel.any { f -> f.reasonCodes.any { it.startsWith("NO_SANDBOX_INVENTORY") || it == "NO_FLIGHT_INVENTORY" } }
                            ErrorBanner(if (noInventory) L10n.t("loc.err_no_inventory") else L10n.t("results.no_plans"))
                        }
                    }
                }

                // 漏斗说明：为什么只留下这些城市
                status?.let { s ->
                    if (s.funnel.isNotEmpty()) {
                        item { SectionTitle(L10n.t("results.funnel_title")) }
                        item {
                            JoyCard {
                                s.funnel.forEach { f ->
                                    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                                        // 统一展示完整城市名（中/英），不再回退到 cityId 缩写串。
                                        Text(
                                            cityNameById(f.cityId) ?: f.cityNameZh.ifBlank { f.cityId },
                                            style = MaterialTheme.typography.bodyMedium,
                                            modifier = Modifier.weight(1f),
                                        )
                                        val text = FUNNEL_STATUS_KEY[f.status]?.let { L10n.t(it) } ?: f.status
                                        val color = when (f.status) {
                                            "COMPLETED" -> BrandPrimary
                                            "FAILED", "INELIGIBLE" -> BrandAccent
                                            else -> BrandInkSoft
                                        }
                                        Text(text, style = MaterialTheme.typography.labelSmall, color = color, fontWeight = FontWeight.Medium)
                                    }
                                }
                            }
                        }
                    }
                }

                plans?.let { p ->
                    item {
                        Spacer(Modifier.height(8.dp))
                        SectionTitle(L10n.t("results.direct_baseline"))
                    }
                    item {
                        val offer = p.directBaseline?.offer
                        JoyCard {
                            if (offer == null) {
                                Text(L10n.t("results.no_direct"), style = MaterialTheme.typography.bodySmall)
                            } else {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Column(Modifier.weight(1f)) {
                                        Text("${cityDisplayName(offer.origin)} → ${cityDisplayName(offer.destination)}", style = MaterialTheme.typography.titleSmall)
                                        Text("${offer.carrier ?: ""} ${offer.flightNumber ?: ""} · ${fmtDateTime(offer.departureAt)}", style = MaterialTheme.typography.labelSmall)
                                    }
                                    Text(fmtPrice(offer.totalPrice, offer.currency), style = MaterialTheme.typography.titleMedium, color = BrandPrimary, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }

                    item { SectionTitle(L10n.t("results.plans_title"), trailing = L10n.t("results.ordered_by_joy")) }
                    items(p.plans) { plan -> PlanCard(plan, p) { nav.navigate(Routes.planDetail(plan.planId)) } }
                    item { Spacer(Modifier.height(24.dp)) }
                }
            }
        }
    }
}

@Composable
fun PlanCard(plan: PlanDto, context: PlansResponse?, onClick: () -> Unit) {
    val funnelItem = context?.funnel?.firstOrNull { it.cityId == plan.stopoverCityId }
    // 城市名统一按当前语言从目录解析完整名称，不回退到 cityId/代码。
    val cityName = cityNameById(plan.stopoverCityId)
        ?: funnelItem?.cityNameZh?.ifBlank { null }
        ?: plan.stopoverCityId.orEmpty()
    val leg1 = plan.legs.getOrNull(0)
    val leg2 = plan.legs.getOrNull(1)
    JoyCard(modifier = Modifier.padding(vertical = 6.dp).clickable(onClick = onClick)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f)) {
                Text(L10n.t("results.plan_card", cityName, plan.stayDays), style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(2.dp))
                Text(L10n.t("results.usable_hours", "%.0f".format(plan.usableHours)), style = MaterialTheme.typography.labelSmall)
            }
            JoyScoreRing(plan.joyScore)
        }
        Spacer(Modifier.height(10.dp))
        leg1?.let { LegLine(it.origin, it.destination, it.departureAt, it.carrier, it.flightNumber) }
        leg2?.let { LegLine(it.origin, it.destination, it.departureAt, it.carrier, it.flightNumber) }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(fmtPrice(plan.airfareTotal, plan.currency), style = MaterialTheme.typography.titleMedium, color = BrandPrimary, fontWeight = FontWeight.Bold)
            Spacer(Modifier.width(8.dp))
            val delta = plan.airfareDelta
            Text(
                when {
                    delta > 0 -> L10n.t("results.delta_up", "%.0f".format(delta))
                    delta < 0 -> L10n.t("results.delta_down", "%.0f".format(-delta))
                    else -> L10n.t("results.delta_flat")
                },
                style = MaterialTheme.typography.labelSmall,
                color = if (delta > 0) BrandAccent else BrandPrimary,
            )
            Spacer(Modifier.weight(1f))
        }
        context?.eligibility?.firstOrNull { it.cityId == plan.stopoverCityId }?.let { eli ->
            Spacer(Modifier.height(10.dp))
            EligibilityCard(eli)
        }
    }
}

/** 资格卡（ER-13）：徽章 + 一句话结论 + 停留上限 + 材料 + 依据 + 法律提示。 */
@Composable
private fun EligibilityCard(eli: EligibilityDto) {
    val a = eli.assessment
    val badge = when (eli.status) {
        "ELIGIBLE" -> L10n.t("elig.badge_eligible") to BrandPrimary
        "CONDITIONALLY_ELIGIBLE" -> L10n.t("elig.badge_conditional") to BrandPrimary
        "NEEDS_INFO" -> L10n.t("elig.badge_needs_info") to BrandAccent
        "NEEDS_REVIEW" -> L10n.t("elig.badge_needs_review") to BrandAccent
        "INELIGIBLE" -> L10n.t("elig.badge_ineligible") to androidx.compose.ui.graphics.Color(0xFFC0392B)
        else -> null
    }
    Column {
        badge?.let { (text, color) -> Badge(text, color = color, bg = color.copy(alpha = 0.10f)) }
        a?.let {
            Spacer(Modifier.height(6.dp))
            // 规则解释仅维护中文；英文界面展示本地化摘要，避免整段中文。
            val summary = when (eli.status) {
                "ELIGIBLE" -> L10n.t("elig.summary_eligible")
                "CONDITIONALLY_ELIGIBLE" -> L10n.t("elig.summary_conditional")
                "NEEDS_INFO" -> L10n.t("elig.summary_needs_info")
                "NEEDS_REVIEW" -> L10n.t("elig.summary_needs_review")
                "INELIGIBLE" -> L10n.t("elig.summary_ineligible")
                else -> null
            }
            Text(if (L10n.current == AppLanguage.EN) summary ?: it.explanationZh else it.explanationZh, style = MaterialTheme.typography.labelSmall)
            Spacer(Modifier.height(4.dp))
            val stay = it.maxStay
            Text(
                if (stay != null && stay.value > 0) {
                    L10n.t("elig.stay_limit", stay.value, if (stay.unit == "HOURS") L10n.t("common.hours_unit") else L10n.t("common.days_unit_short"))
                } else {
                    L10n.t("elig.stay_tbc")
                },
                style = MaterialTheme.typography.labelSmall,
                color = BrandInkSoft,
            )
            if (it.requirements.isNotEmpty()) {
                Spacer(Modifier.height(4.dp))
                it.requirements.take(3).forEach { r ->
                    Text("· ${r.descriptionZh}", style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                }
            }
            it.sources.firstOrNull()?.let { s ->
                Spacer(Modifier.height(4.dp))
                Text("${s.authority} · ${s.lastCheckedAt.take(10)}", style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(L10n.t("elig.disclaimer"), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
    }
}

@Composable
private fun LegLine(origin: String, destination: String, departureAt: String, carrier: String?, flightNumber: String?) {
    Row(Modifier.fillMaxWidth().padding(vertical = 2.dp)) {
        Text("${cityDisplayName(origin)} → ${cityDisplayName(destination)}", style = MaterialTheme.typography.bodyMedium, modifier = Modifier.weight(1f))
        Text("${carrier ?: ""} ${flightNumber ?: ""} · ${fmtDateTime(departureAt)}", style = MaterialTheme.typography.labelSmall)
    }
}
