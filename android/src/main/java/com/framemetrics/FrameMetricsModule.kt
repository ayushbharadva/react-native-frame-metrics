package com.framemetrics

import com.facebook.react.bridge.ReactApplicationContext

class FrameMetricsModule(reactContext: ReactApplicationContext) :
  NativeFrameMetricsSpec(reactContext) {

  override fun multiply(a: Double, b: Double): Double {
    return a * b
  }

  companion object {
    const val NAME = NativeFrameMetricsSpec.NAME
  }
}
