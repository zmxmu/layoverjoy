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
import com.yuanhe.layoverjoy.ui.EmptyBlock
import com.yuanhe.layoverjoy.ui.ErrorBanner
import com.yuanhe.layoverjoy.ui.InfoBanner
import com.yuanhe.layoverjoy.ui.JoyCard
import com.yuanhe.layoverjoy.ui.LabeledField
import com.yuanhe.layoverjoy.ui.PrimaryButton
import com.yuanhe.layoverjoy.ui.fmtDate
import com.yuanhe.layoverjoy.ui.theme.BrandBackground
import com.yuanhe.layoverjoy.ui.theme.BrandDanger
import com.yuanhe.layoverjoy.ui.theme.BrandInkSoft
import com.yuanhe.layoverjoy.ui.theme.BrandPrimary
import kotlinx.coroutines.launch

private val PASSPORT_TYPES = listOf("ORDINARY" to "普通", "DIPLOMATIC" to "外交", "OFFICIAL" to "公务")
private val VISA_TYPES = listOf("TOURIST" to "旅游", "BUSINESS" to "商务", "TRANSIT" to "过境")

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
            is ApiResult.Err -> error = r.message
        }
    }

    LaunchedEffect(Unit) { load() }

    Column(Modifier.fillMaxSize()) {
        TopAppBar(
            title = { Text("旅行证件钱包") },
            navigationIcon = { IconButton(onClick = { nav.popBackStack() }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, null) } },
            colors = TopAppBarDefaults.topAppBarColors(containerColor = BrandBackground),
        )

        LazyColumn(Modifier.weight(1f).padding(horizontal = 20.dp)) {
            item {
                InfoBanner("我们只记录用于入境资格判断的最小信息：签发国家、证件/签证类型与有效期。不会索要证件号码、姓名或照片。")
                Spacer(Modifier.height(10.dp))
                ErrorBanner(error)
            }

            val list = docs
            if (list == null) {
                item { EmptyBlock("加载中…") }
            } else {
                if (list.isEmpty()) item { EmptyBlock("钱包是空的。添加一本护照后，Agent 才能核对入境资格。") }
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
                        Text("+ 护照", color = BrandPrimary, fontWeight = FontWeight.SemiBold)
                    }
                    TextButton(onClick = { showAddVisa = !showAddVisa; showAddPassport = false }) {
                        Text("+ 签证", color = BrandPrimary, fontWeight = FontWeight.SemiBold)
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
                if (d.kind == "PASSPORT") "护照 · ${d.countryCode}" else "签证 · ${d.countryCode}",
                style = MaterialTheme.typography.titleSmall,
                modifier = Modifier.weight(1f),
            )
            TextButton(onClick = onDelete) { Text("删除", color = BrandDanger) }
        }
        Text(
            buildString {
                d.passportType?.let { append("类型 $it · ") }
                d.visaType?.let { append("签证类别 $it · ") }
                append("有效期至 ${d.expiresOn?.let { fmtDate(it) } ?: "未填写"}")
            },
            style = MaterialTheme.typography.bodySmall,
            color = BrandInkSoft,
        )
        Spacer(Modifier.height(6.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            Badge(if (d.status == "ACTIVE") "有效" else d.status, color = if (d.status == "ACTIVE") BrandPrimary else BrandDanger, bg = if (d.status == "ACTIVE") BrandPrimary.copy(alpha = 0.1f) else BrandDanger.copy(alpha = 0.08f))
            if (d.isPrimary) Badge("主护照", color = BrandInkSoft, bg = BrandInkSoft.copy(alpha = 0.08f))
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
        Text("添加护照", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(10.dp))
        LabeledField("签发国家（ISO 代码）", country, { country = it.uppercase().take(2) }, placeholder = "CN")
        Spacer(Modifier.height(10.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            PASSPORT_TYPES.forEach { (code, label) ->
                TextButton(onClick = { type = code }) {
                    Text(label, color = if (type == code) BrandPrimary else BrandInkSoft, fontWeight = if (type == code) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
        LabeledField("有效期至（YYYY-MM-DD）", expiry, { expiry = it.trim() }, placeholder = "2032-01-01")
        Spacer(Modifier.height(8.dp))
        ErrorBanner(err)
        Spacer(Modifier.height(8.dp))
        PrimaryButton(
            text = "保存护照",
            loading = busy,
            enabled = country.length == 2 && expiry.matches(Regex("\\d{4}-\\d{2}-\\d{2}")),
            onClick = {
                busy = true
                err = null
                scope.launch {
                    when (val r = apiCall { Net.api.addDocument(DocumentInput(kind = "PASSPORT", countryCode = country, passportType = type, expiresOn = expiry, isPrimary = true)) }) {
                        is ApiResult.Ok -> { onDone() }
                        is ApiResult.Err -> err = r.message
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
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }

    JoyCard(Modifier.padding(vertical = 8.dp)) {
        Text("添加签证", style = MaterialTheme.typography.titleSmall)
        Spacer(Modifier.height(10.dp))
        LabeledField("签证国家（ISO 代码）", country, { country = it.uppercase().take(2) }, placeholder = "MY")
        Spacer(Modifier.height(10.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            VISA_TYPES.forEach { (code, label) ->
                TextButton(onClick = { type = code }) {
                    Text(label, color = if (type == code) BrandPrimary else BrandInkSoft, fontWeight = if (type == code) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
        LabeledField("有效期至（YYYY-MM-DD）", expiry, { expiry = it.trim() }, placeholder = "2027-06-30")
        Spacer(Modifier.height(8.dp))
        ErrorBanner(err)
        Spacer(Modifier.height(8.dp))
        PrimaryButton(
            text = "保存签证",
            loading = busy,
            enabled = country.length == 2 && expiry.matches(Regex("\\d{4}-\\d{2}-\\d{2}")),
            onClick = {
                busy = true
                err = null
                scope.launch {
                    when (val r = apiCall { Net.api.addDocument(DocumentInput(kind = "VISA", countryCode = country, visaType = type, expiresOn = expiry)) }) {
                        is ApiResult.Ok -> onDone()
                        is ApiResult.Err -> err = r.message
                    }
                    busy = false
                }
            },
        )
    }
}
