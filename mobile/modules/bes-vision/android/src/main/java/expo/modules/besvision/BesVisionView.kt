package expo.modules.besvision

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.hardware.display.DisplayManager
import android.util.Size
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.camera.core.Camera
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraState
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.UseCase
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.Observer
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

// AI Monitor camera: a CameraX preview plus (optionally) on-device person
// detection. Owns no camera unless `active` is true. Emergency always wins:
// releaseCamera() gives the camera up immediately and reports once CameraX
// says it is closed; model cleanup happens afterwards on a background thread
// and nobody waits for it.
//
// Never calls ProcessCameraProvider.unbindAll(): the provider is shared with
// expo-camera, and unbindAll() would tear down the Emergency camera.
class BesVisionView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  override val shouldUseAndroidLayout = true

  private val onCameraState by EventDispatcher()
  private val onDetections by EventDispatcher()

  private val previewView = PreviewView(context).apply {
    // TextureView-backed so React Native overlays draw on top reliably.
    implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    scaleType = PreviewView.ScaleType.FILL_CENTER
  }
  private val mainHandler = Handler(Looper.getMainLooper())

  // Props
  private var wantActive = false
  private var facing = "back"
  private var analysisEnabled = false
  private var targetFps = 8
  @Volatile private var scoreThreshold = 0.3f
  @Volatile private var model = PersonDetector.DEFAULT_MODEL
  // Body pose (AI Phase 2): off unless the threat monitor asks for it, and
  // run on every `poseEvery`-th analyzed frame that has people in it.
  @Volatile private var poseEnabled = false
  @Volatile private var poseEvery = 2
  // Validation only: adds this much time to every inference, to prove that
  // releasing the camera never waits on a slow model. 0 in normal use.
  @Volatile private var debugSlowInferenceMs = 0

  // Camera (main thread only)
  private var provider: ProcessCameraProvider? = null
  private var camera: Camera? = null
  private var preview: Preview? = null
  private var analysis: ImageAnalysis? = null
  private var boundFacing: String? = null
  private var starting = false
  private var heldOff = false // released externally; stays off until JS sets active=false
  private var stateObserver: Observer<CameraState>? = null
  private var reportedRunning = false

  // Analysis
  @Volatile private var sessionId = 0
  private val accepting = AtomicBoolean(false)
  private var analysisSession: AnalysisSession? = null
  @Volatile private var detectorFailed = false

  // Phone rotation speed (gyroscope, rad/s), max since the last result, so
  // JS can tell camera movement from people moving. -1 = no gyroscope.
  @Volatile private var maxRotationRate = 0f
  private val sensorManager = context.getSystemService(Context.SENSOR_SERVICE) as? SensorManager
  private val gyroscope: Sensor? = sensorManager?.getDefaultSensor(Sensor.TYPE_GYROSCOPE)
  private var gyroRegistered = false
  private val gyroListener = object : SensorEventListener {
    override fun onSensorChanged(event: SensorEvent) {
      val v = event.values
      val rate = kotlin.math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])
      if (rate > maxRotationRate) maxRotationRate = rate
    }
    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {}
  }

  // Keep CameraX output upright when the phone rotates (the activity isn't
  // recreated on rotation).
  private val displayManager = context.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager
  private var displayListenerRegistered = false
  private val displayListener = object : DisplayManager.DisplayListener {
    override fun onDisplayAdded(displayId: Int) {}
    override fun onDisplayRemoved(displayId: Int) {}
    override fun onDisplayChanged(displayId: Int) {
      val rotation = display?.rotation ?: return
      preview?.targetRotation = rotation
      analysis?.targetRotation = rotation
    }
  }

  // One analysis thread per camera session. The detector is created, used and
  // closed only on that thread, so closing it can never race an inference.
  private class AnalysisSession(val id: Int) {
    val executor: ExecutorService = Executors.newSingleThreadExecutor { r ->
      Thread(r, "bes-vision-analysis").apply { priority = Thread.NORM_PRIORITY - 1 }
    }
    var detector: PersonDetector? = null
    var pose: PoseEstimator? = null
    var poseFailed = false
    var analyzedFrames = 0L
    var closed = false
    var lastAnalyzedAt = 0L
  }

  init {
    addView(previewView, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    BesVisionRegistry.register(this)
  }

  // ── Props ───────────────────────────────────────────────────────────────
  fun setActive(value: Boolean) {
    wantActive = value
    if (!value) heldOff = false
  }

  fun setFacing(value: String) {
    facing = if (value == "front") "front" else "back"
  }

  fun setAnalysisEnabled(value: Boolean) {
    analysisEnabled = value
  }

  fun setScoreThreshold(value: Double) {
    scoreThreshold = value.toFloat().coerceIn(0.1f, 0.9f)
  }

  fun setDebugSlowInferenceMs(value: Int) {
    debugSlowInferenceMs = value.coerceIn(0, 5000)
  }

  fun setModel(value: String) {
    model = value
  }

  fun setPoseEnabled(value: Boolean) {
    poseEnabled = value
  }

  fun setPoseEvery(value: Int) {
    poseEvery = value.coerceIn(1, 10)
  }

  fun setTargetFps(value: Int) {
    targetFps = value.coerceIn(1, 15)
  }

  // Called on the main thread after every batch of prop updates.
  fun applyProps() {
    val bound = camera != null
    when {
      wantActive && !heldOff && !bound -> start()
      !wantActive && bound -> releaseCamera("stopped", null)
      bound && boundFacing != facing -> {
        releaseCamera("restart", null)
        start()
      }
      bound -> updateAnalysis()
    }
  }

  // ── Start ───────────────────────────────────────────────────────────────
  private fun start() {
    if (starting || camera != null) return
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
      emitState("error", "permission", "Camera permission is not granted.")
      return
    }
    val owner = appContext.currentActivity as? LifecycleOwner
    if (owner == null) {
      emitState("error", "no_activity", "The camera is unavailable right now.")
      return
    }
    starting = true
    val future = ProcessCameraProvider.getInstance(context)
    future.addListener({
      starting = false
      if (!wantActive || heldOff || camera != null) return@addListener
      try {
        bind(future.get(), owner)
      } catch (e: Exception) {
        Log.w(TAG, "Camera bind failed", e)
        emitState("error", "bind_failed", "Camera could not start. Another app or Bes Emergency may be using it.")
      }
    }, ContextCompat.getMainExecutor(context))
  }

  private fun bind(cameraProvider: ProcessCameraProvider, owner: LifecycleOwner) {
    // Preview and analysis share a 4:3 aspect ratio so they cover the same
    // field of view and boxes line up with what's on screen.
    val aspect = AspectRatioStrategy.RATIO_4_3_FALLBACK_AUTO_STRATEGY
    val rotation = display?.rotation ?: android.view.Surface.ROTATION_0
    val newPreview = Preview.Builder()
      .setResolutionSelector(ResolutionSelector.Builder().setAspectRatioStrategy(aspect).build())
      .setTargetRotation(rotation)
      .build()
      .also { it.surfaceProvider = previewView.surfaceProvider }
    val newAnalysis = ImageAnalysis.Builder()
      .setResolutionSelector(
        ResolutionSelector.Builder()
          .setAspectRatioStrategy(aspect)
          .setResolutionStrategy(ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
          .build(),
      )
      .setTargetRotation(rotation)
      .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
      .setOutputImageFormat(ImageAnalysis.OUTPUT_IMAGE_FORMAT_RGBA_8888)
      .build()
    val selector = if (facing == "front") CameraSelector.DEFAULT_FRONT_CAMERA else CameraSelector.DEFAULT_BACK_CAMERA
    val useCases = arrayOf<UseCase>(newPreview, newAnalysis)

    val boundCamera = cameraProvider.bindToLifecycle(owner, selector, *useCases)
    provider = cameraProvider
    camera = boundCamera
    preview = newPreview
    analysis = newAnalysis
    boundFacing = facing
    reportedRunning = false
    sessionId = nextSessionId.incrementAndGet()

    val observer = Observer<CameraState> { state -> onCameraStateChanged(state) }
    stateObserver = observer
    boundCamera.cameraInfo.cameraState.observeForever(observer)

    if (!displayListenerRegistered && displayManager != null) {
      displayManager.registerDisplayListener(displayListener, mainHandler)
      displayListenerRegistered = true
    }
    emitState("starting")
    updateAnalysis()
  }

  private fun onCameraStateChanged(state: CameraState) {
    val error = state.error
    if (error != null && error.type == CameraState.ErrorType.CRITICAL) {
      emitState("error", "camera_${error.code}", "The camera stopped unexpectedly.")
      releaseCamera("camera_error", null)
      return
    }
    when (state.type) {
      CameraState.Type.OPEN -> if (!reportedRunning) {
        reportedRunning = true
        emitState("running")
      }
      CameraState.Type.PENDING_OPEN -> if (error != null) {
        // Recoverable, e.g. another client (Emergency) holds the camera.
        emitState("waiting", "camera_${error.code}", "Waiting for the camera.")
      }
      else -> {}
    }
    // Something else (expo-camera's unbindAll) took the camera from us.
    val p = preview
    val prov = provider
    if (p != null && prov != null && !prov.isBound(p)) {
      emitState("preempted", "taken")
      heldOff = true
      releaseCamera("preempted", null)
    }
  }

  // ── Analysis ────────────────────────────────────────────────────────────
  private fun updateAnalysis() {
    val a = analysis ?: return
    if (!analysisEnabled || detectorFailed) {
      accepting.set(false)
      a.clearAnalyzer()
      setGyro(false)
      return
    }
    setGyro(true)
    if (accepting.get()) return
    val run = analysisSession?.takeIf { it.id == sessionId } ?: AnalysisSession(sessionId).also {
      closeAnalysis()
      analysisSession = it
    }
    accepting.set(true)
    a.setAnalyzer(run.executor) { image -> analyze(image, run) }
  }

  // Runs on run.executor only.
  private fun analyze(image: ImageProxy, run: AnalysisSession) {
    val session = run.id
    try {
      if (run.closed || !accepting.get() || session != sessionId) return
      val now = SystemClock.elapsedRealtime()
      if (now - run.lastAnalyzedAt < 1000L / effectiveFps()) return
      run.lastAnalyzedAt = now

      val det = run.detector ?: try {
        PersonDetector(context, scoreThreshold, model).also { run.detector = it }
      } catch (e: Throwable) {
        Log.e(TAG, "Model failed to load", e)
        detectorFailed = true
        accepting.set(false)
        mainHandler.post { if (session == sessionId) emitState("error", "model_load", "AI detection could not start.") }
        return
      }

      val bitmap = det.frameBitmap(image)
      val rotation = image.imageInfo.rotationDegrees
      val result = det.detect(bitmap, rotation)
      run.analyzedFrames += 1
      // Pose only when asked, people are present, and on every Nth frame.
      // A pose model failure never stops person detection.
      var poses: PoseResult? = null
      if (poseEnabled && !run.poseFailed && result.people.isNotEmpty() && run.analyzedFrames % poseEvery == 0L) {
        try {
          val estimator = run.pose ?: PoseEstimator(context).also { run.pose = it }
          poses = estimator.estimate(bitmap, rotation)
        } catch (e: Throwable) {
          Log.e(TAG, "Pose model failed", e)
          run.poseFailed = true
        }
      }
      if (debugSlowInferenceMs > 0) Thread.sleep(debugSlowInferenceMs.toLong())
      // Drop results that finished after Stop / a new session started.
      if (!accepting.get() || session != sessionId) return
      val payload = mapOf(
        "sessionId" to session,
        "timestamp" to System.currentTimeMillis(),
        "frameWidth" to result.frameWidth,
        "frameHeight" to result.frameHeight,
        "inferenceMs" to result.inferenceMs,
        "targetFps" to effectiveFps(),
        "rotationRate" to (if (gyroscope == null) -1.0 else maxRotationRate.toDouble()).also { maxRotationRate = 0f },
        "detections" to result.people.map {
          mapOf("x" to it.x, "y" to it.y, "width" to it.width, "height" to it.height, "score" to it.score)
        },
        "poses" to (poses?.poses?.map { p ->
          mapOf("score" to p.score, "keypoints" to p.keypoints.map { k -> listOf(k.x, k.y, k.score) })
        } ?: emptyList<Any>()),
        "poseRan" to (poses != null),
        "poseMs" to (poses?.inferenceMs ?: 0L),
      )
      mainHandler.post {
        if (session == sessionId && accepting.get()) onDetections(payload)
      }
    } catch (e: Throwable) {
      Log.w(TAG, "Analysis failed", e)
    } finally {
      image.close()
    }
  }

  private fun setGyro(on: Boolean) {
    val sm = sensorManager ?: return
    val g = gyroscope ?: return
    if (on && !gyroRegistered) {
      maxRotationRate = 0f
      gyroRegistered = sm.registerListener(gyroListener, g, SensorManager.SENSOR_DELAY_GAME)
    } else if (!on && gyroRegistered) {
      sm.unregisterListener(gyroListener)
      gyroRegistered = false
    }
  }

  // Back off as the phone heats up.
  private fun effectiveFps(): Int {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return targetFps
    val pm = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return targetFps
    return when (pm.currentThermalStatus) {
      PowerManager.THERMAL_STATUS_NONE, PowerManager.THERMAL_STATUS_LIGHT -> targetFps
      PowerManager.THERMAL_STATUS_MODERATE -> minOf(targetFps, 4)
      else -> minOf(targetFps, 2)
    }
  }

  // ── Release ─────────────────────────────────────────────────────────────
  // Stage 1 (main thread, never waits on inference): stop accepting frames,
  // clear the analyzer, unbind only our use cases, then report once CameraX
  // says the camera is CLOSED. Stage 2 (background): stop the analysis
  // thread and close the model after any in-flight inference finishes.
  fun releaseCamera(reason: String, onClosed: ((Boolean) -> Unit)?) {
    val releaseStartedNs = System.nanoTime()
    accepting.set(false)
    sessionId = nextSessionId.incrementAndGet() // invalidates in-flight results
    setGyro(false)
    if (displayListenerRegistered) {
      displayManager?.unregisterDisplayListener(displayListener)
      displayListenerRegistered = false
    }
    val cam = camera
    val prov = provider
    val useCases = listOfNotNull<UseCase>(preview, analysis)
    analysis?.clearAnalyzer()
    stateObserver?.let { obs -> cam?.cameraInfo?.cameraState?.removeObserver(obs) }
    stateObserver = null
    camera = null
    preview = null
    analysis = null
    boundFacing = null
    if (reason == "emergency") heldOff = true

    if (cam != null && prov != null && useCases.isNotEmpty()) {
      try {
        prov.unbind(*useCases.toTypedArray())
      } catch (e: Exception) {
        Log.w(TAG, "Unbind failed", e)
      }
    }
    closeAnalysis()
    if (cam != null) {
      Log.i(TAG, "Camera release: main thread busy ${(System.nanoTime() - releaseStartedNs) / 1_000_000} ms (reason=$reason)")
    }

    if (cam == null) {
      onClosed?.invoke(true)
      if (reason != "restart") emitState("released", reason)
      return
    }
    awaitClosed(cam) { closed ->
      onClosed?.invoke(closed)
      if (reason != "restart") emitState("released", reason)
    }
  }

  private fun awaitClosed(cam: Camera, onDone: (Boolean) -> Unit) {
    val state = cam.cameraInfo.cameraState
    val startedAt = SystemClock.elapsedRealtime()
    val done = { closed: Boolean ->
      Log.i(TAG, "Camera release: closed=$closed after ${SystemClock.elapsedRealtime() - startedAt} ms")
      onDone(closed)
    }
    if (state.value?.type == CameraState.Type.CLOSED) {
      done(true)
      return
    }
    var finished = false
    lateinit var observer: Observer<CameraState>
    val timeout = Runnable {
      if (finished) return@Runnable
      finished = true
      done(state.value?.type == CameraState.Type.CLOSED)
      // Keep watching (log only) so slow closes are measured, not just counted.
      mainHandler.postDelayed({ state.removeObserver(observer) }, LATE_CLOSE_WATCH_MS)
    }
    observer = Observer { s ->
      if (s.type != CameraState.Type.CLOSED) return@Observer
      if (!finished) {
        finished = true
        mainHandler.removeCallbacks(timeout)
        state.removeObserver(observer)
        done(true)
      } else {
        Log.w(TAG, "Camera release: closed late, after ${SystemClock.elapsedRealtime() - startedAt} ms")
        state.removeObserver(observer)
      }
    }
    state.observeForever(observer)
    mainHandler.postDelayed(timeout, CLOSE_TIMEOUT_MS)
  }

  // Stage 2: queued behind any in-flight inference on the session's own
  // thread, so the model is closed only after it finishes. Nobody waits.
  private fun closeAnalysis() {
    val run = analysisSession ?: return
    analysisSession = null
    try {
      run.executor.execute {
        run.closed = true
        try {
          run.detector?.close()
        } catch (e: Throwable) {
          Log.w(TAG, "Detector close failed", e)
        }
        try {
          run.pose?.close()
        } catch (e: Throwable) {
          Log.w(TAG, "Pose model close failed", e)
        }
        run.detector = null
        run.pose = null
      }
    } finally {
      run.executor.shutdown()
    }
  }

  fun destroy() {
    BesVisionRegistry.unregister(this)
    wantActive = false
    releaseCamera("unmounted", null)
  }

  private fun emitState(state: String, reason: String? = null, message: String? = null) {
    val payload = mutableMapOf<String, Any>("state" to state, "sessionId" to sessionId)
    reason?.let { payload["reason"] = it }
    message?.let { payload["message"] = it }
    if (Looper.myLooper() == Looper.getMainLooper()) onCameraState(payload) else mainHandler.post { onCameraState(payload) }
  }

  companion object {
    private const val TAG = "BesVision"
    private const val CLOSE_TIMEOUT_MS = 1500L
    private const val LATE_CLOSE_WATCH_MS = 10_000L
    private val nextSessionId = AtomicInteger(0)
  }
}
