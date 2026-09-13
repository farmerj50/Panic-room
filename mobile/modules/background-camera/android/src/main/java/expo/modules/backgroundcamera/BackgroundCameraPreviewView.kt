package expo.modules.backgroundcamera

import android.content.Context
import android.util.Log
import android.widget.FrameLayout
import androidx.camera.view.PreviewView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

/**
 * Displays the live feed from BackgroundCameraService's Preview use case,
 * which is bound to the service's own lifecycle (see
 * BackgroundCameraService's class doc) rather than this view's — so
 * (re)attaching just reconnects to whatever session is already running,
 * it never starts a second camera binding.
 */
class BackgroundCameraPreviewView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val previewView = PreviewView(context).apply {
    layoutParams = FrameLayout.LayoutParams(
      FrameLayout.LayoutParams.MATCH_PARENT,
      FrameLayout.LayoutParams.MATCH_PARENT,
    )
    // PERFORMANCE (the default) backs the preview with a SurfaceView, whose
    // separate-window compositing doesn't reliably show through a custom
    // Expo Modules view embedded in React Native's view tree — COMPATIBLE
    // uses a TextureView instead, which renders inline like a normal view.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
  }

  init {
    addView(previewView)
  }

  override fun onAttachedToWindow() {
    super.onAttachedToWindow()
    Log.i("BackgroundCamera", "PreviewView onAttachedToWindow $this")
    BackgroundCameraService.registerPreviewView(previewView)
  }

  override fun onDetachedFromWindow() {
    Log.i("BackgroundCamera", "PreviewView onDetachedFromWindow $this")
    BackgroundCameraService.unregisterPreviewView(previewView)
    super.onDetachedFromWindow()
  }
}
