const sherpa_onnx = require('sherpa-onnx-node');
const fs = require('fs');
const path = require('path');
const say = require('say');
const { WaveFile } = require('wavefile');

// Input data
const lessonData = [
    { english: "The ice cream is 13 Yuan.", chinese: "冰激凌十三元。" },
    { english: "How much does this cost?", chinese: "这个多少钱？" },
    { english: "Is this fourteen or forty?", chinese: "这是十四还是四十？" },
    { english: "Five hundred Yuan.", chinese: "五百元。" },
    { english: "Ten thousand Yuan.", chinese: "一万元。" },
    { english: "I am playing on the computer.", chinese: "我在玩电脑。" },
    { english: "She is watching a movie.", chinese: "她在看电影。" },
    { english: "What is mom listening to?", chinese: "妈妈在听什么？" },
    { english: "I don't eat this.", chinese: "我不吃这个。" },
    { english: "She is drinking beer.", chinese: "她在喝啤酒。" },
    { english: "I am at home.", chinese: "我在家。" },
    { english: "He is not at school.", chinese: "他不在学校。" },
    { english: "Where are you? I am at school.", chinese: "你在哪里？我在学校。" },
    { english: "It's cold here, but over there is very happy.", chinese: "这里很冷，那里很高兴。" },
    { english: "Which movie do you like?", chinese: "你喜欢哪个电影？" },
    { english: "This is my computer.", chinese: "这是我的电脑。" },
    { english: "Is that your car?", chinese: "那是你的车吗？" },
    { english: "Is that your dad's car? No, it's my mom's.", chinese: "那是你爸爸的车吗？不，是我妈妈的。" }
];

// Output audio file
const OUTPUT_FILE = path.join(__dirname, 'output.wav');

// Pauses
const SHORT_PAUSE_MS = 600;
const LONG_PAUSE_MS = 3400;

// Volume
const TARGET_VOLUME_PEAK = 0.80;
const ENGLISH_VOLUME_PEAK = 0.50;

// English voice settings
const ENGLISH_SPEED = 0.7;

// Chinese voice settings
const CHINESE_SAMPLE_RATE = 22050;
const CHINESE_SPEED = 0.5;
const CHINESE_SPEED_AI = 1.0;
const CHINESE_LENGTH_SCALE = 1.1; // Higher values produce a slower output, for better learning clear tones
const NOISE_SCALE = 0.0;
const NOISE_SCALE_W = 0.0;

const ttsConfig = {
    model: {
        vits: {
            model: path.join(__dirname, 'model', 'model.onnx'),
            lexicon: path.join(__dirname, 'model', 'lexicon.txt'),
            tokens: path.join(__dirname, 'model', 'tokens.txt'),
            dataDir: "",
            noiseScale: NOISE_SCALE,
            noiseScaleW: NOISE_SCALE_W,
            lengthScale: CHINESE_LENGTH_SCALE,
        },
        numThreads: 2,
        debug: 0,
        provider: "cpu"
    }
};

const tts = new sherpa_onnx.OfflineTts(ttsConfig);
console.log(`Detected AI Model Sample Rate: ${tts.sampleRate}Hz`);
const MODEL_SAMPLE_RATE = tts.sampleRate || CHINESE_SAMPLE_RATE;

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

                // Normalization: brings English volume down to a specific lower ceiling
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
        say.export(text, 'Tingting', CHINESE_SPEED, tempWav, (err) => {
            if (err) return reject(err);

            try {
                const wavBuffer = fs.readFileSync(tempWav);
                const wav = new WaveFile(wavBuffer);
                
                // Resample the OS Chinese voice to match the rate of the final master file
                wav.toSampleRate(targetSampleRate);
                wav.toBitDepth('16');

                const pcmData = Buffer.from(wav.data.samples); 
                
                if (fs.existsSync(tempWav)) fs.unlinkSync(tempWav);

                // Normalization
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
    // Voice actor.
    const sid = Math.floor(Math.random() * tts.numSpeakers);

    const audioSample = tts.generate({ text, sid, speed: CHINESE_SPEED_AI });
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

    // Normalization
    normalizePCM(pcmBuffer, TARGET_VOLUME_PEAK);

    return pcmBuffer;
}

async function main() {
    try {
        console.log("Starting audio generation...");
        
        // Calculate the exact number of 16-bit mono bytes needed per millisecond
        // Formula: (samples per sec * 2 bytes per sample) / 1000ms per sec
        const shortPauseSamples = Math.floor((MODEL_SAMPLE_RATE * SHORT_PAUSE_MS) / 1000);
        const shortPauseBuffer = Buffer.alloc(shortPauseSamples * 2);

        const longPauseSamples = Math.floor((MODEL_SAMPLE_RATE * LONG_PAUSE_MS) / 1000);
        const longPauseBuffer = Buffer.alloc(longPauseSamples * 2);

        const zhAiTranslations = 2;
        const rawAudioPayloads = [];

        for (let i = 0; i < lessonData.length; i++) {
            const item = lessonData[i];
            console.log(`Processing item ${i + 1}/${lessonData.length}`);

            if (item.english && item.english.trim() !== "") {
                console.log(` 🗣️ English: "${item.english}"`);
                const enPcm = await generateEnglishPCM(item.english, MODEL_SAMPLE_RATE);
                rawAudioPayloads.push(enPcm);
                rawAudioPayloads.push(shortPauseBuffer);
            }

            if (item.chinese && item.chinese.trim() !== "") {
                console.log(` 🗣️ Chinese: "${item.chinese}"`);

                // Generate OS TTS
                let zhPcm = await generateChinesePCM(item.chinese, MODEL_SAMPLE_RATE);
                rawAudioPayloads.push(zhPcm);
                rawAudioPayloads.push(shortPauseBuffer);

                for (let i = 1; i <= zhAiTranslations; i++) {
                    // Also generate more synthesis with AI to have extra, more realistic, references
                    zhPcm = generateChinesePCMWithAI(item.chinese);
                    rawAudioPayloads.push(zhPcm);
                    rawAudioPayloads.push(i === zhAiTranslations ? longPauseBuffer : shortPauseBuffer);
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
