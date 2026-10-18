# Bundled detector models

- Model: EfficientDet Lite0 V1 (TensorFlow Lite Model Maker, COCO, with
  TFLite_Detection_PostProcess), embedded metadata license: Apache License 2.0
- Source: https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/object_detection/android/lite-model_efficientdet_lite0_detection_metadata_1.tflite
- SHA-256: 2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b
- Bes uses only the `person` class (label index 0).

## efficientdet_lite2.tflite (candidate default)

- Model: EfficientDet Lite2 V1 (TensorFlow Lite Model Maker, COCO, 448 px,
  with TFLite_Detection_PostProcess), embedded metadata license: Apache License 2.0
- Source: https://storage.googleapis.com/download.tensorflow.org/models/tflite/task_library/object_detection/android/lite-model_efficientdet_lite2_detection_metadata_1.tflite
- SHA-256: 6fd32c84ab1eb0f7e7f3a7a20a20d7df1530daa8378728f7c79571096286bd52

Only one model should ship in a release; Lite0 is kept for side-by-side phone benchmarks.
