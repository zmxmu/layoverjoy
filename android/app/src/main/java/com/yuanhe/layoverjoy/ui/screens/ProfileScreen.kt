package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.BuildConfig
import com.yuanhe.layoverjoy.LayoverJoyApp
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.AppStateViewModel
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.Routes
import com.yuanhe.layoverjoy.ui.SecondaryButton
import com.yuanhe.layoverjoy.ui.SectionTitle
import com.yuanhe.layoverjoy.ui.i18n.AppLanguage
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import kotlinx.coroutines.launch

/** 我的页：语言切换、证件钱包、安全与支持、退出登录。
 * 服务器切换不暴露给普通用户：双击标题进入隐藏开发设置页。 */
@Composable
fun ProfileScreen(nav: NavController, appState: AppStateViewModel) {
    val scope = rememberCoroutineScope()
    val session = LayoverJoyApp.instance.session

    var showPrivacy by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
        Spacer(Modifier.height(20.dp))
        Text(
            L10n.t("profile.title"),
            style = MaterialTheme.typography.titleLarge,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.doubleTapTo { nav.navigate(Routes.DEV_SETTINGS) },
        )
        Spacer(Modifier.height(4.dp))
        if (appState.isLoggedIn) {
            Text(appState.userEmail ?: "", style = MaterialTheme.typography.bodySmall, color = BrandInkSoft)
        } else {
            // 游客态：提示登录，语言切换等本地设置不受影响
            Text(L10n.t("profile.not_logged_in"), style = MaterialTheme.typography.bodySmall, color = BrandInkSoft)
            Spacer(Modifier.height(10.dp))
            PrimaryButton(text = L10n.t("profile.login_cta"), onClick = {
                appState.markAuthReturn(Routes.PROFILE)
                nav.navigate(Routes.LOGIN) { launchSingleTop = true }
            })
        }
        Spacer(Modifier.height(16.dp))

        SectionTitle(L10n.t("profile.travel_settings"))
        JoyCard {
            // 语言切换：中文 / English，切换后全应用即时重组，无需重启
            Text(L10n.t("profile.language"), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))
            SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
                AppLanguage.entries.forEachIndexed { index, lang ->
                    SegmentedButton(
                        selected = L10n.current == lang,
                        onClick = { L10n.switchTo(LayoverJoyApp.instance, lang) },
                        shape = SegmentedButtonDefaults.itemShape(index = index, count = AppLanguage.entries.size),
                    ) { Text(lang.label) }
                }
            }
            Spacer(Modifier.height(10.dp))
            SettingRow(L10n.t("profile.docs_wallet"), L10n.t("profile.docs_sub")) {
                com.yuanhe.layoverjoy.ui.guardedNavigate(nav, appState, Routes.DOCUMENTS)
            }
        }

        Spacer(Modifier.height(16.dp))
        SectionTitle(L10n.t("profile.security"))
        JoyCard {
            SettingRow(L10n.t("profile.privacy"), L10n.t("profile.privacy_sub")) { showPrivacy = !showPrivacy }
            if (showPrivacy) {
                Spacer(Modifier.height(10.dp))
                InfoBanner(L10n.t("profile.privacy_body"))
            }
            Divider()
            SettingRow(L10n.t("profile.about"), L10n.t("profile.about_sub", BuildConfig.VERSION_NAME)) { }
        }

        Spacer(Modifier.height(24.dp))
        if (appState.isLoggedIn) {
            SecondaryButton(L10n.t("profile.logout"), onClick = {
                scope.launch {
                    runCatching { apiCall { Net.api.logout() } }
                    session.clear()
                    appState.onLoggedOut()
                }
            })
        }
        Spacer(Modifier.height(28.dp))
    }
}

@Composable
private fun SettingRow(title: String, subtitle: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().clickable(onClick = onClick).padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyMedium)
            Text(subtitle, style = MaterialTheme.typography.labelSmall, color = BrandInkSoft)
        }
        Text("›", style = MaterialTheme.typography.titleMedium, color = BrandInkSoft)
    }
}

@Composable
private fun Divider() {
    androidx.compose.foundation.layout.Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(com.yuanhe.layoverjoy.ui.theme.BrandLine.copy(alpha = 0.6f)),
    )
}
