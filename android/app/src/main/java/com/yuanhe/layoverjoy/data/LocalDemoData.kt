package com.yuanhe.layoverjoy.data

/** 首页灵感卡 → 探索页的一次性预填（传 cityId，名称/机场范围由目录解析）。 */
object SearchPrefill {
    @Volatile
    var destinationCityId: String? = null

    fun takeDestinationCityId(): String? {
        val v = destinationCityId
        destinationCityId = null
        return v
    }
}
