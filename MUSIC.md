# Making music for Baseball Gods

You compose; the game plays it. No code needed — drop files in a folder and list them.

## Format
1. Compose in anything. Free, beginner-friendly, retro-friendly options: **BeepBox** (in the browser),
   **FamiStudio** (NES-style), **Bosca Ceoil** (very simple), **LMMS** (full free DAW).
2. Export a **WAV** (44.1 kHz, 16-bit) and keep it as your master.
3. Convert the WAV to **OGG** (Vorbis, quality ~6). Audacity (free) does this: File → Export → OGG.
   OGG plays in every current browser (Safari since 18.4). Optional: also export an MP3 with the same name
   for older iPhones/Macs.

## Looping
Background tracks loop forever. Two ways to make that sound good:
- Make the end flow straight back into the start, or
- Note two times in seconds: where the loop starts (after any intro) and where it ends. The game plays the
  intro once, then jumps from `loopEnd` back to `loopStart` forever, with no gap.

Short one-shot cues ("stingers": a walk-off, a decree, a homer) don't loop; keep them 2–6 seconds.

## Hear it in the game right away
Open Settings (the gear) → Music. Pick the cue (title, hub, game...), optionally type the loop start and end in
seconds, and choose your file. It plays immediately for this session. This works on the published link too,
so you can test a track while you're still composing it.

## Where files go (to make it permanent)
Put files in `public/music/` and list them in `public/music/manifest.json`:

```json
[
  { "id": "title", "file": "title.ogg", "loopStart": 0,   "loopEnd": 52.0, "volume": 0.8 },
  { "id": "hub",   "file": "hub.ogg",   "loopStart": 6.4, "loopEnd": 71.2, "volume": 0.7 },
  { "id": "walkoff", "file": "walkoff.ogg", "volume": 1.0 }
]
```

Missing files are fine: that cue is silent, or the previous track keeps playing. Swap a file anytime by
replacing it, then `npm run play`. For the published link, send the files to Claude to publish with the game.

## Starter cue list (yours to change)
Loops the game asks for today: `title` (title screen and team picker), `hub` (home and every screen),
`game` (watching a game; falls back to `hub`), `sim` (while simming several days), `pennant` (the last 30 days;
falls back to `hub`), `offseason` (after the season; falls back to `hub`).
Stingers (one-shots over the music, which ducks): `homer`, `walkoff` (wired to the game view),
`nohitter`, `decree` (reserved for later).

One browser rule: sound can't start until the player clicks or presses a key, so the game opens on a
"press any key" title screen — that's when the music kicks in.
