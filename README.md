# Chinese learning

This is a tool to generate audio files of sentences in English and their translation in Chinese. I use it as part of my personal method to learn new languages.

The speech synthesis uses [this model](https://huggingface.co/csukuangfj/vits-zh-aishell3) from Hugging Face to prevent the sentences from sounding too robotic.

### Prerequisites

This repository uses **Git Large File Storage (LFS)** to handle the local AI voice models (`models/model.onnx`). 

Before cloning this repository, you must have Git LFS installed on your machine. Otherwise, the model files will not download correctly, and the script will fail.

### Installation & Setup

1. Install Git LFS:
   ```bash
   brew install git-lfs
   ```
2. Set up Git LFS globally on your system:
   ```bash
   git lfs install
   ```
3. Clone this repository
4. Install dependencies with `pnpm i` (or `npm i` if you don't have pnpm)
5. Edit the sentences and the parameters in index.js
6. Run the script to generate the audio file:
   ```bash
   node index.js
   ```
