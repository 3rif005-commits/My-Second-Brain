"""Model-free speaker labels (ArtCraft study item 15). Synthetic voices, like filmcraft's
diarize tests: a pulse train at a pitch through two formant resonances."""
import pytest

np = pytest.importorskip("numpy")
if type(np).__name__ == "MagicMock":
    pytest.skip("numpy is a stub in this venv", allow_module_level=True)

from services.workspace.speakers import (  # noqa: E402
    SAMPLE_RATE, label_speakers_from_audio, with_speakers,
)


def voice(f0, formants, secs, seed):
    sr = SAMPLE_RATE
    t = np.arange(int(secs * sr)) / sr
    rng = np.random.default_rng(seed)
    sig = np.zeros_like(t)
    for h in range(1, int(3800 / f0)):
        f = f0 * h
        gain = sum(np.exp(-((f - fc) ** 2) / (2 * bw ** 2)) for fc, bw in formants)
        sig += gain * np.sin(2 * np.pi * f * t + rng.uniform(0, 6.28))
    envelope = 0.6 + 0.4 * np.sin(2 * np.pi * 3.0 * t) ** 2     # syllables
    return (sig * envelope / (np.abs(sig).max() + 1e-9)).astype(np.float32) * 0.5


A = dict(f0=110, formants=[(500, 120), (1500, 200)])
B = dict(f0=230, formants=[(800, 150), (2400, 250)])


def track(order, secs=3.0):
    audio, snippets, t = [], [], 0.0
    for i, who in enumerate(order):
        audio.append(voice(**(A if who == "A" else B), secs=secs, seed=i))
        snippets.append({"start": t, "duration": secs, "text": f"line {i}"})
        t += secs
    return np.concatenate(audio), snippets


def test_two_voices_are_told_apart():
    audio, snippets = track(["A", "B", "A", "B", "A", "B"])
    assert label_speakers_from_audio(audio, SAMPLE_RATE, snippets) == [0, 1, 0, 1, 0, 1]


def test_one_voice_gets_no_labels():
    audio, snippets = track(["A"] * 6)
    assert label_speakers_from_audio(audio, SAMPLE_RATE, snippets) is None


def test_too_little_speech_gets_no_labels():
    audio, snippets = track(["A", "B"])
    assert label_speakers_from_audio(audio, SAMPLE_RATE, snippets) is None


def test_with_speakers_marks_only_changes():
    snips = [{"text": "a"}, {"text": "b"}, {"text": "c"}]
    assert [s["text"] for s in with_speakers(snips, [0, 0, 1])] == ["Speaker 1: a", "b", "Speaker 2: c"]
    assert with_speakers(snips, None) is snips
    assert with_speakers(snips, [0]) is snips
