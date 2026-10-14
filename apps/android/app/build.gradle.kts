plugins {
  id("com.android.application")
}

val sindarVersionCode = (project.findProperty("sindar.versionCode") as String?)?.toIntOrNull() ?: 1
val sindarVersionName = (project.findProperty("sindar.versionName") as String?) ?: "0.1.0"

android {
  namespace = "com.sindar.app"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.sindar.app"
    minSdk = 26
    targetSdk = 35
    versionCode = sindarVersionCode
    versionName = sindarVersionName
  }

  signingConfigs {
    // Dev builds are signed with the public key in ../keystore (anyone can rebuild an
    // identical-signature APK — fine for self-distributed previews, NOT for 1.0).
    // CI overrides these with -P properties when a real keystore secret exists.
    create("release") {
      storeFile = file((project.findProperty("sindar.keystore") as String?) ?: "../keystore/sindar-dev.p12")
      storePassword = (project.findProperty("sindar.storePassword") as String?) ?: "sindar-dev"
      keyAlias = (project.findProperty("sindar.keyAlias") as String?) ?: "sindar"
      keyPassword = (project.findProperty("sindar.keyPassword") as String?) ?: "sindar-dev"
      storeType = "PKCS12"
    }
  }

  buildTypes {
    getByName("release") {
      isMinifyEnabled = false
      isShrinkResources = false
      signingConfig = signingConfigs.getByName("release")
    }
    getByName("debug") {
      applicationIdSuffix = ".debug"
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  buildFeatures {
    buildConfig = true
  }

  packaging {
    resources.excludes += setOf("META-INF/*.version", "META-INF/LICENSE*")
  }
}

dependencies {
  implementation("androidx.appcompat:appcompat:1.7.0")
  implementation("androidx.webkit:webkit:1.12.1")
}
