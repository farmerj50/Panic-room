import { detectTestImage, listTestImages } from './besVision';

// Validation only: scores images a tester pushed to the app's own
// bes-vision-test folder through the same on-device detector. Results go to
// the device log (logcat), never off the phone.
// Runs at a low threshold so results can be scored offline at any threshold.
export async function runDetectionHarness(scoreThreshold = 0.2): Promise<number> {
  const names = await listTestImages();
  for (const name of names) {
    try {
      const r = await detectTestImage(name, scoreThreshold);
      const boxes = r.detections.map((d) => [d.x, d.y, d.width, d.height, d.score].map((v) => Math.round(v * 1000) / 1000));
      console.log(`[BesVisionHarness] ${JSON.stringify({ name, people: r.detections.length, inferenceMs: r.inferenceMs, boxes })}`);
    } catch (e) {
      console.log(`[BesVisionHarness] ${JSON.stringify({ name, error: e instanceof Error ? e.message : String(e) })}`);
    }
  }
  // Rotation check on a subset: the camera-path rotation must give the same boxes.
  for (const name of names.slice(0, 20)) {
    for (const rotation of [90, 270]) {
      try {
        const r = await detectTestImage(name, scoreThreshold, rotation);
        const boxes = r.detections.map((d) => [d.x, d.y, d.width, d.height, d.score].map((v) => Math.round(v * 1000) / 1000));
        console.log(`[BesVisionHarness] ${JSON.stringify({ name, rotation, people: r.detections.length, frame: [r.frameWidth, r.frameHeight], boxes })}`);
      } catch (e) {
        console.log(`[BesVisionHarness] ${JSON.stringify({ name, rotation, error: e instanceof Error ? e.message : String(e) })}`);
      }
    }
  }
  console.log(`[BesVisionHarness] done ${names.length}`);
  return names.length;
}
