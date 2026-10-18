package expo.modules.besvision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder

// Body pose for up to 6 people (MoveNet MultiPose Lightning): 17 keypoints in
// COCO order, normalized to the UPRIGHT frame. Body joints only — no face
// landmarks, nothing that identifies anyone. Same threading rules as
// PersonDetector: used and closed only on its analysis thread.
data class PoseKeypoint(val x: Float, val y: Float, val score: Float)
data class PersonPose(val score: Float, val keypoints: List<PoseKeypoint>)
data class PoseResult(val poses: List<PersonPose>, val inferenceMs: Long)

class PoseEstimator(context: Context, private val minPoseScore: Float = 0.2f) : Closeable {
  private val interpreter = Interpreter(loadModel(context), Interpreter.Options().setNumThreads(2))
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val matrix = Matrix()
  private var inputW = 0
  private var inputH = 0
  private var inputBitmap: Bitmap? = null
  private var inputCanvas: Canvas? = null
  private var input: ByteBuffer? = null
  private var pixels: IntArray? = null
  private val output = Array(1) { Array(MAX_PEOPLE) { FloatArray(56) } }

  // The model accepts any size that is a multiple of 32: keep the frame's
  // aspect with the long side at 256 px.
  private fun ensureInput(uprightW: Int, uprightH: Int) {
    val scale = LONG_SIDE.toFloat() / maxOf(uprightW, uprightH)
    val w = maxOf(32, Math.round(uprightW * scale / 32f) * 32)
    val h = maxOf(32, Math.round(uprightH * scale / 32f) * 32)
    if (w == inputW && h == inputH) return
    inputW = w
    inputH = h
    interpreter.resizeInput(0, intArrayOf(1, h, w, 3))
    interpreter.allocateTensors()
    inputBitmap?.recycle()
    inputBitmap = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888).also { inputCanvas = Canvas(it) }
    input = ByteBuffer.allocateDirect(w * h * 3).order(ByteOrder.nativeOrder())
    pixels = IntArray(w * h)
  }

  fun estimate(bitmap: Bitmap, rotationDegrees: Int): PoseResult {
    val started = System.nanoTime()
    val rotated = rotationDegrees % 180 != 0
    val uprightW = if (rotated) bitmap.height else bitmap.width
    val uprightH = if (rotated) bitmap.width else bitmap.height
    ensureInput(uprightW, uprightH)
    val canvas = inputCanvas!!
    val buf = input!!
    val px = pixels!!

    matrix.reset()
    matrix.postTranslate(-bitmap.width / 2f, -bitmap.height / 2f)
    matrix.postRotate(rotationDegrees.toFloat())
    matrix.postScale(inputW.toFloat() / uprightW, inputH.toFloat() / uprightH)
    matrix.postTranslate(inputW / 2f, inputH / 2f)
    canvas.drawBitmap(bitmap, matrix, paint)

    inputBitmap!!.getPixels(px, 0, inputW, 0, 0, inputW, inputH)
    buf.rewind()
    for (p in px) {
      buf.put(((p shr 16) and 0xFF).toByte())
      buf.put(((p shr 8) and 0xFF).toByte())
      buf.put((p and 0xFF).toByte())
    }
    buf.rewind()
    interpreter.run(buf, output)

    val poses = ArrayList<PersonPose>(MAX_PEOPLE)
    for (row in output[0]) {
      val score = row[55]
      if (score < minPoseScore) continue
      // 17 x (y, x, score), then the person box (unused: we have our own detector).
      val keypoints = (0 until 17).map { k -> PoseKeypoint(row[k * 3 + 1].coerceIn(0f, 1f), row[k * 3].coerceIn(0f, 1f), row[k * 3 + 2]) }
      poses.add(PersonPose(score, keypoints))
    }
    return PoseResult(poses, (System.nanoTime() - started) / 1_000_000)
  }

  override fun close() {
    interpreter.close()
    inputBitmap?.recycle()
    inputBitmap = null
  }

  companion object {
    private const val MAX_PEOPLE = 6
    private const val LONG_SIDE = 256
    private const val MODEL_ASSET = "bes_vision/movenet_multipose_lightning.tflite"
    @Volatile private var modelBuffer: ByteBuffer? = null

    private fun loadModel(context: Context): ByteBuffer {
      val cached = modelBuffer ?: synchronized(this) {
        modelBuffer ?: context.assets.open(MODEL_ASSET).use { it.readBytes() }.let { bytes ->
          ByteBuffer.allocateDirect(bytes.size).order(ByteOrder.nativeOrder()).apply {
            put(bytes)
            rewind()
          }
        }.also { modelBuffer = it }
      }
      return cached.duplicate().order(ByteOrder.nativeOrder())
    }
  }
}
