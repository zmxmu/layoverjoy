package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.gestures.detectTapGestures
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
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.BuildConfig
import com.yuanhe.layoverjoy.LayoverJoyApp
import com.yuanhe.layoverjoy.data.DemoFlags
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.ServerEnv
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.SecondaryButton
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import kotlinx.coroutines.launch

/** 服务器模式：本机（默认）或远程正式服务器（Daytona 部署）。 */
private enum class ServerMode { LOCAL, REMOTE }

/**
 * 隐藏开发设置页：从「我的」页双击标题进入，普通用户不可见。
 * 只暴露两个选择：本机服务器（127.0.0.1）或远程正式服务器（Daytona）。
 */
@Composable
fun DevSettingsScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    val session = LayoverJoyApp.instance.session

    val currentUrl = Net.client.currentBaseUrl().removeSuffix("/")
    val localUrl = ServerEnv.localServerUrl().removeSuffix("/")
    var mode by remember {
        mutableStateOf(
            if (currentUrl.equals(localUrl, ignoreCase = true) ||
                currentUrl.equals(BuildConfig.DEFAULT_BASE_URL.removeSuffix("/"), ignoreCase = true)
            ) ServerMode.LOCAL else ServerMode.REMOTE,
        )
    }
    var remoteUrl by remember {
        mutableStateOf(
            if (mode == ServerMode.REMOTE) currentUrl else BuildConfig.DEFAULT_REMOTE_URL.removeSuffix("/"),
        )
    }
    var token by remember { mutableStateOf(Net.client.currentPreviewToken() ?: BuildConfig.DEFAULT_PREVIEW_TOKEN) }
    var localOverride by remember { mutableStateOf("") }
    var saved by remember { mutableStateOf(false) }
    var paySimFail by remember { mutableStateOf(DemoFlags.paySimFail) }

    // 从本地缓存恢复开关初始值。
    LaunchedEffect(Unit) {
        paySimFail = session.snapshot().paySimFail
    }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(20.dp))
        TextButton(onClick = { nav.popBackStack() }, contentPadding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
            Text("‹ " + L10n.t("common.back"), color = BrandInkSoft, style = MaterialTheme.typography.labelLarge)
        }
        Spacer(Modifier.height(12.dp))
        Text(L10n.t("dev.title"), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
        Spacer(Modifier.height(4.dp))
        Text(L10n.t("dev.subtitle"), style = MaterialTheme.typography.bodySmall, color = BrandInkSoft)
        Spacer(Modifier.height(16.dp))

        JoyCard {
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                SegmentedButton(
                    selected = mode == ServerMode.LOCAL,
                    onClick = { mode = ServerMode.LOCAL; saved = false },
                    shape = SegmentedButtonDefaults.itemShape(index = 0, count = 2),
                ) { Text(L10n.t("dev.mode_local")) }
                SegmentedButton(
                    selected = mode == ServerMode.REMOTE,
                    onClick = { mode = ServerMode.REMOTE; saved = false },
                    shape = SegmentedButtonDefaults.itemShape(index = 1, count = 2),
                ) { Text(L10n.t("dev.mode_remote")) }
            }
            Spacer(Modifier.height(10.dp))
            Text(
                when {
                    mode == ServerMode.REMOTE -> L10n.t("dev.remote_desc")
                    ServerEnv.isEmulator() -> L10n.t("dev.local_desc_emu", ServerEnv.localServerUrl())
                    else -> L10n.t("dev.local_desc_device")
                },
                style = MaterialTheme.typography.labelSmall,
                color = BrandInkSoft,
            )
            if (mode == ServerMode.LOCAL) {
                Spacer(Modifier.height(12.dp))
                // 真机上 127.0.0.1 指向手机自身，允许改成电脑局域网地址（模拟器自动用 10.0.2.2）
                LabeledField(
                    L10n.t("dev.remote_url"),
                    if (ServerEnv.isEmulator()) localUrl else currentUrl,
                    { if (!ServerEnv.isEmulator()) { localOverride = it.trim(); saved = false } },
                    placeholder = localUrl,
                    keyboardType = KeyboardType.Uri,
                    enabled = !ServerEnv.isEmulator(),
                )
            }
            if (mode == ServerMode.REMOTE) {
                Spacer(Modifier.height(12.dp))
                LabeledField(
                    L10n.t("dev.remote_url"),
                    remoteUrl,
                    { remoteUrl = it.trim(); saved = false },
                    placeholder = BuildConfig.DEFAULT_REMOTE_URL,
                    keyboardType = KeyboardType.Uri,
                )
                Spacer(Modifier.height(10.dp))
                LabeledField(
                    L10n.t("dev.preview_token"),
                    token,
                    { token = it.trim(); saved = false },
                    placeholder = L10n.t("dev.preview_token_hint"),
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        // 演示开关：支付失败模拟，切换即存入本地缓存，无需点保存。
        JoyCard {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(L10n.t("dev.pay_sim_title"), style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.SemiBold)
                    Text(L10n.t("dev.pay_sim_sub"), style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
                }
                Switch(
                    paySimFail,
                    { v ->
                        paySimFail = v
                        DemoFlags.paySimFail = v
                        scope.launch { session.setPaySimFail(v) }
                    },
                    colors = SwitchDefaults.colors(checkedTrackColor = BrandPrimary),
                )
            }
        }

        Spacer(Modifier.height(16.dp))
        SecondaryButton(if (saved) L10n.t("common.saved") else L10n.t("common.save"), onClick = {
            scope.launch {
                if (mode == ServerMode.LOCAL) {
                    val url = if (ServerEnv.isEmulator()) ServerEnv.localServerUrl()
                    else localOverride.ifBlank { localUrl }
                    session.setBaseUrl(url)
                    session.setPreviewToken(null)
                    Net.client.setPreviewToken(null)
                    Net.client.switchBaseUrl(url)
                } else {
                    val url = remoteUrl.ifBlank { BuildConfig.DEFAULT_REMOTE_URL }
                    val t = token.ifBlank { null }
                    session.setBaseUrl(url)
                    session.setPreviewToken(t)
                    Net.client.setPreviewToken(t)
                    Net.client.switchBaseUrl(url)
                }
                saved = true
            }
        })
        Spacer(Modifier.height(16.dp))
        InfoBanner(L10n.t("dev.note"))
        Spacer(Modifier.height(28.dp))
    }
}

/** 供「我的」页标题使用的双击手势修饰符。 */
fun Modifier.doubleTapTo(block: () -> Unit): Modifier =
    this.pointerInput(Unit) { detectTapGestures(onDoubleTap = { block() }) }
