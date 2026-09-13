package expo.modules.backgroundcamera

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.core.content.ContextCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch

class BackgroundCameraModule : Module() {
  // AsyncFunction lambdas are not themselves suspend contexts (confirmed by
  // a compile error when calling the service's suspend functions directly)
  // — bridge via this scope + an explicit Promise, the same pattern
  // expo-camera's own CameraViewModule.kt uses for its async calls.
  private val moduleScope = CoroutineScope(Dispatchers.Main)

  private val serviceListener = object : BackgroundCameraListener {
    override fun onSegmentFinalized(segment: SegmentInfo) {
      sendEvent(
        "onSegmentFinalized",
        Bundle().apply {
          putString("emergencyId", segment.emergencyId)
          putInt("sequence", segment.sequence)
          putString("facing", segment.facing)
          putString("localUri", segment.localUri)
          putString("startedAt", segment.startedAt)
          putString("endedAt", segment.endedAt)
        },
      )
    }

    override fun onError(message: String) {
      sendEvent("onError", Bundle().apply { putString("message", message) })
    }

    override fun onStoppedExternally() {
      sendEvent("onStoppedExternally", Bundle())
    }
  }

  override fun definition() = ModuleDefinition {
    Name("BackgroundCamera")

    Events("onSegmentFinalized", "onError", "onStoppedExternally")

    OnCreate {
      BackgroundCameraService.listener = serviceListener
    }

    OnDestroy {
      if (BackgroundCameraService.listener === serviceListener) {
        BackgroundCameraService.listener = null
      }
    }

    // Camera/microphone are while-in-use permission types — Android 14+
    // requires both permissions already granted AND this call to happen
    // while the app has a visible, foregrounded Activity (satisfied here
    // since JS only calls this from an on-screen action).
    AsyncFunction("startCapture") { emergencyId: String, facing: String, startingSequence: Int, promise: Promise ->
      val context = appContext.reactContext
      if (context == null) {
        promise.reject(Exceptions.ReactContextLost())
        return@AsyncFunction
      }
      val hasCamera = ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED
      if (!hasCamera) {
        promise.reject(Exceptions.MissingPermissions(Manifest.permission.CAMERA))
        return@AsyncFunction
      }
      moduleScope.launch {
        try {
          val service = BackgroundCameraService.awaitInstance(context)
          service.startCapture(emergencyId, facing, startingSequence)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("E_START_CAPTURE", e.message ?: "startCapture failed", e)
        }
      }
    }

    AsyncFunction("flip") { facing: String, promise: Promise ->
      val service = BackgroundCameraService.instance
      if (service == null) {
        promise.reject(Exceptions.AppContextLost())
        return@AsyncFunction
      }
      moduleScope.launch {
        try {
          service.flip(facing)
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("E_FLIP", e.message ?: "flip failed", e)
        }
      }
    }

    AsyncFunction("stopCapture") { promise: Promise ->
      val service = BackgroundCameraService.instance
      if (service == null) {
        promise.resolve(null)
        return@AsyncFunction
      }
      moduleScope.launch {
        try {
          service.stopCapture()
          promise.resolve(null)
        } catch (e: Exception) {
          promise.reject("E_STOP_CAPTURE", e.message ?: "stopCapture failed", e)
        }
      }
    }

    // Called once the backend has confirmed a segment (whether uploaded via
    // the live onSegmentFinalized listener, or during relaunch recovery) —
    // works regardless of whether the service is currently running, since
    // recovery must be able to clean up markers left by a previous,
    // now-dead process.
    Function("markSegmentUploaded") { emergencyId: String, sequence: Int ->
      val context = appContext.reactContext ?: return@Function
      BackgroundCameraService.deleteMarker(context, emergencyId, sequence)
    }

    // For relaunch recovery: every journal marker still on disk means
    // "finalized locally but not yet confirmed uploaded," regardless of
    // whether that's a crash, a force-stop, or the Stop Recording
    // notification action firing while JS was dead.
    AsyncFunction("listPendingSegments") {
      val context = appContext.reactContext ?: throw Exceptions.ReactContextLost()
      BackgroundCameraService.listPendingMarkers(context).map { segment ->
        Bundle().apply {
          putString("emergencyId", segment.emergencyId)
          putInt("sequence", segment.sequence)
          putString("facing", segment.facing)
          putString("localUri", segment.localUri)
          putString("startedAt", segment.startedAt)
          putString("endedAt", segment.endedAt)
        }
      }
    }

    View(BackgroundCameraPreviewView::class) {}
  }
}
