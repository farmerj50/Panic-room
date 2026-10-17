import type { DetectorModel } from '../../../../modules/bes-vision';
import { detectTestImage, listTestImages } from './besVision';

const round = (v: number) => Math.round(v * 1000) / 1000;

// Validation only: scores images a tester pushed to the app's own
// bes-vision-test folder through the same on-device detector, for each
// candidate model. Runs at a low threshold so results can be scored offline at
// any threshold. Results go to the device log (logcat), never off the phone.
export async function runDetectionHarness(
  scoreThreshold = 0.2,
  models: DetectorModel[] = ['lite0', 'lite2'],
): Promise<number> {
  const names = await listTestImages();
  for (const model of models) {
    for (const name of names) {
      try {
        const r = await detectTestImage(name, scoreThreshold, 0, model);
        const boxes = r.detections.map((d) => [d.x, d.y, d.width, d.height, d.score].map(round));
        console.log(`[BesVisionHarness] ${JSON.stringify({ model, name, people: r.detections.length, inferenceMs: r.inferenceMs, boxes })}`);
      } catch (e) {
        console.log(`[BesVisionHarness] ${JSON.stringify({ model, name, error: e instanceof Error ? e.message : String(e) })}`);
      }
    }
  }
  // Rotation check on a subset: the camera-path rotation must give the same boxes.
  for (const name of names.slice(0, 20)) {
    for (const rotation of [90, 270]) {
      try {
        const r = await detectTestImage(name, scoreThreshold, rotation, models[models.length - 1]);
        const boxes = r.detections.map((d) => [d.x, d.y, d.width, d.height, d.score].map(round));
        console.log(`[BesVisionHarness] ${JSON.stringify({ model: models[models.length - 1], name, rotation, people: r.detections.length, boxes })}`);
      } catch (e) {
        console.log(`[BesVisionHarness] ${JSON.stringify({ name, rotation, error: e instanceof Error ? e.message : String(e) })}`);
      }
    }
  }
  console.log(`[BesVisionHarness] done ${names.length}`);
  return names.length;
}
