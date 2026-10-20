import { mapBoxToView } from '../services/overlayGeometry';

const portraitFrame = { width: 480, height: 640 }; // 3:4 upright analysis frame

describe('mapBoxToView', () => {
  it('maps directly when the view has the frame aspect ratio', () => {
    const r = mapBoxToView({ x: 0.25, y: 0.5, width: 0.5, height: 0.25 }, portraitFrame, { width: 300, height: 400 });
    expect(r).toEqual({ left: 75, top: 200, width: 150, height: 100 });
  });

  it('accounts for FILL_CENTER cropping on a taller view (sides cropped)', () => {
    // View 300x600: scale = max(300/480, 600/640)=0.9375 → shown 450x600, 75px cropped each side.
    const r = mapBoxToView({ x: 0.5, y: 0, width: 0.1, height: 0.5 }, portraitFrame, { width: 300, height: 600 })!;
    expect(r.left).toBeCloseTo(150);
    expect(r.width).toBeCloseTo(45);
    expect(r.top).toBeCloseTo(0);
    expect(r.height).toBeCloseTo(300);
  });

  it('accounts for FILL_CENTER cropping on a wider view (top/bottom cropped)', () => {
    // Landscape frame 640x480 in a 400x200 view: scale = 0.625 → 400x300, 50px cropped top and bottom.
    const r = mapBoxToView({ x: 0, y: 0.5, width: 0.5, height: 0.25 }, { width: 640, height: 480 }, { width: 400, height: 200 })!;
    expect(r.top).toBeCloseTo(100);
    expect(r.height).toBeCloseTo(75);
    expect(r.left).toBeCloseTo(0);
    expect(r.width).toBeCloseTo(200);
  });

  it('mirrors boxes for the front camera', () => {
    const box = { x: 0.1, y: 0.1, width: 0.2, height: 0.2 };
    const view = { width: 300, height: 400 };
    expect(mapBoxToView(box, portraitFrame, view, { mirrored: true })!.left).toBeCloseTo(210);
    expect(mapBoxToView(box, portraitFrame, view)!.left).toBeCloseTo(30);
  });

  it('clips boxes partly in the cropped area and drops boxes entirely in it', () => {
    const view = { width: 300, height: 600 }; // 75px cropped on each side
    const partly = mapBoxToView({ x: 0.1, y: 0.2, width: 0.2, height: 0.2 }, portraitFrame, view)!;
    expect(partly.left).toBe(0);
    expect(partly.width).toBeCloseTo(60); // spans -30..60px
    expect(mapBoxToView({ x: 0, y: 0.2, width: 0.1, height: 0.2 }, portraitFrame, view)).toBeNull();
  });

  it('returns null before layout', () => {
    expect(mapBoxToView({ x: 0, y: 0, width: 1, height: 1 }, portraitFrame, { width: 0, height: 0 })).toBeNull();
  });
});
