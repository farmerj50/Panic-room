package expo.modules.backgroundcamera

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.util.Log
import androidx.camera.core.AspectRatio
import androidx.camera.core.CameraSelector
import androidx.camera.core.Preview
import androidx.camera.core.UseCaseGroup
import androidx.camera.core.resolutionselector.AspectRatioStrategy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.lifecycle.awaitInstance
import androidx.camera.video.FileOutputOptions
import androidx.camera.video.Quality
import androidx.camera.video.QualitySelector
import androidx.camera.video.Recorder
import androidx.camera.video.Recording
import androidx.camera.video.VideoCapture
import androidx.camera.video.VideoRecordEvent
import androidx.camera.view.PreviewView
import androidx.core.app.NotificationCompat
import androidx.core.content.ContextCompat
import androidx.lifecycle.LifecycleService
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import java.io.File
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

private const val TAG = "BackgroundCamera"
private const val CHANNEL_ID = "background_camera"
private const val NOTIFICATION_ID = 84201
const val ACTION_STOP_RECORDING = "expo.modules.backgroundcamera.ACTION_STOP_RECORDING"

data class SegmentInfo(
  val emergencyId: String,
  val sequence: Int,
  val facing: String,
  val localUri: String,
  val startedAt: String,
  val endedAt: String,
)

interface BackgroundCameraListener {
  fun onSegmentFinalized(segment: SegmentInfo)
  fun onError(message: String)
  fun onStoppedExternally()
}

/**
 * A LifecycleService (unlike CameraView's Activity-bound binding — see
 * node_modules/expo-camera/android/.../ExpoCameraView.kt:516) implements
 * LifecycleOwner on its OWN lifecycle. Preview + VideoCapture are bound
 * together here, to the service, so both survive the Activity backgrounding
 * or the user swiping the app away from Recents — proven in the
 * background-camera-spike module this replaces.
 *
 * KNOWN UNRESOLVED ISSUE (release-blocking — needs real-device
 * verification before shipping): on the Android emulator used for this
 * session's testing, having a `Preview` use case bound at all — regardless
 * of how attach/detach is handled — causes two failures together: (1) the
 * on-screen preview never shows a frame (stays black), and (2)
 * VideoRecordEvent.Finalize reports error=8 (ERROR_SOURCE_INACTIVE) on
 * stop, producing no valid output file. Removing Preview entirely (video
 * only, no live view) makes both failures disappear immediately and
 * finalize returns error=0 every time — see the recording-start/finalize
 * log lines this class already emits, which is how this was diagnosed.
 * Three independent binding strategies were tried (grouped in one
 * UseCaseGroup, bound as fully separate use cases, and bound once with
 * only the surfaceProvider target swapped afterward) and all three failed
 * identically, which points at an emulator/virtual-camera limitation with
 * simultaneous preview+record streams rather than a binding-order bug —
 * but this could not be confirmed without a physical device or a
 * different emulator image. Per explicit product decision, this module
 * keeps the Preview+VideoCapture architecture as the intended production
 * design (not reverted to video-only) — do not remove Preview to "fix"
 * this without confirming first, on real hardware, whether the bug is
 * even present there.
 *
 * Additional diagnostic evidence gathered via an Appium-driven on-device
 * (emulator) run, using logCameraCharacteristics() below plus stock
 * CameraX/Camera2 logcat output: the emulated camera reports
 * INFO_SUPPORTED_HARDWARE_LEVEL_3 (the highest tier — required to fully
 * support this exact combination of streams) with a broad capability set
 * (RAW, MANUAL_SENSOR, YUV/PRIVATE_REPROCESSING, BURST_CAPTURE,
 * DEPTH_OUTPUT). The resulting Camera2 capture session is configured
 * correctly at the API level — the repeating request logged by CXCP
 * explicitly targets both `Stream-1` (1024x720 PRIVATE, preview) and
 * `Stream-2` (1280x720 PRIVATE, video) together
 * ("UseCaseCameraState#updateState: ... streams = [Stream-2, Stream-1]").
 * Despite that correctly-formed dual-stream request, the emulator's
 * virtual camera backend never delivers a single frame to either surface:
 * `Recorder` logs "Cached audio data while we wait for video keyframe
 * before starting muxer" indefinitely, and no frame-availability activity
 * appears for the preview surface either. This is strong evidence the
 * failure is inside the emulator's virtual camera HAL's handling of two
 * concurrent PRIVATE-format streams, not in this module's use-case
 * binding — but it is still not proof, since it was only ever tested on
 * this one emulator image. Real-device verification remains required
 * before shipping.
 *
 * Two follow-up mitigation attempts were made and both ruled out,
 * narrowing the cause further:
 * (1) Aligned Preview and VideoCapture to the identical 1280x720 16:9
 *     resolution (they'd originally picked mismatched 1024x768 4:3 vs
 *     1280x720 16:9) via ResolutionSelector/QualitySelector below — logcat
 *     confirmed both streams then matched exactly, but the failure was
 *     byte-for-byte identical, ruling out a stream-config mismatch as the
 *     cause. (This alignment was kept — it's a correct practice regardless
 *     and doesn't hurt.)
 * (2) Dropped Preview to a tiny 320x180 resolution to test whether this is
 *     a throughput/bandwidth ceiling rather than a hard capability gate —
 *     identical failure again, so it isn't. (This change was reverted;
 *     shipping a degraded preview bought nothing.)
 * CameraX has a built-in mitigation for exactly this class of problem —
 * "Stream Sharing" opens one real camera stream and duplicates it in
 * software (GL) to multiple consumers — but per CameraX's own docs it only
 * auto-activates for devices reporting hardware level FULL or lower; this
 * emulator reports LEVEL_3 (above FULL), so CameraX assumes native
 * multi-stream support and never engages it. A `forceEnableStreamSharing`
 * hook exists in CameraX's source but is a test-only/internal API, not
 * stable public surface — not something to depend on in production code.
 * With both plausible app-level causes eliminated, this now points quite
 * specifically at the emulator's virtual camera HAL, not at anything this
 * module's binding code controls.
 */
class BackgroundCameraService : LifecycleService() {
  companion object {
    // Same-process singleton — this app only ever runs one capture session
    // at a time, so a direct reference is simpler and just as correct as a
    // full bindService/ServiceConnection round trip for this use case.
    var instance: BackgroundCameraService? = null
      private set

    var listener: BackgroundCameraListener? = null

    // Companion-level (not an instance field) because the PreviewView
    // commonly attaches to the window well before startCapture() has
    // actually created a service instance — activateEmergency() sets
    // cameraMounted (which mounts this view) long before it finishes the
    // GPS/backend/audio setup that precedes the actual startCapture() call.
    // Registering here means whichever happens first — the view attaching,
    // or the service starting — can find the other.
    @Volatile
    var attachedPreviewView: PreviewView? = null
      private set

    fun registerPreviewView(view: PreviewView) {
      Log.i(TAG, "registerPreviewView view=$view instance=$instance")
      attachedPreviewView = view
      instance?.reconnectPreview()
    }

    fun unregisterPreviewView(view: PreviewView) {
      Log.i(TAG, "unregisterPreviewView view=$view")
      if (attachedPreviewView === view) {
        attachedPreviewView = null
        // Clears Preview's surfaceProvider target only — the use case
        // stays bound (see bindUseCases()'s comment for why unbinding it
        // must never happen mid-recording).
        instance?.reconnectPreview()
      }
    }

    // startForegroundService() returns before onCreate() has necessarily
    // run — callers needing the live instance (the module's start/flip/stop
    // calls, a newly-attached PreviewView) await this instead of racing
    // `instance` directly. Replaced with a fresh, incomplete deferred in
    // onDestroy() so the next startCapture() call awaits correctly again.
    @Volatile
    private var readyDeferred = CompletableDeferred<BackgroundCameraService>()

    suspend fun awaitInstance(context: Context): BackgroundCameraService {
      instance?.let { return it }
      val intent = Intent(context, BackgroundCameraService::class.java)
      ContextCompat.startForegroundService(context, intent)
      return readyDeferred.await()
    }

    fun segmentsDir(context: Context): File {
      val dir = File(context.getExternalFilesDir(null), "emergency-segments")
      if (!dir.exists()) dir.mkdirs()
      return dir
    }

    // Recovery (relaunch) reads these regardless of whether the service is
    // currently running — a marker on disk from a previous process (killed,
    // crashed, or force-stopped) is exactly what recovery needs to find.
    fun listPendingMarkers(context: Context): List<SegmentInfo> {
      val dir = segmentsDir(context)
      val files = dir.listFiles { f -> f.extension == "json" } ?: emptyArray()
      return files.mapNotNull { file ->
        try {
          val json = JSONObject(file.readText())
          SegmentInfo(
            emergencyId = json.getString("emergencyId"),
            sequence = json.getInt("sequence"),
            facing = json.getString("facing"),
            localUri = json.getString("localUri"),
            startedAt = json.getString("startedAt"),
            endedAt = json.getString("endedAt"),
          )
        } catch (e: Exception) {
          Log.e(TAG, "failed to parse journal marker ${file.name}", e)
          null
        }
      }
    }

    fun deleteMarker(context: Context, emergencyId: String, sequence: Int) {
      try {
        File(segmentsDir(context), "cam-${emergencyId}-${sequence}.json").delete()
      } catch (e: Exception) {
        Log.e(TAG, "failed to delete journal marker", e)
      }
    }

    private val isoFormat = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
      timeZone = TimeZone.getTimeZone("UTC")
    }

    fun nowIso(): String = isoFormat.format(Date())
  }

  private val serviceScope = CoroutineScope(Dispatchers.Main.immediate + SupervisorJob())

  // Serializes startCapture/flip/stopCapture — without this, two
  // near-simultaneous calls (e.g. a flip racing an exit-triggered stop) can
  // interleave at suspension points inside finalizeCurrentRecording(),
  // exactly the class of bug the JS-side flippingRef guard was added to fix
  // earlier this session. Here it's enforced natively instead.
  private val commandMutex = Mutex()

  private var cameraProvider: ProcessCameraProvider? = null
  private var preview: Preview? = null
  private var videoCapture: VideoCapture<Recorder>? = null
  private var activeRecording: Recording? = null
  private var pendingFinalize: CompletableDeferred<VideoRecordEvent.Finalize>? = null

  private var emergencyId: String? = null
  private var facing: String = "back"
  private var sequence: Int = 1
  @Volatile private var stopRequested: Boolean = false

  override fun onCreate() {
    super.onCreate()
    instance = this
    readyDeferred.complete(this)
    Log.i(TAG, "onCreate")
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    super.onStartCommand(intent, flags, startId)
    if (intent?.action == ACTION_STOP_RECORDING) {
      serviceScope.launch {
        stopCapture()
        listener?.onStoppedExternally()
      }
    }
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    // By design, onDestroy() only ever runs gracefully after stopCapture()
    // has already finalized+unbound (stopCapture is this service's only
    // path to stopSelf()). Attempting to finalize here too would race
    // super.onDestroy()'s synchronous lifecycle-DESTROYED transition, which
    // CameraX reacts to by unbinding immediately — before an async finalize
    // could complete. An abrupt kill (force-stop/OOM) never reaches this
    // callback at all; that path relies on CameraX's Recorder producing a
    // valid partial file even without a clean stop(), confirmed empirically
    // in the spike (PASS C).
    Log.i(TAG, "onDestroy")
    cameraProvider?.unbindAll()
    instance = null
    readyDeferred = CompletableDeferred()
    serviceScope.cancel()
    super.onDestroy()
  }

  // ── JS-facing commands (called via BackgroundCameraModule) ──────────────

  suspend fun startCapture(emergencyId: String, facing: String, startingSequence: Int) = commandMutex.withLock {
    this.emergencyId = emergencyId
    this.facing = facing
    this.sequence = startingSequence
    stopRequested = false

    startForeground(NOTIFICATION_ID, buildNotification())

    val provider = ProcessCameraProvider.awaitInstance(this)
    cameraProvider = provider
    bindUseCases(provider, facing)
    startRecording()
  }

  suspend fun flip(facing: String) = commandMutex.withLock {
    if (stopRequested) return@withLock
    finalizeCurrentRecording()?.let { listener?.onSegmentFinalized(it) }
    if (stopRequested) return@withLock

    this.facing = facing
    val provider = cameraProvider ?: return@withLock
    bindUseCases(provider, facing)
    sequence += 1
    startRecording()
  }

  suspend fun stopCapture() = commandMutex.withLock {
    stopRequested = true
    finalizeCurrentRecording()?.let { listener?.onSegmentFinalized(it) }
    cameraProvider?.unbindAll()
    stopForeground(STOP_FOREGROUND_REMOVE)
    stopSelf()
  }

  // ── Preview reconnection ─────────────────────────────────────────────

  // Preview and VideoCapture are bound together, ONCE, for the whole
  // segment's lifetime, and never unbound/rebound individually — Camera2
  // shares one capture session across every use case bound to a camera, so
  // adding or removing just one (even via a nominally "separate"
  // bindToLifecycle call) forces the whole session to reconfigure, which
  // on-device testing showed interrupts the actively-recording VideoCapture
  // too (VideoRecordEvent.Finalize error=8 / ERROR_SOURCE_INACTIVE) — even
  // though the two were bound via distinct calls. The fix: attaching or
  // detaching a PreviewView only ever swaps Preview's surfaceProvider
  // *target* (explicitly designed by CameraX to be swappable at runtime
  // without touching the session) — the binding itself never changes.
  fun reconnectPreview() {
    preview?.setSurfaceProvider(attachedPreviewView?.surfaceProvider)
  }

  // ── Internals ────────────────────────────────────────────────────────

  private fun bindUseCases(provider: ProcessCameraProvider, facing: String) {
    // Recorder defaults to a 16:9 Quality (e.g. HD/1280x720) while a bare
    // Preview.Builder() independently defaults to whatever 4:3 resolution
    // the sensor prefers (observed as 1024x768 on this emulator) — logcat
    // showed the resulting concurrent capture request targeting two
    // streams with mismatched aspect ratios (Stream-1 1024x768 4:3,
    // Stream-2 1280x720 16:9), and no frames were ever delivered to either
    // surface once both were active together. Forcing both use cases to
    // the same 16:9 aspect ratio removes that mismatch as a variable.
    val qualitySelector = QualitySelector.from(Quality.HD)
    val recorder = Recorder.Builder().setQualitySelector(qualitySelector).build()
    val newVideoCapture = VideoCapture.Builder(recorder).build()

    val resolutionSelector = ResolutionSelector.Builder()
      .setAspectRatioStrategy(AspectRatioStrategy(AspectRatio.RATIO_16_9, AspectRatioStrategy.FALLBACK_RULE_AUTO))
      .build()
    val newPreview = Preview.Builder()
      .setResolutionSelector(resolutionSelector)
      .build()
    newPreview.setSurfaceProvider(attachedPreviewView?.surfaceProvider)

    val cameraSelector = if (facing == "front") {
      CameraSelector.DEFAULT_FRONT_CAMERA
    } else {
      CameraSelector.DEFAULT_BACK_CAMERA
    }

    val useCaseGroup = UseCaseGroup.Builder()
      .addUseCase(newPreview)
      .addUseCase(newVideoCapture)
      .build()

    provider.unbindAll()
    val camera = provider.bindToLifecycle(this, cameraSelector, useCaseGroup)
    logCameraCharacteristics(camera)

    preview = newPreview
    videoCapture = newVideoCapture
  }

  @androidx.annotation.OptIn(androidx.camera.camera2.interop.ExperimentalCamera2Interop::class)
  private fun logCameraCharacteristics(camera: androidx.camera.core.Camera) {
    try {
      val info = androidx.camera.camera2.interop.Camera2CameraInfo.from(camera.cameraInfo)
      val level = info.getCameraCharacteristic(android.hardware.camera2.CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL)
      val levelName = when (level) {
        android.hardware.camera2.CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LEGACY -> "LEGACY"
        android.hardware.camera2.CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_LIMITED -> "LIMITED"
        android.hardware.camera2.CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_FULL -> "FULL"
        android.hardware.camera2.CameraCharacteristics.INFO_SUPPORTED_HARDWARE_LEVEL_3 -> "LEVEL_3"
        else -> "EXTERNAL_OR_UNKNOWN($level)"
      }
      val caps = info.getCameraCharacteristic(android.hardware.camera2.CameraCharacteristics.REQUEST_AVAILABLE_CAPABILITIES)
      Log.i(TAG, "camera2 hardware level=$levelName capabilities=${caps?.toList()}")

      val map = info.getCameraCharacteristic(android.hardware.camera2.CameraCharacteristics.SCALER_STREAM_CONFIGURATION_MAP)
      val privSizes = map?.getOutputSizes(android.graphics.ImageFormat.PRIVATE)?.toList()
      Log.i(TAG, "camera2 PRIVATE format output sizes: $privSizes")
    } catch (e: Exception) {
      Log.e(TAG, "failed to log camera characteristics", e)
    }
  }

  private fun startRecording() {
    val recorder = videoCapture?.output ?: return
    val outFile = File(segmentsDir(this), "cam-${emergencyId}-${sequence}.mp4")
    val outputOptions = FileOutputOptions.Builder(outFile).build()
    val hasAudioPermission = ContextCompat.checkSelfPermission(
      this,
      Manifest.permission.RECORD_AUDIO,
    ) == PackageManager.PERMISSION_GRANTED

    val startedAt = nowIso()
    val deferred = CompletableDeferred<VideoRecordEvent.Finalize>()
    pendingFinalize = deferred

    activeRecording = recorder.prepareRecording(this, outputOptions)
      .apply { if (hasAudioPermission) withAudioEnabled() }
      .start(ContextCompat.getMainExecutor(this)) { event ->
        when (event) {
          is VideoRecordEvent.Start ->
            Log.i(TAG, "recording started seq=$sequence -> ${outFile.absolutePath}")
          is VideoRecordEvent.Finalize -> {
            Log.i(TAG, "recording finalized seq=$sequence error=${event.error}")
            deferred.complete(event)
          }
          else -> {}
        }
      }

    // Stash the metadata this segment needs once it finalizes.
    currentSegmentMeta = Triple(outFile, startedAt, sequence)
  }

  private var currentSegmentMeta: Triple<File, String, Int>? = null

  private suspend fun finalizeCurrentRecording(): SegmentInfo? {
    val recording = activeRecording ?: return null
    val deferred = pendingFinalize
    val meta = currentSegmentMeta
    activeRecording = null
    pendingFinalize = null
    currentSegmentMeta = null

    recording.stop()
    val finalizeEvent = deferred?.await()
    if (meta == null) return null
    val (file, startedAt, seq) = meta
    val endedAt = nowIso()

    if (finalizeEvent != null && finalizeEvent.error != VideoRecordEvent.Finalize.ERROR_NONE &&
      finalizeEvent.error != VideoRecordEvent.Finalize.ERROR_DURATION_LIMIT_REACHED &&
      finalizeEvent.error != VideoRecordEvent.Finalize.ERROR_FILE_SIZE_LIMIT_REACHED
    ) {
      listener?.onError("Segment $seq failed to finalize: error=${finalizeEvent.error}")
    }

    val emergencyId = this.emergencyId ?: return null
    // file.absolutePath is a bare filesystem path with no scheme — the JS
    // upload pipeline expects an absolute URI (it already rejects one with
    // "URI is not absolute"). CameraX's own Finalize event carries the
    // correct file:// URI; fall back to building one only if that event
    // never arrived (recording.stop() didn't cause the file to be missing).
    val uri = finalizeEvent?.outputResults?.outputUri?.toString() ?: Uri.fromFile(file).toString()
    val segment = SegmentInfo(
      emergencyId = emergencyId,
      sequence = seq,
      facing = facing,
      localUri = uri,
      startedAt = startedAt,
      endedAt = endedAt,
    )
    // Durable journal write happens BEFORE the caller emits the JS event —
    // see the plan's "CameraX finalizes -> native marker written -> JS
    // event" ordering. A marker left on disk always means "not yet
    // confirmed uploaded," regardless of why JS never got to it.
    writeJournalMarker(segment)
    return segment
  }

  private fun writeJournalMarker(segment: SegmentInfo) {
    try {
      val json = JSONObject().apply {
        put("emergencyId", segment.emergencyId)
        put("sequence", segment.sequence)
        put("facing", segment.facing)
        put("localUri", segment.localUri)
        put("startedAt", segment.startedAt)
        put("endedAt", segment.endedAt)
      }
      val markerFile = File(segmentsDir(this), "cam-${segment.emergencyId}-${segment.sequence}.json")
      markerFile.writeText(json.toString())
    } catch (e: Exception) {
      Log.e(TAG, "failed to write journal marker", e)
    }
  }


  private fun buildNotification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      if (manager.getNotificationChannel(CHANNEL_ID) == null) {
        manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Emergency camera recording", NotificationManager.IMPORTANCE_LOW),
        )
      }
    }

    val stopIntent = Intent(this, BackgroundCameraService::class.java).apply {
      action = ACTION_STOP_RECORDING
    }
    val stopPendingIntent = PendingIntent.getService(
      this,
      0,
      stopIntent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    return NotificationCompat.Builder(this, CHANNEL_ID)
      .setContentTitle("Bes emergency recording active")
      .setContentText("Recording continues even if you leave the app.")
      .setSmallIcon(android.R.drawable.ic_menu_camera)
      .setOngoing(true)
      .addAction(0, "Stop Recording", stopPendingIntent)
      .build()
  }
}
