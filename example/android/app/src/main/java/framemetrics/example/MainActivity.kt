package framemetrics.example

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.ReactApplication
import com.facebook.react.bridge.Arguments
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
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  /**
   * Example-only: forwards adb commands to JS so device runs can be scripted. See
   * example/README.md. Senders must hold DUMP, which adb shell has and ordinary apps do not.
   */
  private val commandReceiver =
      object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          val reactContext =
              (application as ReactApplication).reactHost?.currentReactContext ?: return
          val event =
              Arguments.createMap().apply {
                putString("command", intent.getStringExtra("command"))
                putInt("ms", intent.getIntExtra("ms", 250))
              }
          reactContext.emitDeviceEvent("FrameMetricsCommand", event)
        }
      }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    val filter = IntentFilter(ACTION_COMMAND)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(commandReceiver, filter, SENDER_PERMISSION, null, RECEIVER_EXPORTED)
    } else {
      registerReceiver(commandReceiver, filter, SENDER_PERMISSION, null)
    }
  }

  override fun onDestroy() {
    unregisterReceiver(commandReceiver)
    super.onDestroy()
  }

  private companion object {
    const val ACTION_COMMAND = "framemetrics.example.COMMAND"
    const val SENDER_PERMISSION = "android.permission.DUMP"
  }
}
