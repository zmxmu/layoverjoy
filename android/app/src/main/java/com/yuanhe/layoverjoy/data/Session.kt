package com.yuanhe.layoverjoy.data

import android.content.Context
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map

private val Context.dataStore by preferencesDataStore(name = "layoverjoy_session")

/**
 * 会话与本地偏好存储。
 * 隐私底线：证件信息只在完成 onboarding 后按需上传“国家/类型/有效期”，
 * 本地与服务器都不保存证件号码、姓名与照片。
 */
class SessionStore(private val context: Context) {

    private object Keys {
        val accessToken = stringPreferencesKey("access_token")
        val refreshToken = stringPreferencesKey("refresh_token")
        val baseUrl = stringPreferencesKey("base_url")
        val previewToken = stringPreferencesKey("preview_token")
        val userEmail = stringPreferencesKey("user_email")
        val userId = stringPreferencesKey("user_id")
        val onboardingDone = booleanPreferencesKey("onboarding_done")
        val localPassportCountry = stringPreferencesKey("local_passport_country")
        val localPassportType = stringPreferencesKey("local_passport_type")
        val localPassportExpiry = stringPreferencesKey("local_passport_expiry")
        val localVisaCountries = stringPreferencesKey("local_visa_countries") // 逗号分隔
        val paySimFail = booleanPreferencesKey("pay_sim_fail")
    }

    val accessToken: Flow<String?> = context.dataStore.data.map { it[Keys.accessToken] }
    val baseUrl: Flow<String?> = context.dataStore.data.map { it[Keys.baseUrl] }
    val onboardingDone: Flow<Boolean> = context.dataStore.data.map { it[Keys.onboardingDone] ?: false }
    val userEmail: Flow<String?> = context.dataStore.data.map { it[Keys.userEmail] }
    val userId: Flow<String?> = context.dataStore.data.map { it[Keys.userId] }

    suspend fun snapshot(): SessionSnapshot {
        val p = context.dataStore.data.first()
        return SessionSnapshot(
            accessToken = p[Keys.accessToken],
            refreshToken = p[Keys.refreshToken],
            baseUrl = p[Keys.baseUrl],
            previewToken = p[Keys.previewToken],
            userEmail = p[Keys.userEmail],
            userId = p[Keys.userId],
            onboardingDone = p[Keys.onboardingDone] ?: false,
            paySimFail = p[Keys.paySimFail] ?: false,
        )
    }

    suspend fun saveTokens(access: String, refresh: String?) {
        TokenHolder.accessToken = access
        TokenHolder.refreshToken = refresh
        context.dataStore.edit {
            it[Keys.accessToken] = access
            if (refresh != null) it[Keys.refreshToken] = refresh
        }
    }

    suspend fun setEmail(email: String) = context.dataStore.edit { it[Keys.userEmail] = email }

    /**
     * 缓存服务端用户 id，供搜索偏好按 userId 隔离命名空间（`GET /v1/me` 的 user.id）。
     * 传 null/空串表示回到未登录命名空间（登出时调用），不删除已存的偏好。
     */
    suspend fun setUserId(id: String?) = context.dataStore.edit {
        val v = id?.trim()?.ifBlank { null }
        if (v == null) it.remove(Keys.userId) else it[Keys.userId] = v
    }

    suspend fun setBaseUrl(url: String) = context.dataStore.edit { it[Keys.baseUrl] = url }

    /** 保存私有预览 token（传 null/空串表示清除）。 */
    suspend fun setPreviewToken(token: String?) = context.dataStore.edit {
        val t = token?.trim()?.ifBlank { null }
        if (t == null) it.remove(Keys.previewToken) else it[Keys.previewToken] = t
    }

    /** 开发页支付失败模拟开关（仅本地缓存）。 */
    suspend fun setPaySimFail(enabled: Boolean) = context.dataStore.edit { it[Keys.paySimFail] = enabled }

    suspend fun setOnboardingDone(done: Boolean, passportCountry: String?, passportType: String?, visaCountries: List<String>) {
        context.dataStore.edit {
            it[Keys.onboardingDone] = done
            passportCountry?.let { c -> it[Keys.localPassportCountry] = c }
            passportType?.let { t -> it[Keys.localPassportType] = t }
            it[Keys.localVisaCountries] = visaCountries.joinToString(",")
        }
    }

    /** 服务端已有证件时仅恢复“引导已完成”标记，不覆盖本地已存的偏好数据。 */
    suspend fun restoreOnboardingDone() = context.dataStore.edit { it[Keys.onboardingDone] = true }

    suspend fun localPassport(): Triple<String?, String?, String?> {
        val p = context.dataStore.data.first()
        return Triple(p[Keys.localPassportCountry], p[Keys.localPassportType], p[Keys.localPassportExpiry])
    }

    suspend fun clear() {
        TokenHolder.accessToken = null
        TokenHolder.refreshToken = null
        context.dataStore.edit { prefs ->
            prefs.remove(Keys.accessToken)
            prefs.remove(Keys.refreshToken)
            prefs.remove(Keys.userEmail)
            prefs.remove(Keys.userId)
            prefs.remove(Keys.onboardingDone)
            // 注意：不删 search_preferences_v1_* —— 登出后重新登录仍要能恢复该用户的非敏感搜索偏好。
        }
    }
}

/**
 * 搜索偏好的落盘通道：复用【同一个】 Preferences DataStore 文件（layoverjoy_session），
 * 不开第二套存储。抽成接口是为了让编解码与日期推算法能在纯 JVM 单测里用内存实现跑。
 */
interface StringPrefStore {
    suspend fun read(key: String): String?
    suspend fun write(key: String, value: String)
    suspend fun delete(key: String)
}

class SessionStringPrefStore(private val context: Context) : StringPrefStore {
    override suspend fun read(key: String): String? =
        context.dataStore.data.first()[stringPreferencesKey(key)]

    override suspend fun write(key: String, value: String) {
        context.dataStore.edit { it[stringPreferencesKey(key)] = value }
    }

    override suspend fun delete(key: String) {
        context.dataStore.edit { it.remove(stringPreferencesKey(key)) }
    }
}

data class SessionSnapshot(
    val accessToken: String?,
    val refreshToken: String?,
    val baseUrl: String?,
    val previewToken: String?,
    val userEmail: String?,
    val userId: String?,
    val onboardingDone: Boolean,
    val paySimFail: Boolean = false,
)
