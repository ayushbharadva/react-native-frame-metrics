package framemetrics.example

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

/** Example-only: sleeps the UI thread so the app can show a UI-only stall. */
class StallModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {
  override fun getName() = NAME

  @ReactMethod
  fun blockUiThread(ms: Double) {
    val durationMs = ms.toLong().coerceIn(0L, 5_000L)
    UiThreadUtil.runOnUiThread { Thread.sleep(durationMs) }
  }

  companion object {
    const val NAME = "ExampleStall"
  }
}

class StallPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? =
      if (name == StallModule.NAME) StallModule(reactContext) else null

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
        StallModule.NAME to
            ReactModuleInfo(
                name = StallModule.NAME,
                className = StallModule::class.java.name,
                canOverrideExistingModule = false,
                needsEagerInit = false,
                isCxxModule = false,
                isTurboModule = false,
            ))
  }
}
