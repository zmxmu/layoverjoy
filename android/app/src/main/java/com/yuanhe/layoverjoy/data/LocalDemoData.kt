package com.yuanhe.layoverjoy.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

/** 首页灵感卡 → 探索页的预填（传 cityId，名称/机场范围由目录解析）。
 *  P1-5：路由参数优先——搜索页即使已带着旧草稿组合，也必须监听新预填事件并覆盖本地草稿。 */
object SearchPrefill {
    data class Request(val token: Long, val cityId: String)

    private val _pending = MutableStateFlow<Request?>(null)
    val pending: StateFlow<Request?> = _pending
    private var counter = 0L

    fun request(cityId: String) {
        counter += 1
        _pending.value = Request(counter, cityId)
    }

    fun consume(token: Long) {
        if (_pending.value?.token == token) _pending.value = null
    }
}
