package framemetrics.example

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "FrameMetricsExample"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      object : DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled) {
        /**
         * Forwards intent extras to JS as `initialProps`, so the 2x2 acceptance
         * matrix can be run unattended — on a device farm, for instance, where
         * nobody is there to press the buttons:
         *
         * ```
         * adb shell am start -n framemetrics.example/.MainActivity -e autorun 2x2
         * ```
         *
         * Example app only. Nothing in the library depends on this.
         */
        override fun getLaunchOptions(): Bundle? {
          val autorun = intent?.getStringExtra(EXTRA_AUTORUN) ?: return null
          return Bundle().apply { putString(EXTRA_AUTORUN, autorun) }
        }
      }

  private companion object {
    const val EXTRA_AUTORUN = "autorun"
  }
}
