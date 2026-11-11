# The game's own drawings

Pictures drawn for Plenty Heaps itself (not from the Petixel packs), so they can be shared on
GitHub. They started as simple placeholders: replace or improve them in an editor such as
Aseprite or LibreSprite, keeping the 16 × 16 grid and the packs' 24-colour palette.

- `tiles.png`: seeds, heap, wet heap, sand, the dark space between rooms, packed-earth floor,
  interior wall, sleeping mat, ripe maize (top row); plain sea colour (second row, column 1).
  The map maker's tile list (`maps-src/tiles.json`) says which square each tile uses.
- `items.png`: hoe, watering can, cowrie, maize cob (`tools/build_assets.py` uses them).

After editing, save in the map maker (tiles) or run `python tools/build_assets.py` (items).

The packs themselves go in `art-src/petixel/`, and pictures made from them (the composed huts, the
market stall, seed packets) in `art-src/made/`. Both stay on your computer: the packs' licence
doesn't allow sharing them, and this repository is public.
