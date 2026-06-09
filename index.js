const sherpa_onnx = require('sherpa-onnx-node');
const fs = require('fs');
const path = require('path');
const say = require('say');
const { WaveFile } = require('wavefile');

// Input data
const lessonData = [
    { english: "I want to eat watermelon", chinese: "我想吃西瓜。" },
    { english: "I am eating watermelon", chinese: "我在吃西瓜。" },
    { english: "I ate watermelon", chinese: "我吃了西瓜。" },
    { english: "I will eat watermelon", chinese: "我要吃西瓜。" },
    { english: "Do you want to eat watermelon?", chinese: "你想吃西瓜吗？" },
    { english: "Are you eating watermelon?", chinese: "你在吃西瓜吗？" },
    { english: "What are you eating?", chinese: "你在吃什么？" },
    { english: "What did you eat?", chinese: "你吃了什么？" },
    { english: "I want to drink beer", chinese: "我想喝啤酒。" },
    { english: "I am drinking beer", chinese: "我在喝啤酒。" },
    { english: "I drank beer", chinese: "我喝了啤酒。" },
    { english: "I will drink beer", chinese: "我要喝啤酒。" },
    { english: "Do you want to drink beer?", chinese: "你想喝啤酒吗？" },
    { english: "Are you drinking beer?", chinese: "你在喝啤酒吗？" },
    { english: "What are you drinking?", chinese: "你在喝什么？" },
    { english: "What did you drink?", chinese: "你喝了什么？" },
    { english: "I write a letter", chinese: "我写信。" },
    { english: "You write a letter", chinese: "你写信。" },
    { english: "She writes a letter", chinese: "她写信。" },
    { english: "I study Chinese", chinese: "我学中文。" },
    { english: "I am studying Chinese", chinese: "我在学中文。" },
    { english: "I studied Chinese", chinese: "我学了中文。" }
];

// Output audio file
const OUTPUT_FILE = path.join(__dirname, 'output.wav');

// Use AI Chinese voice generation
const USE_AI_MODEL = true;

// Pauses
const PAUSE_AFTER_ENGLISH_MS = 400;
const PAUSE_AFTER_CHINESE_MS = 2800;

// Volume
const TARGET_VOLUME_PEAK = 0.80;
const ENGLISH_VOLUME_PEAK = 0.50;

// English voice settings
const ENGLISH_SPEED = 1.0;

// Non-AI Chinese voice settings
const CHINESE_VOICE = 'Tingting';
const CHINESE_SPEED = 0.85; // Slightly slower for better learning clear tones
const CHINESE_SAMPLE_RATE = 22050; // Standard OS text-to-speech output rate

// AI Chinese voice settings
const NOISE_SCALE = 0;
const NOISE_SCALE_W = 0;
const VOICE_ACTOR_ID = 160; // 0-173

let MODEL_SAMPLE_RATE = CHINESE_SAMPLE_RATE; // Default fallback

const ttsConfig = {
    model: {
        vits: {
            model: path.join(__dirname, 'model', 'model.onnx'),
            lexicon: path.join(__dirname, 'model', 'lexicon.txt'),
            tokens: path.join(__dirname, 'model', 'tokens.txt'),
            dataDir: "",
            noiseScale: NOISE_SCALE,
            noiseScaleW: NOISE_SCALE_W,
            lengthScale: 1.0
        },
        numThreads: 2,
        debug: 0,
        provider: "cpu"
    }
};

let tts = null;
if (USE_AI_MODEL) {
    // Only initialize the engine if we actually need it
    tts = new sherpa_onnx.OfflineTts(ttsConfig);
    console.log(`Detected AI Model Sample Rate: ${tts.sampleRate}Hz`);
    MODEL_SAMPLE_RATE = tts.sampleRate;
}

/**
 * Scans a 16-bit Int PCM buffer, detects its highest peak, and scales 
 * the entire track so it hits the precise target peak percentage.
 */
function normalizePCM(pcmBuffer, targetPeak = 0.80) {
    const totalSamples = pcmBuffer.length / 2; // 2 bytes per Int16 sample
    let maxPeak = 0;

    // Step 1: Find the absolute highest peak value in the audio array
    for (let i = 0; i < totalSamples; i++) {
        const val = Math.abs(pcmBuffer.readInt16LE(i * 2));
        if (val > maxPeak) maxPeak = val;
    }

    // Guard against pure silence files
    if (maxPeak === 0) return pcmBuffer;

    // Step 2: Calculate the scaling multiplier
    const maxInt16Value = 32767;
    const desiredPeakValue = maxInt16Value * targetPeak;
    const gainMultiplier = desiredPeakValue / maxPeak;

    // Step 3: Apply the uniform gain adjustment across the entire track
    for (let i = 0; i < totalSamples; i++) {
        const offset = i * 2;
        const currentSample = pcmBuffer.readInt16LE(offset);
        
        let scaledSample = Math.round(currentSample * gainMultiplier);
        
        // Prevent hard clipping artifacts
        scaledSample = Math.max(-(maxInt16Value + 1), Math.min(maxInt16Value, scaledSample));
        
        pcmBuffer.writeInt16LE(scaledSample, offset);
    }

    return pcmBuffer;
}

function generateEnglishPCM(text, targetSampleRate) {
    return new Promise((resolve, reject) => {
        const tempWav = path.join(__dirname, `temp_en_${Date.now()}.wav`);

        say.export(text, null, ENGLISH_SPEED, tempWav, (err) => {
            if (err) return reject(err);

            try {
                const wavBuffer = fs.readFileSync(tempWav);
                const wav = new WaveFile(wavBuffer);
                
                wav.toSampleRate(targetSampleRate);
                wav.toBitDepth('16');

                const pcmData = Buffer.from(wav.data.samples); 
                
                if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);

                // Normalization Step: Brings English volume down to your specific lower ceiling
                normalizePCM(pcmData, ENGLISH_VOLUME_PEAK);
                
                resolve(pcmData);
            } catch (processErr) {
                if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
                reject(processErr);
            }
        });
    });
}

function generateChinesePCM(text, targetSampleRate) {
    return new Promise((resolve, reject) => {
        const tempWav = path.join(__dirname, `temp_zh_${Date.now()}.wav`);

        // Export the Chinese text using the system voice
        say.export(text, CHINESE_VOICE, CHINESE_SPEED, tempWav, (err) => {
            if (err) return reject(err);

            try {
                const wavBuffer = fs.readFileSync(tempWav);
                const wav = new WaveFile(wavBuffer);
                
                // Resample the OS Chinese voice to match whatever rate you want your final master file to be
                wav.toSampleRate(targetSampleRate);
                wav.toBitDepth('16');

                const pcmData = Buffer.from(wav.data.samples); 
                
                if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);

                // Normalization Step
                normalizePCM(pcmData, TARGET_VOLUME_PEAK);
                
                resolve(pcmData);
            } catch (processErr) {
                if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);
                reject(processErr);
            }
        });
    });
}

function generateChinesePCMWithAI(text) {
    const audioSample = tts.generate({ text, sid: VOICE_ACTOR_ID, speed: CHINESE_SPEED });
    
    if (!audioSample || !audioSample.samples) {
        throw new Error(`Inference returned empty data for block: ${text}`);
    }

    const floatSamples = audioSample.samples;

    const pcmBuffer = Buffer.alloc(floatSamples.length * 2);
    for (let n = 0; n < floatSamples.length; n++) {
        let s = Math.max(-1.0, Math.min(1.0, floatSamples[n]));
        let intSample = s < 0 ? s * 0x8000 : s * 0x7FFF;
        pcmBuffer.writeInt16LE(intSample, n * 2);
    }

    // Normalization Step: Boosts Chinese volume up to match target ceiling
    normalizePCM(pcmBuffer, TARGET_VOLUME_PEAK);

    return pcmBuffer;
}

async function main() {
    try {
        console.log("Starting audio generation...");
        
        // Calculate the exact number of 16-bit mono bytes needed per millisecond
        // Formula: (Samples Per Sec * 2 Bytes Per Sample) / 1000 ms Per Sec
        const englishPauseSamples = Math.floor((MODEL_SAMPLE_RATE * PAUSE_AFTER_ENGLISH_MS) / 1000);
        const englishPauseBuffer = Buffer.alloc(englishPauseSamples * 2); 

        const chinesePauseSamples = Math.floor((MODEL_SAMPLE_RATE * PAUSE_AFTER_CHINESE_MS) / 1000);
        const chinesePauseBuffer = Buffer.alloc(chinesePauseSamples * 2); 

        const rawAudioPayloads = [];

        for (let i = 0; i < lessonData.length; i++) {
            const item = lessonData[i];
            console.log(`Processing item ${i + 1}/${lessonData.length}`);

            if (item.english && item.english.trim() !== "") {
                console.log(` 🗣️ English: "${item.english}"`);
                const enPcm = await generateEnglishPCM(item.english, MODEL_SAMPLE_RATE);
                rawAudioPayloads.push(enPcm);
                rawAudioPayloads.push(englishPauseBuffer);
            }

            if (item.chinese && item.chinese.trim() !== "") {
                console.log(` 🗣️ Chinese: "${item.chinese}"`);
                
                let zhPcm;
                if (USE_AI_MODEL) {
                    zhPcm = generateChinesePCMWithAI(item.chinese);
                } else {
                    zhPcm = await generateChinesePCM(item.chinese, MODEL_SAMPLE_RATE);
                }

                rawAudioPayloads.push(zhPcm);

                if (i < lessonData.length - 1) {
                    rawAudioPayloads.push(chinesePauseBuffer);
                }
            }
            console.log("");
        }

        console.log("Merging normalized audio streams...");
        const totalDataPayload = Buffer.concat(rawAudioPayloads);

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
        masterHeader.writeUInt16LE(1, 20); 
        masterHeader.writeUInt16LE(channels, 22);
        masterHeader.writeUInt32LE(MODEL_SAMPLE_RATE, 24);
        masterHeader.writeUInt32LE(byteRate, 28);
        masterHeader.writeUInt16LE(blockAlign, 32);
        masterHeader.writeUInt16LE(bitDepth, 34);
        masterHeader.write('data', 36);
        masterHeader.writeUInt32LE(totalDataPayload.length, 40);

        const finalWavFile = Buffer.concat([masterHeader, totalDataPayload]);
        
        fs.writeFileSync(OUTPUT_FILE, finalWavFile);
        console.log(`Audio saved to: ${OUTPUT_FILE}`);

    } catch (error) {
        console.error("Pipeline execution failed:", error);
    }
}

main();
