package com.yuanhe.layoverjoy.data

import android.util.Log

/**
 * 行为埋点（方案 §9）：只记录**行为**与可解释的技术字段（Provider、耗时、城市代码、机场数量），
 * 不得输出经纬度、邮箱、护照或签证信息。
 *
 * 事件名清单：
 * search_preferences_restored / search_date_auto_rolled / current_city_clicked /
 * location_permission_requested / location_permission_granted / location_permission_denied /
 * nearby_city_matched / nearby_city_match_failed / origin_confirmed_from_location
 */
object Trace {

    const val TAG = "LayoverJoyTrace"

    fun event(name: String, vararg fields: Pair<String, String>) {
        if (fields.isEmpty()) {
            Log.d(TAG, name)
        } else {
            Log.d(TAG, name + " " + fields.joinToString(" ") { "${it.first}=${it.second}" })
        }
    }
}
