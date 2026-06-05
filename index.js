const sherpa_onnx = require('sherpa-onnx-node');
const fs = require('fs');
const path = require('path');

const chineseTexts = [
    "你叫什么名字？",
    "你今年多大？",
    "你饿了吗？",
    "我可以要一瓶水吗？",
];

const OUTPUT_FILE = path.join(__dirname, 'output.wav'); // output filename.
const PAUSE_DURATION_SECONDS = 3; // seconds between samples.

const ttsConfig = {
    model: {
        vits: {
        	// model is https://huggingface.co/csukuangfj/vits-zh-aishell3
            model: path.join(__dirname, 'model', 'model.onnx'),
            lexicon: path.join(__dirname, 'model', 'lexicon.txt'),
            tokens: path.join(__dirname, 'model', 'tokens.txt'),
            dataDir: "",
            noiseScale: 0.667,
            noiseScaleW: 0.7, // decrease for more robotic voice.
            lengthScale: 1.2, // increase for slower samples.
        },
        numThreads: 2,
        debug: 0,
        provider: "cpu"
    }
};

const tts = new sherpa_onnx.OfflineTts(ttsConfig);
const MODEL_SAMPLE_RATE = tts.sampleRate;
console.log(`AI Model Sample Rate: ${MODEL_SAMPLE_RATE}Hz`);

/**
 * Applies a smooth digital fade-in and fade-out to a Float32 array 
 * to prevent abrupt wave snapping (clicking/popping sounds).
 */
function applyFadingEffects(samples, sampleRate) {
    const fadeDurationSec = 0.05; // 50ms fade
    const fadeSamples = Math.min(Math.floor(sampleRate * fadeDurationSec), Math.floor(samples.length / 2));

    // 1. Smooth Fade-In at the start
    for (let i = 0; i < fadeSamples; i++) {
        const gain = i / fadeSamples;
        samples[i] = samples[i] * gain;
    }

    // 2. Smooth Fade-Out at the very end
    const totalSamples = samples.length;
    for (let i = 0; i < fadeSamples; i++) {
        const gain = 1.0 - (i / fadeSamples);
        const index = totalSamples - fadeSamples + i;
        samples[index] = samples[index] * gain;
    }
}

async function main() {
    try {
        console.log("Initializing local ONNX Speech Synthesizer...");
        
        // DYNAMIC SILENCE GENERATION: 
        // Create an absolute zero-amplitude buffer matching the exact requirements of the stream
        // Formula: SampleRate * Channels (1) * BytesPerSample (2 bytes for 16-bit Int)
        const bytesPerSecond = MODEL_SAMPLE_RATE * 1 * 2;
        const pureSilenceBuffer = Buffer.alloc(bytesPerSecond * PAUSE_DURATION_SECONDS); 
        // Buffer.alloc fills the memory natively with pure 0x00 bytes, guaranteeing zero DC Offset.

        const rawAudioPayloads = [];

        for (let i = 0; i < chineseTexts.length; i++) {
            console.log(`Synthesizing: "${chineseTexts[i]}"`);
            
            const audioSample = tts.generate({
                text: chineseTexts[i],
                sid: 8,
                speed: 1,
            });
            
            if (!audioSample || !audioSample.samples) {
                console.error(`Inference returned empty data for block: ${chineseTexts[i]}`);
                continue;
            }

            const floatSamples = audioSample.samples;

            // Smooth the raw wave edges
            applyFadingEffects(floatSamples, MODEL_SAMPLE_RATE);

            // Convert Float32 array to 16-bit signed Int PCM data
            const pcmBuffer = Buffer.alloc(floatSamples.length * 2);
            for (let n = 0; n < floatSamples.length; n++) {
                let s = Math.max(-1.0, Math.min(1.0, floatSamples[n]));
                let intSample = s < 0 ? s * 0x8000 : s * 0x7FFF;
                pcmBuffer.writeInt16LE(intSample, n * 2);
            }

            rawAudioPayloads.push(pcmBuffer);

            // Inject our mathematically verified silence buffer between speech clips
            if (i < chineseTexts.length - 1) {
                rawAudioPayloads.push(pureSilenceBuffer);
            }
        }

        console.log("Merging local raw audio blocks...");
        const totalDataPayload = Buffer.concat(rawAudioPayloads);

        // Standard 44-byte WAV Header Creator
        const masterHeader = Buffer.alloc(44);
        const channels = 1;
        const bitDepth = 16;
        const byteRate = (MODEL_SAMPLE_RATE * channels * bitDepth) / 8;
        const blockAlign = (channels * bitDepth) / 8;

        masterHeader.write('RIFF', 0);
        masterHeader.writeUInt32LE(totalDataPayload.length + 36, 4);
        masterHeader.write('WAVE', 8);
        masterHeader.write('fmt ', 12);
        masterHeader.writeUInt32LE(16, 16);
        masterHeader.writeUInt16LE(1, 20); // 1 = Uncompressed PCM data
        masterHeader.writeUInt16LE(channels, 22);
        masterHeader.writeUInt32LE(MODEL_SAMPLE_RATE, 24);
        masterHeader.writeUInt32LE(byteRate, 28);
        masterHeader.writeUInt16LE(blockAlign, 32);
        masterHeader.writeUInt16LE(bitDepth, 34);
        masterHeader.write('data', 36);
        masterHeader.writeUInt32LE(totalDataPayload.length, 40);

        const finalWavFile = Buffer.concat([masterHeader, totalDataPayload]);
        
        fs.writeFileSync(OUTPUT_FILE, finalWavFile);
        console.log(`\nSuccess! Saved to:\n${OUTPUT_FILE}`);

    } catch (error) {
        console.error("Execution failed:", error);
    }
}

main();