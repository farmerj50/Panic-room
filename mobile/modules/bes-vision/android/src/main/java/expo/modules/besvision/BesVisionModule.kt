package expo.modules.besvision

import android.graphics.BitmapFactory
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.lang.ref.WeakReference

// Live monitor views, so Emergency can release the camera without needing a
// React ref to the screen. Main thread only.
internal object BesVisionRegistry {
  private val views = mutableListOf<WeakReference<BesVisionView>>()

  fun register(view: BesVisionView) {
    views.removeAll { it.get() == null }
    views.add(WeakReference(view))
  }

  fun unregister(view: BesVisionView) {
    views.removeAll { it.get() == null || it.get() === view }
  }

  fun releaseAll(reason: String, done: (Boolean) -> Unit) {
    val live = views.mapNotNull { it.get() }
    if (live.isEmpty()) {
      done(true)
      return
    }
    var remaining = live.size
    var allClosed = true
    live.forEach { view ->
      view.releaseCamera(reason) { closed ->
        allClosed = allClosed && closed
        remaining -= 1
        if (remaining == 0) done(allClosed)
      }
    }
  }
}

class BesVisionModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("BesVision")

    // Stage-1 release of every monitor camera. Resolves true once CameraX
    // reports each camera CLOSED (false if that didn't happen in time).
    AsyncFunction("releaseCamera") { promise: Promise ->
      BesVisionRegistry.releaseAll("emergency") { closed -> promise.resolve(closed) }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("listTestImages") {
      val context = appContext.reactContext ?: throw IllegalStateException("No context")
      val dir = File(context.getExternalFilesDir(null), "bes-vision-test")
      (dir.listFiles() ?: emptyArray())
        .filter { it.isFile && it.extension.lowercase() in setOf("jpg", "jpeg", "png", "webp") }
        .map { it.name }
        .sorted()
    }

    // Validation harness: runs the detector on an image the tester pushed to
    // the app's own external files dir (bes-vision-test/). Local only.
    AsyncFunction("detectImage") { name: String, scoreThreshold: Double?, sensorRotation: Int?, model: String? ->
      val context = appContext.reactContext ?: throw IllegalStateException("No context")
      val dir = File(context.getExternalFilesDir(null), "bes-vision-test")
      val file = File(dir, name).canonicalFile
      require(file.path.startsWith(dir.canonicalPath + File.separator)) { "Invalid test image" }
      val bitmap = BitmapFactory.decodeFile(file.path) ?: throw IllegalArgumentException("Unreadable image")
      val detector = PersonDetector(context, (scoreThreshold ?: 0.5).toFloat(), model ?: PersonDetector.DEFAULT_MODEL)
      val poseEstimator = PoseEstimator(context)
      // sensorRotation simulates a camera frame: the image is rotated back the
      // way a sensor delivers it, then detect() must undo that rotation — the
      // same math the live ImageProxy path relies on.
      val rotation = ((sensorRotation ?: 0) % 360 + 360) % 360
      val input = if (rotation == 0) bitmap else {
        val m = android.graphics.Matrix().apply { postRotate(-rotation.toFloat()) }
        android.graphics.Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, m, true)
      }
      try {
        val result = detector.detect(input, rotation)
        val poses = poseEstimator.estimate(input, rotation)
        mapOf(
          "frameWidth" to result.frameWidth,
          "frameHeight" to result.frameHeight,
          "inferenceMs" to result.inferenceMs,
          "detections" to result.people.map {
            mapOf("x" to it.x, "y" to it.y, "width" to it.width, "height" to it.height, "score" to it.score)
          },
          "poses" to poses.poses.map { p ->
            mapOf("score" to p.score, "keypoints" to p.keypoints.map { k -> listOf(k.x, k.y, k.score) })
          },
          "poseMs" to poses.inferenceMs,
        )
      } finally {
        detector.close()
        poseEstimator.close()
        if (input !== bitmap) input.recycle()
        bitmap.recycle()
      }
    }

    View(BesVisionView::class) {
      Events("onCameraState", "onDetections")

      Prop("active") { view: BesVisionView, active: Boolean? -> view.setActive(active ?: false) }
      Prop("facing") { view: BesVisionView, facing: String? -> view.setFacing(facing ?: "back") }
      Prop("analysisEnabled") { view: BesVisionView, enabled: Boolean? -> view.setAnalysisEnabled(enabled ?: false) }
      Prop("scoreThreshold") { view: BesVisionView, value: Double? -> view.setScoreThreshold(value ?: 0.3) }
      Prop("debugSlowInferenceMs") { view: BesVisionView, value: Int? -> view.setDebugSlowInferenceMs(value ?: 0) }
      Prop("model") { view: BesVisionView, value: String? -> view.setModel(value ?: PersonDetector.DEFAULT_MODEL) }
      Prop("poseEnabled") { view: BesVisionView, value: Boolean? -> view.setPoseEnabled(value ?: false) }
      Prop("poseEvery") { view: BesVisionView, value: Int? -> view.setPoseEvery(value ?: 2) }
      Prop("targetFps") { view: BesVisionView, fps: Int? -> view.setTargetFps(fps ?: 8) }

      OnViewDidUpdateProps { view -> view.applyProps() }
      OnViewDestroys { view -> view.destroy() }
    }
  }
}
