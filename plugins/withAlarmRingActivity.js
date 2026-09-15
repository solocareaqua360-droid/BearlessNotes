const { withAndroidManifest, withDangerousMod, AndroidConfig } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const { getMainApplicationOrThrow } = AndroidConfig.Manifest;

// A task reminder's alarm needs to turn the screen on and show itself
// OVER the lock screen without the phone being unlocked first - the one
// thing a plain notifee full-screen intent into the app's own
// MainActivity cannot do, because MainActivity has no reason to ever
// bypass the lock screen for ordinary use (a note-taking app opening
// itself over a stranger's lock screen would be a real problem the rest
// of the year). So this is a SEPARATE Activity, added the same way
// react-native-android-widget adds its own configuration Activity: an
// entry in AndroidManifest.xml, and a small Kotlin class written
// straight into the app's java sources during prebuild.
//
// It runs in its own process (android:process) so that finishing it -
// see AlarmRingScreenRoot's BackHandler.exitApp() - can never take the
// main app down with it, even if the app happens to be running in the
// background at the exact moment the alarm rings.
function withAlarmRingActivity(config) {
  config = withAndroidManifest(config, (androidConfig) => {
    const mainApplication = getMainApplicationOrThrow(androidConfig.modResults);
    mainApplication.activity = mainApplication.activity ?? [];
    const already = mainApplication.activity.some(
      (activity) => activity.$['android:name'] === '.AlarmRingActivity'
    );
    if (!already) {
      mainApplication.activity.push({
        $: {
          'android:name': '.AlarmRingActivity',
          'android:exported': 'false',
          'android:launchMode': 'singleTask',
          'android:excludeFromRecents': 'true',
          'android:taskAffinity': '',
          'android:process': ':alarmring',
          // The modern (API 27+) way to ask for exactly this - a manifest
          // declaration rather than a runtime call, though the Kotlin
          // class below also sets the equivalent window flags for
          // anything older.
          'android:showWhenLocked': 'true',
          'android:turnScreenOn': 'true',
        },
      });
    }
    return androidConfig;
  });

  return withDangerousMod(config, [
    'android',
    (dangerousConfig) => {
      const packageName = dangerousConfig.android?.package;
      if (!packageName) return dangerousConfig;
      const appPackageDir = path.join(
        dangerousConfig.modRequest.platformProjectRoot,
        'app/src/main/java',
        packageName.split('.').join('/')
      );
      fs.mkdirSync(appPackageDir, { recursive: true });
      const source = `package ${packageName}

import android.content.Context
import android.app.KeyguardManager
import android.os.Build
import android.os.Bundle
import android.view.WindowManager

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import expo.modules.ReactActivityDelegateWrapper

// Opened directly by a ringing task alarm (see fullScreenAction in
// src/utils/reminders.ts) instead of MainActivity - the window flags
// below are what let it appear over the lock screen without the phone
// being unlocked first, which is deliberately NOT something MainActivity
// itself ever asks for. Everything actually drawn on screen is still
// ordinary JS (AlarmRingScreenRoot, registered under the component name
// below) - this class only asks Android for the window.
class AlarmRingActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    setTheme(R.style.AppTheme)
    super.onCreate(null)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      window.addFlags(
        WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
        WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON or
        WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD
      )
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)

    val keyguardManager = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
    keyguardManager.requestDismissKeyguard(this, null)
  }

  override fun getMainComponentName(): String = "AlarmRingScreen"

  override fun createReactActivityDelegate(): ReactActivityDelegate {
    return ReactActivityDelegateWrapper(
      this,
      BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
      object : DefaultReactActivityDelegate(
        this,
        mainComponentName,
        fabricEnabled
      ) {})
  }
}
`;
      fs.writeFileSync(path.join(appPackageDir, 'AlarmRingActivity.kt'), source);
      return dangerousConfig;
    },
  ]);
}

module.exports = withAlarmRingActivity;
