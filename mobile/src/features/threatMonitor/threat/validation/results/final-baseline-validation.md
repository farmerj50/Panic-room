# Final AI behavior baseline — validation split (20 seeds per scenario)

Threshold fingerprint `3972f816`. Synthetic clips only: proves the logic, not real-world accuracy.
Rule-based detectors on pose and crowd motion — not a trained or validated action-recognition model.

## 1. Fighting and possible assault — DISABLED (not shown to users)

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| physical_confrontation | 0.00 (0/20) | — | 0/180 | 0.00 | 0.0 | — | — |
| assault | 0.28 (11/40) | 1.00 | 0/180 | 0.00 | 0.0 | 2.3 / 2.4 | 0.73 |

Look-alikes that raised this category: none.

## 2. Aggressive physical behavior vs ordinary gestures — DISABLED (not shown to users)

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| assault | 0.42 (17/40) | 1.00 | 0/120 | 0.00 | 0.0 | 1.8 / 2.4 | 1.00 |

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
| crowd_panic | 0.75 (30/40) | 0.42 | 42/160 | 0.26 | 79.6 | 2.6 / 2.9 | 0.42 |

Look-alikes that raised this category: race-start 16, sports-game 3, race-start-line 15, goal-celebration 8.

## 5. Sudden crowd dispersal — enabled in AI test builds

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| sudden_dispersal | 0.50 (20/40) | 1.00 | 0/120 | 0.00 | 0.0 | 2.5 / 2.9 | 1.00 |

Look-alikes that raised this category: none.

## 6. Crowd surges vs normal crowd movement — enabled in AI test builds

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| crowd_surge | 0.78 (31/40) | 0.89 | 4/120 | 0.03 | 10.1 | 2.5 / 3.3 | 0.89 |

Look-alikes that raised this category: crosswalk-start 1, venue-exit 3.

## 7. Falls vs sitting, bending and lying down — enabled in AI test builds

| Type | Recall (TP/positives) | Precision | False-positive clips / negatives | FPR | False alarms per hour | Latency median / p90 (s) | Strict precision |
|---|---|---|---|---|---|---|---|
| fall | 1.00 (40/40) | 0.85 | 7/120 | 0.06 | 29.2 | 2.4 / 2.7 | 0.85 |

Look-alikes that raised this category: flop-on-bed 7.
