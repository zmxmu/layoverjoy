plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
    id("org.jetbrains.kotlin.plugin.serialization")
}

// 城市目录单一事实源构建期同步（shared/catalog → assets；见 scripts/sync-catalog.sh）。
tasks.register<Copy>("syncCatalog") {
    from(file("${rootDir}/../../shared/catalog/city-airport-catalog.zh-en.json"))
    into(file("src/main/assets/catalog"))
}
tasks.matching { it.name == "preBuild" }.configureEach { dependsOn("syncCatalog") }

android {
    namespace = "com.yuanhe.layoverjoy"
    compileSdk = 37

    defaultConfig {
        applicationId = "com.yuanhe.layoverjoy"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        // 默认连接本机 Docker 后端（127.0.0.1）；普通用户不可见服务器设置，
        // 「我的」页双击标题进入隐藏开发页可在本机/远程正式服务器间切换。
        buildConfigField("String", "DEFAULT_BASE_URL", "\"http://127.0.0.1:8080\"")
        // 远程正式服务器：Daytona 部署的 Preview URL；私有预览 Token 不打包进 APK，运行时在隐藏开发页手填。
        buildConfigField("String", "DEFAULT_REMOTE_URL", "\"https://8080-8d6aeed3-d78e-4aea-a0c9-88b5bc4415f5.daytonaproxy01.net\"")
        buildConfigField("String", "DEFAULT_PREVIEW_TOKEN", "\"\"")
    }

    buildTypes {
        debug {
            isMinifyEnabled = false
        }
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}

// AGP 9 内置 Kotlin 支持，通过顶层 kotlin {} 配置编译选项
kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.19.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.navigation:navigation-compose:2.9.8")
    implementation("androidx.datastore:datastore-preferences:1.1.7")

    implementation("androidx.compose.ui:ui:1.11.4")
    implementation("androidx.compose.ui:ui-graphics:1.11.4")
    implementation("androidx.compose.ui:ui-tooling-preview:1.11.4")
    implementation("androidx.compose.foundation:foundation:1.11.4")
    implementation("androidx.compose.material3:material3:1.4.0")
    implementation("androidx.compose.material:material-icons-extended:1.7.8")
    debugImplementation("androidx.compose.ui:ui-tooling:1.11.4")

    implementation("com.squareup.okhttp3:okhttp:5.4.0")
    implementation("com.squareup.retrofit2:retrofit:3.0.0")
    implementation("com.squareup.retrofit2:converter-kotlinx-serialization:3.0.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.11.0")

    testImplementation("junit:junit:4.13.2")
}
