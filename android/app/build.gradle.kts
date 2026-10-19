import java.util.Properties

plugins {
    id("com.android.application")
}

// The app's version follows the PC tracker's (package.json), so "1.50.0" is the same release on both.
val trackerVersion: String = Regex("\"version\"\\s*:\\s*\"(\\d+\\.\\d+\\.\\d+)\"")
    .find(rootProject.file("../package.json").readText())?.groupValues?.get(1) ?: "0.0.1"
val versionParts = trackerVersion.split(".").map { it.toInt() }

// The release signing key lives outside the project, next to the update signing key
// (%USERPROFILE%\.sof-tracker-release\android-keystore.properties, made by scripts/android.js).
// Every update must be signed with the same key, or Android refuses to install it over the old app.
val keyDir = System.getenv("SOF_RELEASE_KEY_DIR") ?: (System.getProperty("user.home") + "/.sof-tracker-release")
val keyProps = Properties().apply {
    val f = file("$keyDir/android-keystore.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}

android {
    namespace = "com.softracker.app"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.softracker.app"
        minSdk = 26
        targetSdk = 34
        versionCode = versionParts[0] * 10000 + versionParts[1] * 100 + versionParts[2]
        versionName = trackerVersion
    }

    signingConfigs {
        if (keyProps.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(keyProps.getProperty("storeFile"))
                storePassword = keyProps.getProperty("storePassword")
                keyAlias = keyProps.getProperty("keyAlias")
                keyPassword = keyProps.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = signingConfigs.findByName("release")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
