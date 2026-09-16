package com.framemetrics

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider

class FrameMetricsPackage : BaseReactPackage() {
  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return if (name == FrameMetricsModule.NAME) {
      FrameMetricsModule(reactContext)
    } else {
      null
    }
  }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    // Positional: parameter names differ between React Native versions (0.76 prefixes them).
    mapOf(
      FrameMetricsModule.NAME to ReactModuleInfo(
        FrameMetricsModule.NAME, // name
        FrameMetricsModule.NAME, // className
        false, // canOverrideExistingModule
        false, // needsEagerInit
        false, // isCxxModule
        true // isTurboModule
      )
    )
  }
}
