# Synthetic evaluation split — 920 clips (20 seeds per scenario)

Threshold fingerprint: `3972f816`. Synthetic data: proves the logic, not real-world accuracy.

## Multilabel event results
A type that genuinely occurs in the clip too (e.g. the victim of an assault falls) is counted as an overlapping event, not a false alarm.

| Category | Recall (TP/positives) | Precision | FP clips / negatives | FPR | False alarms | per hour | Overlapping | Latency median / p90 / max (s) |
|---|---|---|---|---|---|---|---|---|
| fall | 1.00 (40/40) | 0.77 | 12/860 | 0.01 | 12 | 5.4 | 20 | 2.4 / 2.8 / 3.1 |
| crowd_panic | 0.82 (33/40) | 0.38 | 53/840 | 0.06 | 53 | 25.8 | 28 | 2.8 / 3.0 / 3.2 |
| sudden_dispersal | 0.55 (22/40) | 1.00 | 0/860 | 0.00 | 0 | 0.0 | 0 | 2.6 / 2.9 / 3.1 |
| crowd_surge | 0.60 (24/40) | 0.86 | 4/880 | 0.00 | 4 | 1.8 | 0 | 2.7 / 3.5 / 3.6 |

## Strict category results
Any type other than the clip's own label counts as a false positive.

| Category | Recall (TP/positives) | Precision | FP clips / negatives | FPR | False alarms | per hour | Overlapping | Latency median / p90 / max (s) |
|---|---|---|---|---|---|---|---|---|
| fall | 1.00 (40/40) | 0.56 | 32/880 | 0.04 | 32 | 14.2 | 0 | 2.4 / 2.8 / 3.1 |
| crowd_panic | 0.82 (33/40) | 0.29 | 81/880 | 0.09 | 81 | 37.0 | 0 | 2.8 / 3.0 / 3.2 |
| sudden_dispersal | 0.55 (22/40) | 1.00 | 0/880 | 0.00 | 0 | 0.0 | 0 | 2.6 / 2.9 / 3.1 |
| crowd_surge | 0.60 (24/40) | 0.86 | 4/880 | 0.00 | 4 | 1.8 | 0 | 2.7 / 3.5 / 3.6 |

Fight / assault: disabled (0 raised).

Look-alike clips that raised anything: race-start 16, race-start-line 16, flop-on-bed 12, goal-celebration 7, venue-exit 5, sports-game 1, queue-shuffle 1.

Missed events: dispersal-from-point 11, surge-lurch 8, surge-compress 8, dispersal-cluster 7, panic-scatter 5, panic-flee-one-way 2.
