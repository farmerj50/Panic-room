import type { BoundingBox } from '../models/types';

export type ViewRect = { left: number; top: number; width: number; height: number };

// Maps a box normalized to the upright camera frame onto the preview view.
// The native preview uses FILL_CENTER (scale to cover, crop the overflow
// equally on both sides), and the front camera preview is mirrored, so the
// box is mirrored too. Boxes partly in the cropped area are clipped; boxes
// entirely outside it return null.
export function mapBoxToView(
  box: BoundingBox,
  frame: { width: number; height: number },
  view: { width: number; height: number },
  options: { mirrored?: boolean } = {},
): ViewRect | null {
  if (frame.width <= 0 || frame.height <= 0 || view.width <= 0 || view.height <= 0) return null;
  const scale = Math.max(view.width / frame.width, view.height / frame.height);
  const shownW = frame.width * scale;
  const shownH = frame.height * scale;
  const offsetX = (view.width - shownW) / 2;
  const offsetY = (view.height - shownH) / 2;

  const x = options.mirrored ? 1 - box.x - box.width : box.x;
  let left = offsetX + x * shownW;
  let top = offsetY + box.y * shownH;
  let right = left + box.width * shownW;
  let bottom = top + box.height * shownH;

  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(view.width, right);
  bottom = Math.min(view.height, bottom);
  if (right <= left || bottom <= top) return null;
  return { left, top, width: right - left, height: bottom - top };
}
