# AI threat recognition — data policy and evaluation registry

Applies to all data used to develop, tune or evaluate Bes threat recognition
(fights/assaults, falls, crowd panic, dispersal, surges).

## Rules

1. **No research-only or non-commercial data** may be downloaded, trained on,
   tuned against or incorporated into Bes without verified written
   authorization. This includes (non-exhaustive) RWF-2000, Hockey Fights,
   UCF-Crime, UR Fall Detection, Le2i, UMN, and COCO images under
   non-commercial Flickr licenses.
2. Every dataset and clip is registered in `manifest.json` (see schema below)
   with its **license, provenance, consent status and permitted uses** before
   it is used for anything.
3. Splits are fixed and never mixed:
   - `train` — may be used to fit or tune anything (thresholds, models).
   - `validation` — used to choose between options during development.
   - `evaluation` — held back; only used for reported numbers. Nothing is ever
     tuned on it. Results on `evaluation` are the only ones quoted as accuracy.
4. Each threat category must be measured separately, and every split must
   include **non-threatening look-alikes**: dancing, sports, hugging, play
   fighting, high-fives, running, sitting/lying down on purpose, bending to pick
   something up, busy and crowded public events.
5. Synthetic data proves the logic works; it is **never** evidence of
   real-world accuracy. Reports must say which split and which data kind
   (synthetic / consented / licensed) each number comes from.

## Data currently in use

| Dataset | Kind | License / authorization | Provenance | Permitted uses | Splits |
|---|---|---|---|---|---|
| `synthetic-pose-v1` | Synthetic skeleton + track sequences generated in code (`syntheticPoses.ts`) | Bes-owned (generated) | This repository | train, validation, evaluation (logic only) | seeds 1–99 train, 100–199 validation, 200–299 evaluation |

No real-world clips are registered yet.

## Previously used, now withdrawn

- **COCO 2017 val (120-image person sample)** — used in Phase 1 only to
  estimate person-detector recall. Images carry mixed Flickr licenses, some
  non-commercial; withdrawn under rule 1 and local copies deleted
  (2026-10-17). The Phase 1 recall figures must be re-measured on authorized
  data before any release decision.

## Models (not data, listed for completeness)

| Model | License | Source | SHA-256 |
|---|---|---|---|
| EfficientDet-Lite0 / Lite2 (person detection) | Apache-2.0 (embedded metadata) | TensorFlow Lite Model Maker | see `modules/bes-vision/MODEL_LICENSE.md` |
| MoveNet MultiPose Lightning, float16 (pose) | Apache-2.0 (TensorFlow MoveNet / tfjs-models) — confirm on the Kaggle model card before release | kaggle.com/models/google/movenet (multipose-lightning-tflite-float16 v1) | d4489f89e6bd6777a8b9a1a16189832131f84ff90d82fae729e670b84d7948dd |

## Manifest schema (`manifest.json`)

```json
{
  "clips": [
    {
      "id": "consented-2026-11-001",
      "kind": "synthetic | consented | licensed",
      "license": "e.g. Bes-owned, consent form v2 / vendor license #",
      "provenance": "who recorded or supplied it, when, where",
      "consent": "all visible people consented (form ref) | n/a",
      "permittedUses": ["train", "validation", "evaluation"],
      "split": "train | validation | evaluation",
      "file": "relative path on the evaluation machine (never committed)",
      "labels": [
        { "category": "physical_confrontation | assault | fall | crowd_panic | sudden_dispersal | crowd_surge | none",
          "startSec": 3.2, "endSec": 7.9,
          "activity": "e.g. staged punch, dancing, hugging, basketball" }
      ]
    }
  ]
}
```

Video files themselves are never committed to the repository.
