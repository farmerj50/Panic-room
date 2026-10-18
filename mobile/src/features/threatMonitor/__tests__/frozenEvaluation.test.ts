import fs from 'fs';
import path from 'path';

import { evaluate } from '../threat/validation/evaluate';
import { FROZEN_FINGERPRINT, reportMarkdown, thresholdFingerprint } from '../threat/validation/frozen';
import { SCENARIOS } from '../threat/validation/scenarios';

describe('frozen thresholds', () => {
  it('match the thresholds the recorded evaluation results were produced with', () => {
    // If this fails, a threshold changed: the recorded evaluation-split
    // results no longer apply. Tune on train, check validation, then re-run
    // the evaluation split once (RUN_FROZEN_EVAL=1) and update the fingerprint.
    expect(thresholdFingerprint()).toBe(FROZEN_FINGERPRINT);
  });
});

// The full offline pipeline (minutes): RUN_FROZEN_EVAL=1 EVAL_SPLIT=validation|evaluation.
const run = process.env.RUN_FROZEN_EVAL === '1' ? describe : describe.skip;
run('frozen offline evaluation', () => {
  it('runs the split and writes the report', () => {
    const split = (process.env.EVAL_SPLIT ?? 'validation') as 'validation' | 'evaluation';
    const seeds = Number(process.env.EVAL_SEEDS ?? 20);
    const report = evaluate(SCENARIOS, split, seeds);
    const dir = path.join(__dirname, '..', 'threat', 'validation', 'results');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${split}.md`), reportMarkdown(report, seeds));
    expect(report.clips).toBe(SCENARIOS.length * seeds);
  }, 1_800_000);
});
