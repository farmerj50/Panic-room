# Synthetic validation split — 640 clips (20 seeds per scenario)

Threshold fingerprint: `ec789a7e`. Synthetic data: proves the logic, not real-world accuracy.

## Multilabel event results
A type that genuinely occurs in the clip too (e.g. the victim of an assault falls) is counted as an overlapping event, not a false alarm.

| Category | Recall (TP/positives) | Precision | FP clips / negatives | FPR | False alarms | per hour | Overlapping | Latency median / p90 / max (s) |
|---|---|---|---|---|---|---|---|---|
| fall | 0.75 (30/40) | 1.00 | 0/580 | 0.00 | 0 | 0.0 | 15 | 2.5 / 2.7 / 2.8 |
| crowd_panic | 0.75 (30/40) | 0.53 | 27/560 | 0.05 | 27 | 18.8 | 25 | 2.6 / 2.9 / 3.5 |
| sudden_dispersal | 0.50 (20/40) | 1.00 | 0/580 | 0.00 | 0 | 0.0 | 0 | 2.5 / 2.9 / 3.1 |
| crowd_surge | 0.78 (31/40) | 0.84 | 6/600 | 0.01 | 6 | 3.8 | 0 | 2.5 / 3.0 / 3.5 |

## Strict category results
Any type other than the clip's own label counts as a false positive.

| Category | Recall (TP/positives) | Precision | FP clips / negatives | FPR | False alarms | per hour | Overlapping | Latency median / p90 / max (s) |
|---|---|---|---|---|---|---|---|---|
| fall | 0.75 (30/40) | 0.67 | 15/600 | 0.03 | 15 | 9.2 | 0 | 2.5 / 2.7 / 2.8 |
| crowd_panic | 0.75 (30/40) | 0.37 | 52/600 | 0.09 | 52 | 33.2 | 0 | 2.6 / 2.9 / 3.5 |
| sudden_dispersal | 0.50 (20/40) | 1.00 | 0/600 | 0.00 | 0 | 0.0 | 0 | 2.5 / 2.9 / 3.1 |
| crowd_surge | 0.78 (31/40) | 0.84 | 6/600 | 0.01 | 6 | 3.8 | 0 | 2.5 / 3.0 / 3.5 |

Fight / assault: disabled (0 raised).

Look-alike clips that raised anything: race-start 16, crosswalk-start 4, sports-game 3.

Missed events: dispersal-from-point 15, fall-forward 7, panic-scatter 6, dispersal-cluster 5, surge-compress 5, panic-flee-one-way 4, surge-lurch 4, fall-while-walking 3.
