# Test fixtures

The MP4 and MP3 fixtures used by `muxAudio.test.ts` and `concatVideos.test.ts`
are **generated on the fly** by the test setup using real `ffmpeg` via the
`ffmpeg-static` binary. They are not committed.

Why generated, not committed:

- Reproducible from source — anyone running the tests gets identical bytes from
  the same `ffmpeg` invocation, with no risk of a stale committed blob drifting
  from what the tests expect.
- Avoids checking large native binary blobs into git.
- Smaller diffs forever after.

The fixtures land under this directory at test time so the existing tsconfig
exclude (`"__fixtures__"`) keeps them out of the type-check + build.

## What's generated

| File          | Spec                                       |
| ------------- | ------------------------------------------ |
| `clip-a.mp4`  | 2 s, 320×240, 24 fps, H.264+AAC, red       |
| `clip-b.mp4`  | 2 s, 320×240, 24 fps, H.264+AAC, blue      |
| `silent.mp4`  | 2 s, 320×240, 24 fps, H.264, no audio      |
| `voice.mp3`   | 2 s, 44.1 kHz mono, 64 kbps MP3 sine 523Hz |

All four are deterministic outputs of `ffmpeg`'s synthetic `lavfi` filters —
no third-party assets, no licensing concern.
