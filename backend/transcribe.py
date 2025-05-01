import sys
import librosa
import numpy as np
from transformers import WhisperForConditionalGeneration, WhisperProcessor
import torch

# Ensure stdout uses UTF-8 encoding to handle Arabic text
sys.stdout.reconfigure(encoding='utf-8')

# Check if GPU is available
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
print(f"Using device: {device}", file=sys.stderr)

# Load the processor and model
processor = WhisperProcessor.from_pretrained("RawandLaouini/whisper-ar")
model = WhisperForConditionalGeneration.from_pretrained("RawandLaouini/whisper-ar").to(device)

# Fix generation config (remove forced_decoder_ids since language="ar" handles it)
model.generation_config.forced_decoder_ids = None
model.generation_config.language = "ar"

def transcribe_audio(audio_path):
    try:
        # Load and validate audio
        audio, sr = librosa.load(audio_path, sr=16000)
        if len(audio) < 16000:
            raise ValueError("Audio file is too short")

        # Pad if necessary (for chunks less than 30 seconds)
        if len(audio) < 30 * 16000:
            audio = np.pad(audio, (0, 30 * 16000 - len(audio)), mode="constant")

        # Process audio
        inputs = processor(audio, sampling_rate=16000, return_tensors="pt")
        input_features = inputs.input_features.to(device)
        attention_mask = torch.ones(input_features.shape, dtype=torch.long).to(device)

        # Transcribe
        with torch.no_grad():
            predicted_ids = model.generate(
                input_features,
                attention_mask=attention_mask,
                language="ar",
                num_beams=5,
                max_length=448,
            )
        transcribed_text = processor.batch_decode(predicted_ids, skip_special_tokens=True)[0]
        return transcribed_text.strip()
    except Exception as e:
        print(f"Error: {str(e)}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python transcribe.py <audio_path>", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    transcription = transcribe_audio(audio_path)
    print(transcription)