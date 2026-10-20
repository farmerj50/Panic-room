# Synthetic evaluation split — 640 clips (20 seeds per scenario)

Threshold fingerprint: `ec789a7e`. Synthetic data: proves the logic, not real-world accuracy.

## Multilabel event results
A type that genuinely occurs in the clip too (e.g. the victim of an assault falls) is counted as an overlapping event, not a false alarm.

| Category | Recall (TP/positives) | Precision | FP clips / negatives | FPR | False alarms | per hour | Overlapping | Latency median / p90 / max (s) |
|---|---|---|---|---|---|---|---|---|
| fall | 0.78 (31/40) | 1.00 | 0/580 | 0.00 | 0 | 0.0 | 14 | 2.4 / 2.8 / 3.1 |
| crowd_panic | 0.82 (33/40) | 0.57 | 25/560 | 0.04 | 25 | 17.4 | 28 | 2.8 / 3.0 / 3.2 |
| sudden_dispersal | 0.50 (20/40) | 1.00 | 0/580 | 0.00 | 0 | 0.0 | 0 | 2.6 / 3.0 / 3.1 |
| crowd_surge | 0.68 (27/40) | 0.93 | 2/600 | 0.00 | 2 | 1.3 | 0 | 2.5 / 3.5 / 3.6 |

## Strict category results
Any type other than the clip's own label counts as a false positive.

| Category | Recall (TP/positives) | Precision | FP clips / negatives | FPR | False alarms | per hour | Overlapping | Latency median / p90 / max (s) |
|---|---|---|---|---|---|---|---|---|
| fall | 0.78 (31/40) | 0.69 | 14/600 | 0.02 | 14 | 8.6 | 0 | 2.4 / 2.8 / 3.1 |
| crowd_panic | 0.82 (33/40) | 0.38 | 53/600 | 0.09 | 53 | 33.8 | 0 | 2.8 / 3.0 / 3.2 |
| sudden_dispersal | 0.50 (20/40) | 1.00 | 0/600 | 0.00 | 0 | 0.0 | 0 | 2.6 / 3.0 / 3.1 |
| crowd_surge | 0.68 (27/40) | 0.93 | 2/600 | 0.00 | 2 | 1.3 | 0 | 2.5 / 3.5 / 3.6 |

Fight / assault: disabled (0 raised).

Look-alike clips that raised anything: race-start 16, crosswalk-start 2, sports-game 1.

Missed events: dispersal-from-point 12, dispersal-cluster 8, surge-lurch 8, fall-forward 6, panic-scatter 5, surge-compress 5, fall-while-walking 3, panic-flee-one-way 2.
