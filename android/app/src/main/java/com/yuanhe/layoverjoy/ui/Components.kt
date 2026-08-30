package com.yuanhe.layoverjoy.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.yuanhe.layoverjoy.ui.i18n.L10n
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.ui.theme.BrandAccent
import com.yuanhe.layoverjoy.ui.theme.BrandAmber
import com.yuanhe.layoverjoy.ui.theme.BrandDanger
import com.yuanhe.layoverjoy.ui.theme.BrandInk
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandLine
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import com.yuanhe.layoverjoy.ui.theme.BrandSurface
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

// ---------- 格式化 ----------

fun fmtPrice(amount: Double, currency: String): String =
    "${currency} ${"%.0f".format(amount)}"

fun fmtDateTime(iso: String): String {
    if (iso.isBlank()) return "--"
    return runCatching {
        val parser = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US)
        parser.timeZone = TimeZone.getTimeZone("UTC")
        val d = parser.parse(iso.take(19)) ?: return "--"
        val fmt = SimpleDateFormat("MM-dd HH:mm", Locale.US)
        fmt.timeZone = TimeZone.getDefault()
        fmt.format(d)
    }.getOrDefault(iso.take(16).replace('T', ' '))
}

fun fmtDate(iso: String): String = if (iso.length >= 10) iso.take(10) else iso

// ---------- 基础组件 ----------

/** 白色圆角卡片（20dp，原型规范）。 */
@Composable
fun JoyCard(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Column(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(BrandSurface)
            .padding(16.dp),
        content = content,
    )
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier, trailing: String? = null) {
    Row(modifier = modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.SemiBold)
        if (trailing != null) {
            Spacer(Modifier.weight(1f))
            Text(trailing, style = MaterialTheme.typography.labelSmall)
        }
    }
}

/** 主按钮（15dp 圆角）。 */
@Composable
fun PrimaryButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    loading: Boolean = false,
) {
    Button(
        onClick = onClick,
        enabled = enabled && !loading,
        modifier = modifier.fillMaxWidth().height(52.dp),
        shape = RoundedCornerShape(15.dp),
        colors = ButtonDefaults.buttonColors(containerColor = BrandPrimary, contentColor = Color.White),
    ) {
        if (loading) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
        else Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
fun SecondaryButton(text: String, onClick: () -> Unit, modifier: Modifier = Modifier, enabled: Boolean = true) {
    OutlinedButton(
        onClick = onClick,
        enabled = enabled,
        modifier = modifier.fillMaxWidth().height(48.dp),
        shape = RoundedCornerShape(15.dp),
        colors = ButtonDefaults.outlinedButtonColors(contentColor = BrandPrimary),
        border = BorderStroke(1.dp, BrandPrimary),
    ) {
        Text(text, style = MaterialTheme.typography.labelLarge)
    }
}

/** 彩色徽章。 */
@Composable
fun Badge(text: String, color: Color = BrandPrimary, bg: Color = BrandPrimary.copy(alpha = 0.1f)) {
    Box(
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .background(bg)
            .padding(horizontal = 8.dp, vertical = 4.dp),
    ) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = color, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
fun LabeledField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    singleLine: Boolean = true,
    enabled: Boolean = true,
) {
    Column(modifier = modifier) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            enabled = enabled,
            placeholder = { Text(placeholder, color = BrandInkSoft.copy(alpha = 0.6f)) },
            singleLine = singleLine,
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = BrandPrimary,
                unfocusedBorderColor = BrandLine,
                focusedContainerColor = BrandSurface,
                unfocusedContainerColor = BrandSurface,
            ),
        )
    }
}

/** 把 YYYY-MM-DD 解析为 UTC 毫秒（供 Material3 DatePicker 使用），不合法返回 null。 */
private fun parseDateMillis(value: String): Long? = try {
    if (Regex("\\d{4}-\\d{2}-\\d{2}").matches(value)) {
        java.time.LocalDate.parse(value).atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
    } else null
} catch (_: Exception) {
    null
}

/** 把 DatePicker 返回的 UTC 毫秒格式化为 YYYY-MM-DD。 */
private fun formatUtcDate(millis: Long): String =
    java.time.Instant.ofEpochMilli(millis).atOffset(java.time.ZoneOffset.UTC).toLocalDate().toString()

/**
 * 日期字段：保留直接输入能力（与 LabeledField 一致），另提供日历图标弹出 Material3 日期选择器辅助选择。
 * DatePicker 的时间戳基于 UTC，格式化同样按 UTC 处理避免跨时区偏移一天。
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(
    label: String,
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String = "",
) {
    var showPicker by remember { mutableStateOf(false) }
    Column(modifier = modifier) {
        Text(label, style = MaterialTheme.typography.labelMedium, color = BrandInkSoft)
        Spacer(Modifier.height(6.dp))
        OutlinedTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth(),
            placeholder = { Text(placeholder, color = BrandInkSoft.copy(alpha = 0.6f)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Text),
            trailingIcon = {
                IconButton(onClick = { showPicker = true }) {
                    Icon(Icons.Filled.DateRange, contentDescription = label, tint = BrandInkSoft)
                }
            },
            shape = RoundedCornerShape(12.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = BrandPrimary,
                unfocusedBorderColor = BrandLine,
                focusedContainerColor = BrandSurface,
                unfocusedContainerColor = BrandSurface,
            ),
        )
    }
    if (showPicker) {
        // 已输入的合法日期作为初始选中项，否则默认今天；有效期不早于今天可选。
        val todayMillis = java.time.LocalDate.now().atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli()
        val state = rememberDatePickerState(
            initialSelectedDateMillis = parseDateMillis(value) ?: todayMillis,
            selectableDates = object : androidx.compose.material3.SelectableDates {
                override fun isSelectableDate(utcTimeMillis: Long): Boolean = utcTimeMillis >= todayMillis
            },
        )
        DatePickerDialog(
            onDismissRequest = { showPicker = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { onValueChange(formatUtcDate(it)) }
                    showPicker = false
                }) { Text(L10n.t("common.ok")) }
            },
            dismissButton = {
                TextButton(onClick = { showPicker = false }) { Text(L10n.t("common.cancel")) }
            },
        ) {
            DatePicker(state = state)
        }
    }
}

/**
 * 后端错误码 → 双语文案。code 是稳定契约（按 code 分支，不按 message）；
 * 未知码回退 err.generic，**永不直显后端原文**（后端 message 为单语，直显会泄漏语言不一致）。
 */
fun apiErrorText(e: ApiResult.Err): String {
    val key = "err." + e.code.lowercase()
    val t = L10n.t(key)
    return if (t == key) L10n.t("err.generic") else t
}

@Composable
fun ErrorBanner(message: String?, modifier: Modifier = Modifier) {
    if (message.isNullOrBlank()) return
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(BrandDanger.copy(alpha = 0.08f))
            .border(1.dp, BrandDanger.copy(alpha = 0.3f), RoundedCornerShape(12.dp))
            .padding(12.dp),
    ) {
        Text(message, style = MaterialTheme.typography.bodySmall, color = BrandDanger)
    }
}

@Composable
fun InfoBanner(message: String, modifier: Modifier = Modifier) {
    Box(
        modifier = modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(BrandPrimary.copy(alpha = 0.08f))
            .padding(12.dp),
    ) {
        Text(message, style = MaterialTheme.typography.bodySmall, color = BrandPrimary)
    }
}

@Composable
fun LoadingBlock(text: String = L10n.t("common.loading")) {
    Column(Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        CircularProgressIndicator(color = BrandPrimary)
        Spacer(Modifier.height(12.dp))
        Text(text, style = MaterialTheme.typography.bodySmall, textAlign = TextAlign.Center)
    }
}

@Composable
fun EmptyBlock(text: String) {
    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(text, style = MaterialTheme.typography.bodySmall, color = BrandInkSoft, textAlign = TextAlign.Center)
    }
}

/** 键值对行。 */
@Composable
fun KvRow(key: String, value: String, emphasized: Boolean = false) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(key, style = MaterialTheme.typography.bodySmall, modifier = Modifier.weight(1f))
        Text(
            value,
            style = if (emphasized) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium,
            color = if (emphasized) BrandAccent else BrandInk,
        )
    }
}

// ---------- 状态文案与颜色 ----------

fun bookingStatusText(status: String): String = when (status) {
    "DRAFT" -> L10n.t("booking.status.draft")
    "BOTH_VERIFIED" -> L10n.t("booking.status.both_verified")
    "LEG_A_ORDERING", "LEG_B_ORDERING" -> L10n.t("booking.status.ordering")
    "LEG_A_ORDERED" -> L10n.t("booking.status.leg_a_ordered")
    "BOTH_ORDERED" -> L10n.t("booking.status.both_ordered")
    "PAYMENT_PENDING" -> L10n.t("booking.status.payment_pending")
    "COMPLETED" -> L10n.t("booking.status.completed")
    "PARTIAL_ORDER" -> L10n.t("booking.status.partial")
    "SIMULATED_REFUND_PENDING", "REFUND_PENDING_SIMULATED" -> L10n.t("booking.status.refund_pending")
    "SIMULATED_REFUNDED", "REFUNDED_SIMULATED" -> L10n.t("booking.status.refunded")
    "MANUAL_REVIEW", "MANUAL_ACTION_REQUIRED" -> L10n.t("booking.status.manual_review")
    "EXPIRED" -> L10n.t("booking.status.expired")
    // Sandbox 交易闭环新增状态。
    "PRICE_CONFIRMATION_REQUIRED" -> L10n.t("booking.status.price_confirm")
    "TICKETING_IN_PROGRESS" -> L10n.t("booking.status.ticketing")
    "ORDER_CANCELLED" -> L10n.t("booking.status.cancelled")
    else -> status
}

/** 单张航段（腿）状态的产品化文案（含 Sandbox 出票状态）。 */
fun legStatusText(status: String): String = when (status) {
    "CREATED" -> L10n.t("booking.leg.created")
    "ORDER_CREATED" -> L10n.t("booking.leg.created")
    "PAY_SUBMITTED" -> L10n.t("booking.leg.pay_submitted")
    "PAID" -> L10n.t("booking.leg.paid")
    "TICKETING_PENDING" -> L10n.t("booking.leg.ticketing_pending")
    "TICKETED" -> L10n.t("booking.leg.ticketed")
    "FAILED" -> L10n.t("booking.leg.failed")
    "ORDER_CANCELLED" -> L10n.t("booking.status.cancelled")
    "UNKNOWN_REQUIRES_QUERY" -> L10n.t("booking.leg.unknown_query")
    "REFUND_PENDING_SIMULATED" -> L10n.t("booking.status.refund_pending")
    "REFUNDED_SIMULATED" -> L10n.t("booking.status.refunded")
    else -> status
}

fun bookingStatusColor(status: String): Color = when (status) {
    "COMPLETED", "TICKETED" -> BrandPrimary
    "PARTIAL_ORDER", "MANUAL_REVIEW", "MANUAL_ACTION_REQUIRED", "ORDER_CANCELLED" -> BrandDanger
    "SIMULATED_REFUNDED", "REFUNDED_SIMULATED", "EXPIRED" -> BrandInkSoft
    "PAYMENT_PENDING", "PRICE_CONFIRMATION_REQUIRED" -> BrandAccent
    else -> BrandAmber
}
