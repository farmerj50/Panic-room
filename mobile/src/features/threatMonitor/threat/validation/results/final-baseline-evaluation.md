# Final AI behavior baseline — evaluation split (20 seeds per scenario)

Threshold fingerprint `3972f816`. Synthetic clips only: proves the logic, not real-world accuracy.
Rule-based detectors on pose and crowd motion — not a trained or validated action-recognition model.

## 1. Fighting and possible assault — DISABLED (not shown to users)

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| physical_confrontation | 0.00 (0/20) | — | 0/180 | 0.00 | 0.0 | — | — |
| assault | 0.20 (8/40) | 1.00 | 0/180 | 0.00 | 0.0 | 1.8 / 2.7 | 0.73 |

Look-alikes that raised this category: none.

## 2. Aggressive physical behavior vs ordinary gestures — DISABLED (not shown to users)

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| assault | 0.38 (15/40) | 1.00 | 0/120 | 0.00 | 0.0 | 1.8 / 2.5 | 1.00 |

Look-alikes that raised this category: none.

## 3. Normal interactions (hugging, dancing, greetings, sport, play-fighting) — DISABLED (not shown to users)

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| physical_confrontation | — (0/0) | — | 0/160 | 0.00 | 0.0 | — | — |
| assault | — (0/0) | — | 0/160 | 0.00 | 0.0 | — | — |

Look-alikes that raised this category: none.

## 4. Crowd panic vs race starts and celebrations — enabled in AI test builds

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| crowd_panic | 0.82 (33/40) | 0.45 | 40/160 | 0.25 | 75.8 | 2.8 / 3.0 | 0.45 |

Look-alikes that raised this category: race-start 16, sports-game 1, race-start-line 16, goal-celebration 7.

## 5. Sudden crowd dispersal — enabled in AI test builds

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| sudden_dispersal | 0.55 (22/40) | 1.00 | 0/120 | 0.00 | 0.0 | 2.6 / 2.9 | 1.00 |

Look-alikes that raised this category: none.

## 6. Crowd surges vs normal crowd movement — enabled in AI test builds

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| crowd_surge | 0.60 (24/40) | 0.92 | 2/120 | 0.02 | 5.1 | 2.7 / 3.5 | 0.92 |

Look-alikes that raised this category: venue-exit 2.

## 7. Falls vs sitting, bending and lying down — enabled in AI test builds

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| fall | 1.00 (40/40) | 0.77 | 12/120 | 0.10 | 50.0 | 2.4 / 2.8 | 0.77 |

Look-alikes that raised this category: flop-on-bed 12.
