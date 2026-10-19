// SoF Tracker for Android: the phone companion of the PC tracker (pairing, live view on your Wi-Fi, notifications).
pluginManagement {
    repositories { google(); mavenCentral(); gradlePluginPortal() }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories { google(); mavenCentral() }
}
rootProject.name = "SoFTracker"
include(":app")
