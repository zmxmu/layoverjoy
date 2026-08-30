package com.yuanhe.layoverjoy.ui

/**
 * 航班基准语义（验收修复 2026-08-30）：
 * - segmentsCount == 1 → Nonstop baseline / 直飞基准；差价文案用 "vs nonstop / 相比直飞"
 * - segmentsCount > 1  → Best flight baseline / 最佳航班基准；差价文案用 "vs baseline / 相比基准"
 * - 0（未知/旧快照）→ 一律按 best-flight 处理，**绝不宣称直飞**。
 * 纯函数，供 Results/Home/PlanDetail 与单测共用。
 */
object BaselineLabels {
    fun isNonstop(segmentsCount: Int): Boolean = segmentsCount == 1

    fun titleKey(segmentsCount: Int): String =
        if (isNonstop(segmentsCount)) "results.baseline_nonstop" else "results.baseline_best"

    fun noBaselineKey(): String = "results.no_baseline"

    fun deltaUpKey(segmentsCount: Int): String =
        if (isNonstop(segmentsCount)) "results.delta_up_nonstop" else "results.delta_up_best"

    fun deltaDownKey(segmentsCount: Int): String =
        if (isNonstop(segmentsCount)) "results.delta_down_nonstop" else "results.delta_down_best"

    fun deltaFlatKey(segmentsCount: Int): String =
        if (isNonstop(segmentsCount)) "results.delta_flat_nonstop" else "results.delta_flat_best"

    fun homeMoreKey(segmentsCount: Int): String =
        if (isNonstop(segmentsCount)) "home.more_than_nonstop" else "home.more_than_best"

    fun homeLessKey(segmentsCount: Int): String =
        if (isNonstop(segmentsCount)) "home.less_than_nonstop" else "home.less_than_best"

    fun homeNoneKey(): String = "home.no_baseline"
}
