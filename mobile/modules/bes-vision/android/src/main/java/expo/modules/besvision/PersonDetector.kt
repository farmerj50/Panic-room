package expo.modules.besvision

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Matrix
import android.graphics.Paint
import androidx.camera.core.ImageProxy
import org.tensorflow.lite.Interpreter
import java.io.Closeable
import java.nio.ByteBuffer
import java.nio.ByteOrder

data class PersonBox(val x: Float, val y: Float, val width: Float, val height: Float, val score: Float)

// Boxes are normalized (0..1) to the UPRIGHT frame (sensor rotation applied),
// so frameWidth/frameHeight are the upright dimensions.
data class DetectionResult(
  val frameWidth: Int,
  val frameHeight: Int,
  val inferenceMs: Long,
  val people: List<PersonBox>,
)

// EfficientDet-Lite0 (COCO, TFLite_Detection_PostProcess built in). Only the
// person class is kept. Not thread-safe: the owning view calls detect() from
// its single analysis thread and close() only after that thread has stopped.
class PersonDetector(context: Context, private val scoreThreshold: Float = 0.5f) : Closeable {
  private val interpreter: Interpreter
  private val inputSize: Int
  private val input: ByteBuffer
  private val pixels: IntArray
  private val inputBitmap: Bitmap
  private val inputCanvas: Canvas
  private val paint = Paint(Paint.FILTER_BITMAP_FLAG)
  private val matrix = Matrix()
  private var frameBitmap: Bitmap? = null

  // Output order from the model metadata: location, category, score, count.
  private val maxDetections: Int
  private val boxes: Array<Array<FloatArray>>
  private val classes: Array<FloatArray>
  private val scores: Array<FloatArray>
  private val count = FloatArray(1)
  private val outputs: Map<Int, Any>

  init {
    interpreter = Interpreter(loadModel(context), Interpreter.Options().setNumThreads(2))
    interpreter.allocateTensors()
    val inputShape = interpreter.getInputTensor(0).shape() // [1, h, w, 3]
    inputSize = inputShape[1]
    input = ByteBuffer.allocateDirect(inputSize * inputSize * 3).order(ByteOrder.nativeOrder())
    pixels = IntArray(inputSize * inputSize)
    inputBitmap = Bitmap.createBitmap(inputSize, inputSize, Bitmap.Config.ARGB_8888)
    inputCanvas = Canvas(inputBitmap)

    val boxShape = interpreter.getOutputTensor(0).shape()
    require(boxShape.size == 3 && boxShape[2] == 4) { "Unexpected detector output: ${boxShape.contentToString()}" }
    maxDetections = boxShape[1]
    boxes = Array(1) { Array(maxDetections) { FloatArray(4) } }
    classes = Array(1) { FloatArray(maxDetections) }
    scores = Array(1) { FloatArray(maxDetections) }
    outputs = mapOf(0 to boxes, 1 to classes, 2 to scores, 3 to count)
  }

  fun detect(image: ImageProxy): DetectionResult {
    val bitmap = toBitmap(image)
    return detect(bitmap, image.imageInfo.rotationDegrees)
  }

  fun detect(bitmap: Bitmap, rotationDegrees: Int): DetectionResult {
    val started = System.nanoTime()
    val rotated = rotationDegrees % 180 != 0
    val uprightW = if (rotated) bitmap.height else bitmap.width
    val uprightH = if (rotated) bitmap.width else bitmap.height

    // Rotate to upright, then stretch to the model's square input (the same
    // non-letterboxed resize the model was evaluated with), so normalized
    // outputs map straight back onto the upright frame.
    matrix.reset()
    matrix.postTranslate(-bitmap.width / 2f, -bitmap.height / 2f)
    matrix.postRotate(rotationDegrees.toFloat())
    matrix.postScale(inputSize.toFloat() / uprightW, inputSize.toFloat() / uprightH)
    matrix.postTranslate(inputSize / 2f, inputSize / 2f)
    inputCanvas.drawBitmap(bitmap, matrix, paint)

    inputBitmap.getPixels(pixels, 0, inputSize, 0, 0, inputSize, inputSize)
    input.rewind()
    for (p in pixels) {
      input.put(((p shr 16) and 0xFF).toByte())
      input.put(((p shr 8) and 0xFF).toByte())
      input.put((p and 0xFF).toByte())
    }
    input.rewind()

    interpreter.runForMultipleInputsOutputs(arrayOf<Any>(input), outputs)

    val n = count[0].toInt().coerceIn(0, maxDetections)
    val people = ArrayList<PersonBox>(n)
    for (i in 0 until n) {
      if (classes[0][i].toInt() != PERSON_CLASS || scores[0][i] < scoreThreshold) continue
      val b = boxes[0][i] // ymin, xmin, ymax, xmax
      val top = b[0].coerceIn(0f, 1f)
      val left = b[1].coerceIn(0f, 1f)
      val bottom = b[2].coerceIn(0f, 1f)
      val right = b[3].coerceIn(0f, 1f)
      if (right <= left || bottom <= top) continue
      people.add(PersonBox(left, top, right - left, bottom - top, scores[0][i]))
    }
    val inferenceMs = (System.nanoTime() - started) / 1_000_000
    return DetectionResult(uprightW, uprightH, inferenceMs, people)
  }

  // ImageAnalysis is configured for RGBA_8888, so the single plane copies
  // straight into a reused bitmap when there's no row padding.
  private fun toBitmap(image: ImageProxy): Bitmap {
    val plane = image.planes[0]
    if (plane.pixelStride == 4 && plane.rowStride == image.width * 4) {
      val reuse = frameBitmap?.takeIf { it.width == image.width && it.height == image.height }
        ?: Bitmap.createBitmap(image.width, image.height, Bitmap.Config.ARGB_8888).also {
          frameBitmap?.recycle()
          frameBitmap = it
        }
      plane.buffer.rewind()
      reuse.copyPixelsFromBuffer(plane.buffer)
      return reuse
    }
    return image.toBitmap()
  }

  override fun close() {
    interpreter.close()
    frameBitmap?.recycle()
    frameBitmap = null
    inputBitmap.recycle()
  }

  companion object {
    const val PERSON_CLASS = 0
    private const val MODEL_ASSET = "bes_vision/efficientdet_lite0.tflite"

    // Loaded once per process (4.5 MB) and shared, read-only, by every
    // interpreter, instead of a new native allocation on every Start. Read
    // into a direct buffer rather than memory-mapped, so it works whether or
    // not the APK stores the asset compressed.
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
