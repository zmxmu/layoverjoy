package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import androidx.navigation.NavGraph.Companion.findStartDestination
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.MonitorInput
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.apiErrorText
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.LoadingBlock
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.Routes
import com.yuanhe.layoverjoy.ui.SecondaryButton
import com.yuanhe.layoverjoy.ui.fmtPrice
import com.yuanhe.layoverjoy.ui.theme.BrandBackground
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import com.yuanhe.layoverjoy.ui.i18n.AppLanguage
import com.yuanhe.layoverjoy.ui.i18n.L10n
import kotlinx.coroutines.launch

/** 监控设置：“什么时候通知我”——目标票价到达时邮件 + App 通知。 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MonitorSetupScreen(nav: NavController, planId: String) {
    val scope = rememberCoroutineScope()
    var planLoaded by remember { mutableStateOf(false) }
    var cityZh by remember { mutableStateOf("") }
    var cityEn by remember { mutableStateOf("") }
    var stayDays by remember { mutableStateOf(0) }
    var joyScore by remember { mutableStateOf(0) }
    var currency by remember { mutableStateOf("SGD") }
    var currentTotal by remember { mutableStateOf(0.0) }
    var target by remember { mutableStateOf("") }
    var notifyEmail by remember { mutableStateOf(true) }
    var notifyApp by remember { mutableStateOf(true) }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var success by remember { mutableStateOf(false) }

    LaunchedEffect(planId) {
        when (val r = apiCall { Net.api.planDetail(planId, L10n.current.tag) }) {
            is ApiResult.Ok -> {
                val d = r.data
                cityZh = d.stopoverCity?.cityNameZh ?: ""
                cityEn = d.stopoverCity?.cityNameEn ?: ""
                stayDays = d.stayDays
                joyScore = d.joyScore
                currency = d.currency
                currentTotal = d.airfareTotal
                target = "%.0f".format(d.airfareTotal * 0.95)
                planLoaded = true
            }
            is ApiResult.Err -> error = apiErrorText(r)
        }
    }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(L10n.t("monitor.title")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )

        if (!planLoaded) {
            ErrorBanner(error, Modifier.padding(20.dp))
            if (error == null) LoadingBlock()
        } else {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
                Spacer(Modifier.height(8.dp))
                JoyCard {
                    val cityName = if (L10n.current == AppLanguage.EN) cityEn.ifBlank { cityZh } else cityZh.ifBlank { cityEn }
                    Text(L10n.t("monitor.route", cityName, stayDays, joyScore), style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(4.dp))
                    Text(L10n.t("monitor.current_total", fmtPrice(currentTotal, currency)), style = MaterialTheme.typography.labelSmall)
                }
                Spacer(Modifier.height(12.dp))

                JoyCard {
                    Text(L10n.t("monitor.when_notify"), style = MaterialTheme.typography.titleSmall)
                    Spacer(Modifier.height(12.dp))
                    LabeledField(
                        L10n.t("monitor.target_label", currency),
                        target,
                        { target = it.filter { c -> c.isDigit() || c == '.' } },
                        placeholder = "%.0f".format(currentTotal * 0.95),
                        keyboardType = KeyboardType.Decimal,
                    )
                    Spacer(Modifier.height(14.dp))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(L10n.t("monitor.app_notify"), style = MaterialTheme.typography.bodyMedium)
                            Text(L10n.t("monitor.app_notify_sub"), style = MaterialTheme.typography.labelSmall)
                        }
                        Switch(notifyApp, { notifyApp = it }, colors = SwitchDefaults.colors(checkedTrackColor = BrandPrimary))
                    }
                    Spacer(Modifier.height(10.dp))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(L10n.t("monitor.email_notify"), style = MaterialTheme.typography.bodyMedium)
                            Text(L10n.t("monitor.email_notify_sub"), style = MaterialTheme.typography.labelSmall)
                        }
                        Switch(notifyEmail, { notifyEmail = it }, colors = SwitchDefaults.colors(checkedTrackColor = BrandPrimary))
                    }
                }
                Spacer(Modifier.height(12.dp))
                InfoBanner(L10n.t("monitor.note"))
                Spacer(Modifier.height(16.dp))
                ErrorBanner(error)
                if (error != null) Spacer(Modifier.height(10.dp))

                if (success) {
                    InfoBanner(L10n.t("monitor.created"))
                    Spacer(Modifier.height(12.dp))
                    // 闭环入口：创建成功后直达监控列表（「行程」页），返回栈落回 tab 层。
                    PrimaryButton(
                        text = L10n.t("monitor.view_monitors"),
                        onClick = {
                            nav.navigate(Routes.TRIPS) {
                                popUpTo(nav.graph.findStartDestination().id)
                                launchSingleTop = true
                            }
                        },
                    )
                    Spacer(Modifier.height(8.dp))
                    SecondaryButton(L10n.t("common.back"), onClick = { nav.popBackStack() })
                } else {
                    PrimaryButton(
                        text = L10n.t("monitor.create"),
                        loading = loading,
                        enabled = target.toDoubleOrNull() != null,
                        onClick = {
                            loading = true
                            error = null
                            scope.launch {
                                when (val r = apiCall {
                                    Net.api.createMonitor(
                                        MonitorInput(planId = planId, targetAirfare = target.toDoubleOrNull(), notifyEmail = notifyEmail, notifyApp = notifyApp),
                                    )
                                }) {
                                    is ApiResult.Ok -> success = true
                                    is ApiResult.Err -> error = apiErrorText(r)
                                }
                                loading = false
                            }
                        },
                    )
                }
                Spacer(Modifier.height(24.dp))
            }
        }
    }
}
