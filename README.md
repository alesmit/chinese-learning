# Chinese learning

This is a tool to generate audio files of sentences in Chinese. I use it as part of my personal method to learn new languages.

The speech synthesis uses [this model](https://huggingface.co/csukuangfj/vits-zh-aishell3) from Hugging Face to prevent the sentences from sounding too robotic.

### Setup

It requires node. Clone the repo, edit the list of sentences in the index.js file, then install dependencies with `pnpm i` and run `node index.js` to generate the output file.

### Roadmap

In the future, it would be nice to handle two languages so that the translations will also be included in the audio file. Now, I just don't have time for this.
