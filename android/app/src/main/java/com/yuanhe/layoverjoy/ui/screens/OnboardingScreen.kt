package com.yuanhe.layoverjoy.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.requestFocus
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.yuanhe.layoverjoy.LayoverJoyApp
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.DocumentInput
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.OnboardingPassportInput
import com.yuanhe.layoverjoy.data.OnboardingRequest
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.AppStateViewModel
import com.yuanhe.layoverjoy.ui.apiErrorText
import com.yuanhe.layoverjoy.ui.DateField
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.ui.theme.BrandInk
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandLine
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import kotlinx.coroutines.launch

private val PASSPORT_TYPES = listOf("ORDINARY" to "ob.pt.ordinary", "DIPLOMATIC" to "ob.pt.diplomatic", "OFFICIAL" to "ob.pt.official")
private val VISA_COUNTRIES = listOf("MY" to "ob.vc.my", "TH" to "ob.vc.th", "VN" to "ob.vc.vn", "JP" to "ob.vc.jp", "KR" to "ob.vc.kr", "SG" to "ob.vc.sg")
private val INTERESTS = listOf(
    "food" to "interest.food",
    "nature" to "interest.nature",
    "museum" to "interest.museum",
    "shopping" to "interest.shopping",
    "nightlife" to "interest.nightlife",
    "oldtown" to "interest.oldtown",
    "family" to "interest.family",
)

/**
 * 三步引导：证件 → 已有签证 → 兴趣偏好。
 * 隐私底线：只收集签发国家、护照类型与有效期；绝不收集证件号码、姓名与照片。
 */
@OptIn(ExperimentalLayoutApi::class)
@Composable
fun OnboardingScreen(appState: AppStateViewModel) {
    val scope = rememberCoroutineScope()
    val session = LayoverJoyApp.instance.session

    var step by remember { mutableIntStateOf(0) }
    var country by remember { mutableStateOf("CN") }
    var passportType by remember { mutableStateOf("ORDINARY") }
    var expiry by remember { mutableStateOf("") }
    var visas by remember { mutableStateOf(setOf<String>()) }
    var interests by remember { mutableStateOf(setOf<String>()) }
    var acceptRedEye by remember { mutableStateOf(true) }
    var submitting by remember { mutableStateOf(false) }
    var uploadError by remember { mutableStateOf<String?>(null) }
    // P1-6：护照有效期必填错误明示 + 聚焦。
    var expiryError by remember { mutableStateOf<String?>(null) }
    val expiryFocus = remember { FocusRequester() }

    /** 将最小证件信息（国家/类型/有效期）+ 选中签证原子同步到后端；失败时明示错误，不静默通过。 */
    fun finishOnboarding(country: String, passportType: String, visas: List<String>) {
        submitting = true
        scope.launch {
            val r = runCatching {
                apiCall {
                    Net.api.completeOnboarding(
                        OnboardingRequest(
                            passport = OnboardingPassportInput(countryCode = country, passportType = passportType, expiresOn = expiry.ifBlank { null }),
                            visas = visas,
                        ),
                    )
                }
            }.getOrNull()
            submitting = false
            if (r is ApiResult.Err) {
                uploadError = apiErrorText(r)
                return@launch
            }
            session.setOnboardingDone(true, country, passportType, visas)
            appState.onOnboardingDone()
        }
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
    ) {
        Spacer(Modifier.height(24.dp))
        when (step) {
            0 -> {
                Text(L10n.t("ob.step1_title"), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text(L10n.t("ob.step1_sub"), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(20.dp))
                JoyCard {
                    LabeledField(L10n.t("ob.country_label"), country, { country = it.uppercase().take(2) }, placeholder = "CN")
                    Spacer(Modifier.height(12.dp))
                    Text(L10n.t("ob.passport_type"), style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
                    Spacer(Modifier.height(8.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        PASSPORT_TYPES.forEach { (code, key) ->
                            SelectChip(L10n.t(key), passportType == code) { passportType = code }
                        }
                    }
                    Spacer(Modifier.height(12.dp))
                    DateField(
                        L10n.t("ob.expiry_label"),
                        expiry,
                        { expiry = it.trim(); expiryError = null },
                        placeholder = "2032-01-01",
                        focusRequester = expiryFocus,
                        errorText = expiryError,
                    )
                }
                Spacer(Modifier.height(12.dp))
                InfoBanner(L10n.t("ob.security_banner"))
                Spacer(Modifier.height(24.dp))
                PrimaryButton(
                    L10n.t("common.next"),
                    onClick = {
                        if (expiry.matches(Regex("\\d{4}-\\d{2}-\\d{2}"))) {
                            expiryError = null
                            step = 1
                        } else {
                            // P1-6：空/非法有效期 → 明确必填错误并聚焦字段。
                            expiryError = L10n.t("ob.expiry_required")
                            expiryFocus.requestFocus()
                        }
                    },
                )
            }
            1 -> {
                Text(L10n.t("ob.step2_title"), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text(L10n.t("ob.step2_sub"), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(20.dp))
                JoyCard {
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        VISA_COUNTRIES.forEach { (code, key) ->
                            SelectChip(L10n.t(key), code in visas) {
                                visas = if (code in visas) visas - code else visas + code
                            }
                        }
                    }
                }
                Spacer(Modifier.height(24.dp))
                PrimaryButton(L10n.t("common.next"), onClick = { step = 2 })
                Spacer(Modifier.height(8.dp))
                TextButton(onClick = { step = 2 }, modifier = Modifier.fillMaxWidth()) { Text(L10n.t("common.skip")) }
            }
            else -> {
                Text(L10n.t("ob.step3_title"), style = MaterialTheme.typography.titleLarge)
                Spacer(Modifier.height(8.dp))
                Text(L10n.t("ob.step3_sub"), style = MaterialTheme.typography.bodySmall)
                Spacer(Modifier.height(20.dp))
                JoyCard {
                    Text(L10n.t("ob.interests_label"), style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
                    Spacer(Modifier.height(8.dp))
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        INTERESTS.forEach { (code, key) ->
                            SelectChip(L10n.t(key), code in interests) {
                                interests = if (code in interests) interests - code else interests + code
                            }
                        }
                    }
                    Spacer(Modifier.height(16.dp))
                    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(L10n.t("ob.redeye"), style = MaterialTheme.typography.bodyMedium)
                            Text(L10n.t("ob.redeye_sub"), style = MaterialTheme.typography.labelSmall)
                        }
                        Switch(acceptRedEye, { acceptRedEye = it }, colors = SwitchDefaults.colors(checkedTrackColor = BrandPrimary))
                    }
                }
                Spacer(Modifier.height(24.dp))
                // 证件同步失败不得静默通过：资格引擎缺数据会 fail-closed，必须明示并允许重试。
                if (uploadError != null) {
                    InfoBanner(uploadError!!)
                    Spacer(Modifier.height(8.dp))
                    TextButton(onClick = { uploadError = null; finishOnboarding(country, passportType, visas.toList()) }, modifier = Modifier.fillMaxWidth()) {
                        Text(L10n.t("ob.retry_upload"))
                    }
                    TextButton(onClick = {
                        // 用户主动选择先跳过：本地完成引导，证件可稍后在「我的-证件」补录。
                        uploadError = null
                        scope.launch {
                            session.setOnboardingDone(true, country, passportType, visas.toList())
                            appState.onOnboardingDone()
                        }
                    }, modifier = Modifier.fillMaxWidth()) {
                        Text(L10n.t("ob.skip_upload"))
                    }
                } else {
                    PrimaryButton(
                        text = L10n.t("ob.start"),
                        loading = submitting,
                        onClick = { finishOnboarding(country, passportType, visas.toList()) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SelectChip(label: String, selected: Boolean, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .clip(RoundedCornerShape(15.dp))
            .background(if (selected) BrandPrimary.copy(alpha = 0.12f) else BrandLine.copy(alpha = 0.35f))
            .border(1.dp, if (selected) BrandPrimary else BrandLine, RoundedCornerShape(15.dp))
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 8.dp),
    ) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = if (selected) BrandPrimary else BrandInk)
    }
}
