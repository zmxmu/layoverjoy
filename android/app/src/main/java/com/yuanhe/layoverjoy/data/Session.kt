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
        val userEmail = stringPreferencesKey("user_email")
        val onboardingDone = booleanPreferencesKey("onboarding_done")
        val localPassportCountry = stringPreferencesKey("local_passport_country")
        val localPassportType = stringPreferencesKey("local_passport_type")
        val localPassportExpiry = stringPreferencesKey("local_passport_expiry")
        val localVisaCountries = stringPreferencesKey("local_visa_countries") // 逗号分隔
    }

    val accessToken: Flow<String?> = context.dataStore.data.map { it[Keys.accessToken] }
    val baseUrl: Flow<String?> = context.dataStore.data.map { it[Keys.baseUrl] }
    val onboardingDone: Flow<Boolean> = context.dataStore.data.map { it[Keys.onboardingDone] ?: false }
    val userEmail: Flow<String?> = context.dataStore.data.map { it[Keys.userEmail] }

    suspend fun snapshot(): SessionSnapshot {
        val p = context.dataStore.data.first()
        return SessionSnapshot(
            accessToken = p[Keys.accessToken],
            refreshToken = p[Keys.refreshToken],
            baseUrl = p[Keys.baseUrl],
            userEmail = p[Keys.userEmail],
            onboardingDone = p[Keys.onboardingDone] ?: false,
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

    suspend fun setBaseUrl(url: String) = context.dataStore.edit { it[Keys.baseUrl] = url }

    suspend fun setOnboardingDone(done: Boolean, passportCountry: String?, passportType: String?, visaCountries: List<String>) {
        context.dataStore.edit {
            it[Keys.onboardingDone] = done
            passportCountry?.let { c -> it[Keys.localPassportCountry] = c }
            passportType?.let { t -> it[Keys.localPassportType] = t }
            it[Keys.localVisaCountries] = visaCountries.joinToString(",")
        }
    }

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
            prefs.remove(Keys.onboardingDone)
        }
    }
}

data class SessionSnapshot(
    val accessToken: String?,
    val refreshToken: String?,
    val baseUrl: String?,
    val userEmail: String?,
    val onboardingDone: Boolean,
)
