package com.yuanhe.layoverjoy.ui.screens

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
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
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
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.navigation.NavController
import com.yuanhe.layoverjoy.data.ApiResult
import com.yuanhe.layoverjoy.data.DocumentDto
import com.yuanhe.layoverjoy.data.DocumentInput
import com.yuanhe.layoverjoy.data.Net
import com.yuanhe.layoverjoy.data.apiCall
import com.yuanhe.layoverjoy.ui.Badge
import com.yuanhe.layoverjoy.ui.DateField
import com.yuanhe.layoverjoy.ui.EmptyBlock
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.apiErrorText
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.countryDisplayName
import com.yuanhe.layoverjoy.ui.fmtDate
import com.yuanhe.layoverjoy.ui.theme.BrandBackground
import com.yuanhe.layoverjoy.ui.theme.BrandDanger
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import com.yuanhe.layoverjoy.ui.i18n.L10n
import kotlinx.coroutines.launch

/** 护照类型：code 传后端，label 走 i18n。 */
private val PASSPORT_TYPES = listOf("ORDINARY" to "docs.pt.ordinary", "DIPLOMATIC" to "docs.pt.diplomatic", "OFFICIAL" to "docs.pt.official")
private val VISA_TYPES = listOf("TOURIST" to "docs.vt.tourist", "BUSINESS" to "docs.vt.business", "TRANSIT" to "docs.vt.transit")

/** 类型 code → 本地化文案；未知类型不展示原始 code 缩写。 */
private fun passportTypeLabel(code: String?): String? =
    code?.let { c -> PASSPORT_TYPES.firstOrNull { it.first == c }?.second?.let { L10n.t(it) } }

private fun visaTypeLabel(code: String?): String? =
    code?.let { c -> VISA_TYPES.firstOrNull { it.first == c }?.second?.let { L10n.t(it) } }

/** 证件钱包：只保存签发国家、类型与有效期；无号码、无照片。 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun DocumentsScreen(nav: NavController) {
    val scope = rememberCoroutineScope()
    var docs by remember { mutableStateOf<List<DocumentDto>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var showAddPassport by remember { mutableStateOf(false) }
    var showAddVisa by remember { mutableStateOf(false) }

    suspend fun load() {
        error = null
        when (val r = apiCall { Net.api.documents() }) {
            is ApiResult.Ok -> docs = r.data.documents
            is ApiResult.Err -> error = apiErrorText(r)
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text(L10n.t("docs.title")) },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )

        LazyColumn(Modifier.weight(1f).padding(horizontal = 20.dp)) {
            item {
                InfoBanner(L10n.t("docs.banner"))
                Spacer(Modifier.height(10.dp))
                ErrorBanner(error)
            }

            val list = docs
            if (list == null) {
                item { EmptyBlock(L10n.t("common.loading")) }
            } else {
                if (list.isEmpty()) item { EmptyBlock(L10n.t("docs.empty")) }
                items(list, key = { it.id }) { d ->
                    DocumentCard(d, onDelete = {
                        scope.launch {
                            apiCall { Net.api.deleteDocument(d.id) }
                            load()
                        }
                    })
                }
            }

            item {
                Spacer(Modifier.height(12.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    TextButton(onClick = { showAddPassport = !showAddPassport; showAddVisa = false }) {
                        Text(L10n.t("docs.add_passport"), color = BrandPrimary, fontWeight = FontWeight.SemiBold)
                    }
                    TextButton(onClick = { showAddVisa = !showAddVisa; showAddPassport = false }) {
                        Text(L10n.t("docs.add_visa"), color = BrandPrimary, fontWeight = FontWeight.SemiBold)
                    }
                }
            }

            if (showAddPassport) {
                item { AddPassportForm { scope.launch { load() } } }
            }
            if (showAddVisa) {
                item { AddVisaForm { scope.launch { load() } } }
            }
            item { Spacer(Modifier.height(24.dp)) }
        }
    }
}

@Composable
private fun DocumentCard(d: DocumentDto, onDelete: () -> Unit) {
    JoyCard(Modifier.padding(vertical = 5.dp)) {
        Row(Modifier.fillMaxWidth()) {
            Text(
                if (d.kind == "PASSPORT") L10n.t("docs.passport_of", countryDisplayName(d.countryCode)) else L10n.t("docs.visa_of", countryDisplayName(d.countryCode)),
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDelete) { Text(L10n.t("common.delete"), color = BrandDanger) }
        }
        Text(
            buildString {
                passportTypeLabel(d.passportType)?.let { append(L10n.t("docs.type_prefix", it)) }
                visaTypeLabel(d.visaType)?.let { append(L10n.t("docs.visa_type_prefix", it)) }
                append(L10n.t("docs.expiry_prefix", d.expiresOn?.let { fmtDate(it) } ?: L10n.t("docs.expiry_na")))
            },
            style = MaterialTheme.typography.bodySmall,
            color = BrandInkSoft,
        )
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Badge(if (d.status == "ACTIVE") L10n.t("docs.active") else d.status, color = if (d.status == "ACTIVE") BrandPrimary else BrandDanger, bg = if (d.status == "ACTIVE") BrandPrimary.copy(alpha = 0.1f) else BrandDanger.copy(alpha = 0.08f))
            if (d.isPrimary) Badge(L10n.t("docs.primary"), color = BrandInkSoft, bg = BrandInkSoft.copy(alpha = 0.08f))
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AddPassportForm(onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var country by remember { mutableStateOf("CN") }
    var type by remember { mutableStateOf("ORDINARY") }
    var expiry by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }

    JoyCard(Modifier.padding(vertical = 8.dp)) {
        Text(L10n.t("docs.passport_form_title"), style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(10.dp))
        LabeledField(L10n.t("docs.country_label"), country, { country = it.uppercase().take(2) }, placeholder = "CN")
        Spacer(Modifier.height(10.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PASSPORT_TYPES.forEach { (code, key) ->
                TextButton(onClick = { type = code }) {
                    Text(L10n.t(key), color = if (type == code) BrandPrimary else BrandInkSoft, fontWeight = if (type == code) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
        DateField(L10n.t("docs.expiry_label"), expiry, { expiry = it.trim() }, placeholder = "2032-01-01")
        Spacer(Modifier.height(8.dp))
        ErrorBanner(err)
        Spacer(Modifier.height(8.dp))
        PrimaryButton(
            text = L10n.t("docs.save_passport"),
            loading = busy,
            enabled = country.length == 2 && expiry.matches(Regex("\\d{4}-\\d{2}-\\d{2}")),
            onClick = {
                busy = true
                err = null
                scope.launch {
                    when (val r = apiCall { Net.api.addDocument(DocumentInput(kind = "PASSPORT", countryCode = country, passportType = type, expiresOn = expiry, isPrimary = true)) }) {
                        is ApiResult.Ok -> { onDone() }
                        is ApiResult.Err -> err = apiErrorText(r)
                    }
                    busy = false
                }
            },
        )
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun AddVisaForm(onDone: () -> Unit) {
    val scope = rememberCoroutineScope()
    var country by remember { mutableStateOf("") }
    var type by remember { mutableStateOf("TOURIST") }
    var expiry by remember { mutableStateOf("") }
    var validFrom by remember { mutableStateOf("") }
    var entryCount by remember { mutableStateOf("MULTIPLE") }
    var verificationMode by remember { mutableStateOf("PASSPORT_STICKER") }
    var usedBefore by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }

    JoyCard(Modifier.padding(vertical = 8.dp)) {
        Text(L10n.t("docs.visa_form_title"), style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(10.dp))
        LabeledField(L10n.t("docs.visa_country_label"), country, { country = it.uppercase().take(2) }, placeholder = "MY")
        Spacer(Modifier.height(10.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            VISA_TYPES.forEach { (code, key) ->
                TextButton(onClick = { type = code }) {
                    Text(L10n.t(key), color = if (type == code) BrandPrimary else BrandInkSoft, fontWeight = if (type == code) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
        DateField(L10n.t("docs.expiry_label"), expiry, { expiry = it.trim() }, placeholder = "2027-06-30")
        Spacer(Modifier.height(8.dp))
        DateField(L10n.t("docs.valid_from"), validFrom, { validFrom = it.trim() }, placeholder = "2025-01-01")
        Spacer(Modifier.height(8.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("SINGLE" to "docs.entry_single", "MULTIPLE" to "docs.entry_multiple").forEach { (code, key) ->
                TextButton(onClick = { entryCount = code }) {
                    Text("${L10n.t("docs.entry_count")}:${L10n.t(key)}", color = if (entryCount == code) BrandPrimary else BrandInkSoft, fontWeight = if (entryCount == code) FontWeight.Bold else FontWeight.Normal)
                }
            }
            listOf("PASSPORT_STICKER" to "docs.mode_sticker", "E_VISA" to "docs.mode_evisa").forEach { (code, key) ->
                TextButton(onClick = { verificationMode = code }) {
                    Text("${L10n.t("docs.verification_mode")}:${L10n.t(key)}", color = if (verificationMode == code) BrandPrimary else BrandInkSoft, fontWeight = if (verificationMode == code) FontWeight.Bold else FontWeight.Normal)
                }
            }
            TextButton(onClick = { usedBefore = !usedBefore }) {
                Text("${L10n.t("docs.used_before")}:${if (usedBefore) L10n.t("common.yes") else L10n.t("common.no")}", color = BrandInkSoft)
            }
        }
        Spacer(Modifier.height(8.dp))
        ErrorBanner(err)
        Spacer(Modifier.height(8.dp))
        PrimaryButton(
            text = L10n.t("docs.save_visa"),
            loading = busy,
            enabled = country.length == 2 && expiry.matches(Regex("\\d{4}-\\d{2}-\\d{2}")),
            onClick = {
                busy = true
                err = null
                scope.launch {
                    when (val r = apiCall { Net.api.addDocument(DocumentInput(kind = "VISA", countryCode = country, visaType = type, expiresOn = expiry, validFrom = validFrom.ifBlank { null }, entryCount = entryCount, verificationMode = verificationMode, usedBefore = usedBefore)) }) {
                        is ApiResult.Ok -> onDone()
                        is ApiResult.Err -> err = apiErrorText(r)
                    }
                    busy = false
                }
            },
        )
    }
}
