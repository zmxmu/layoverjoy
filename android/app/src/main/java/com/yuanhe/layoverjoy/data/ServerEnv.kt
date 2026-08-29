package com.yuanhe.layoverjoy.data

import com.yuanhe.layoverjoy.BuildConfig

/**
 * 运行环境与默认服务器地址。
 *
 * 10.0.2.2 是 Android 模拟器内置的固定别名，指向宿主机（开发电脑）的 127.0.0.1，
 * 不随电脑局域网 IP 变化；真机上则必须使用电脑的局域网地址。
 */
object ServerEnv {

    /** 是否运行在模拟器中（模拟器里 127.0.0.1 指向模拟器自身而非宿主机）。 */
    fun isEmulator(): Boolean =
        android.os.Build.FINGERPRINT.contains("generic") ||
            android.os.Build.MODEL.contains("Emulator") ||
            android.os.Build.MODEL.contains("Android SDK built for") ||
            android.os.Build.HARDWARE in listOf("goldfish", "ranchu") ||
            android.os.Build.PRODUCT.contains("sdk")

    /** 当前环境访问「开发电脑本机 Docker 后端」的正确地址（无持久化配置时的默认值）。 */
    fun localServerUrl(): String =
        if (isEmulator()) "http://10.0.2.2:8080" else BuildConfig.DEFAULT_BASE_URL
}
