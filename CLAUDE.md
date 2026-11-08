# Habblaud Deck — handover notes

Node/TypeScript daemon that renders Habblaud's pixel-art office (../habblaud, running on http://localhost:4747) onto a
**Rise Mode Vision 01** (rebranded Mirabox 293S V3, 15 LCD keys 5×3 + a vertical strip on the right) over USB HID.
Read README.md first. Windows 11, PowerShell, Node 24. Run things with `npm run …` / `npx tsx …`.

## Hardware facts (verified 2026-11-08; details in README "First run" + "Protocol")
- USB `0A00:1006` "HOTSPOTEKUSB HID DEMO" (the capture ids were right; the deck just wasn't plugged in). Vendor
  interface 0, usage page 0xFFA0, 1025-byte output reports (`reportId: true`).
- `BAT` header is `CRT\0\0BAT` + size[4 BE] + index, no padding (the old code had two extra zeros → images ignored).
- Images show rotated 90° CW → pre-rotate 270. Index 1 = top-right key, numbered down columns. Key window ≈104×98 px
  anchored top-right (108 px tiles, `keyCut`). Strip = continuous, slots aligned with key rows, ~150 px pitch.
- No working full-panel command: no `BGPIC` in the vendor DLL; `LOG` is accepted but never drawn. Render path = BAT tiles.
- Busy ~15 KB tiles hung the firmware (replug needed) → tiles capped at 8 KB (`maxJpegBytes`).

## Status
Tasks 1–4 done (ids, geometry, calibration, render path = tiles: ~118 ms per full frame). `npm start` drives the deck.
Open: a live full-panel command (needs a USB capture of the vendor app setting a background).

## Rules
- Don't touch ../habblaud (only read its API / art). Never modify its shared/world or server/world folders.
- Close the Rise Mode / Mirabox app before talking to the device (it holds it).
- Keep changes small and typed; `npx tsc --noEmit` must pass.
