### Fixes

- **Security alerts, narration voice lock:** pillow 13, transformers 5.10, diffusers 0.38, filelock 4.2.1,
  certifi, safetensors 0.8 and setuptools 81 in `requirements-voice.lock.txt`. Checked with a fresh
  environment, the narration tests and a real GPU render of the welcome script.
