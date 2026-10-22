"""Speaker labels for an uploaded video's transcript, without a model (ArtCraft study item 15).

After filmcraft's diarize.rs: each transcript segment gets a voice fingerprint (the mean and
spread of its MFCCs — log-mel energies through a DCT, loudness coefficient dropped), the
segments are clustered, and labels are written only when the clustering is clearly better
than "one speaker". A wrong "Speaker 2" makes a note worse than no label, so every doubt
means no labels. Needs numpy and ffmpeg; without them it quietly does nothing.
"""
from __future__ import annotations

import logging
import subprocess

logger = logging.getLogger(__name__)

SAMPLE_RATE = 8000
MAX_SECONDS = 60 * 60   # ~170 MB of samples at peak; the 4 GB laptop also holds Whisper
MIN_SEGMENT_SECONDS = 1.0
MIN_SILHOUETTE = 0.25
MIN_SHARE = 0.12          # every speaker must have at least this share of the speech
MAX_SPEAKERS = 4


def _mel_filters(np, n_fft: int, sr: int, n_mels: int = 20):
    def hz_to_mel(f): return 2595 * np.log10(1 + f / 700)
    def mel_to_hz(m): return 700 * (10 ** (m / 2595) - 1)
    mels = np.linspace(hz_to_mel(60), hz_to_mel(sr / 2), n_mels + 2)
    bins = np.floor((n_fft + 1) * mel_to_hz(mels) / sr).astype(int)
    fb = np.zeros((n_mels, n_fft // 2 + 1))
    for i in range(1, n_mels + 1):
        lo, mid, hi = bins[i - 1], bins[i], bins[i + 1]
        if mid > lo:
            fb[i - 1, lo:mid] = (np.arange(lo, mid) - lo) / (mid - lo)
        if hi > mid:
            fb[i - 1, mid:hi] = (hi - np.arange(mid, hi)) / (hi - mid)
    return fb


def voice_print(np, audio, sr: int):
    """24 numbers describing a stretch of voice: mean and std of MFCC 1-12."""
    n_fft, hop, win = 256, int(sr * 0.010), int(sr * 0.025)
    if len(audio) < win * 4:
        return None
    frames = np.lib.stride_tricks.sliding_window_view(audio, win)[::hop] * np.hamming(win)
    spec = np.abs(np.fft.rfft(frames, n=n_fft)) ** 2
    energy = spec.sum(axis=1)
    keep = energy > (np.median(energy) * 0.1)          # drop near-silent frames
    if keep.sum() < 10:
        return None
    logmel = np.log(spec[keep] @ _mel_filters(np, n_fft, sr).T + 1e-10)
    n = logmel.shape[1]
    dct = np.cos(np.pi / n * (np.arange(n)[:, None] + 0.5) * np.arange(13)[None, :])
    mfcc = (logmel @ dct)[:, 1:13]
    return np.concatenate([mfcc.mean(axis=0), mfcc.std(axis=0)])


def _kmeans(np, x, k: int, iters: int = 30):
    centers = [x[0]]
    for _ in range(1, k):  # farthest-point start: deterministic, no random seed
        d = np.min([((x - c) ** 2).sum(axis=1) for c in centers], axis=0)
        centers.append(x[int(np.argmax(d))])
    centers = np.array(centers)
    labels = np.zeros(len(x), dtype=int)
    for _ in range(iters):
        labels = np.argmin(((x[:, None, :] - centers[None]) ** 2).sum(axis=2), axis=1)
        new = np.array([x[labels == j].mean(axis=0) if (labels == j).any() else centers[j] for j in range(k)])
        if np.allclose(new, centers):
            break
        centers = new
    return labels


def _silhouette(np, x, labels) -> float:
    d = np.sqrt(((x[:, None, :] - x[None]) ** 2).sum(axis=2))
    scores = []
    for i in range(len(x)):
        same = labels == labels[i]
        if same.sum() <= 1:
            scores.append(0.0)
            continue
        a = d[i, same].sum() / (same.sum() - 1)
        b = min(d[i, labels == j].mean() for j in set(labels.tolist()) if j != labels[i])
        scores.append((b - a) / max(a, b, 1e-9))
    return float(np.mean(scores))


def label_speakers_from_audio(audio, sr: int, snippets: list[dict]) -> list[int] | None:
    """A speaker number (0-based, in order of first appearance) per snippet, or None when the
    recording doesn't clearly have more than one voice."""
    import numpy as np

    prints, idx, weights = [], [], []
    for i, s in enumerate(snippets):
        start, dur = float(s.get("start", 0)), float(s.get("duration", 0))
        if dur < MIN_SEGMENT_SECONDS:
            continue
        vp = voice_print(np, audio[int(start * sr): int((start + dur) * sr)], sr)
        if vp is not None:
            prints.append(vp)
            idx.append(i)
            weights.append(dur)
    if len(prints) < 4:
        return None
    x = np.array(prints)
    x = (x - x.mean(axis=0)) / (x.std(axis=0) + 1e-9)
    w = np.array(weights)
    best = None
    for k in range(2, min(MAX_SPEAKERS, len(x) - 1) + 1):
        labels = _kmeans(np, x, k)
        shares = [w[labels == j].sum() / w.sum() for j in range(k)]
        if min(shares) < MIN_SHARE:
            continue
        score = _silhouette(np, x, labels)
        if score >= MIN_SILHOUETTE and (best is None or score > best[0]):
            best = (score, labels)
    if best is None:
        return None

    # Spread labels to every snippet (short ones take the previous speaker), then number
    # speakers by first appearance.
    per = [-1] * len(snippets)
    for j, i in enumerate(idx):
        per[i] = int(best[1][j])
    last = next((p for p in per if p >= 0), 0)
    for i, p in enumerate(per):
        per[i] = last = (p if p >= 0 else last)
    order: dict[int, int] = {}
    return [order.setdefault(p, len(order)) for p in per]


def decode_audio(path: str):
    """Mono 8 kHz float samples of a media file (first 60 minutes), via ffmpeg."""
    import numpy as np
    raw = subprocess.run(
        ["ffmpeg", "-v", "quiet", "-i", path, "-t", str(MAX_SECONDS), "-vn", "-ac", "1",
         "-ar", str(SAMPLE_RATE), "-f", "s16le", "pipe:1"],
        capture_output=True, timeout=600, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float32) / 32768.0


def label_speakers(path: str, snippets: list[dict]) -> list[int] | None:
    """Speaker labels for an uploaded video, or None. Never raises."""
    try:
        return label_speakers_from_audio(decode_audio(path), SAMPLE_RATE, snippets)
    except Exception as e:                               # noqa: BLE001 (numpy/ffmpeg missing, bad audio)
        logger.info(f"speaker labels skipped: {e}")
        return None


def with_speakers(snippets: list[dict], labels: list[int] | None) -> list[dict]:
    """Snippets whose text starts with "Speaker N:" wherever the speaker changes."""
    if not labels or len(labels) != len(snippets):
        return snippets
    out, prev = [], None
    for s, lab in zip(snippets, labels):
        s = dict(s)
        if lab != prev:
            s["text"] = f"Speaker {lab + 1}: {s.get('text', '')}"
            prev = lab
        out.append(s)
    return out
