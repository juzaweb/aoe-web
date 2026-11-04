# Chiến Quốc (Chien Quoc) - 2D MMO RTS Web Game

A 2D Isometric Real-Time Strategy (RTS) MMO web game inspired by *Age of Empires* (AoE). Built with **Node.js**, **React**, **Vite**, **Phaser 3**, and **Colyseus.js** in a high-performance TypeScript monorepo.

---

## 🏛️ Architecture & Tech Stack

```
chien-quoc/
├── packages/
│   └── shared/          # Shared game models, math (Isometric projection), blueprints & network protocols
└── apps/
    ├── server/          # Authoritative Node.js game server using Colyseus.js & Express
    └── client/          # Modern Web Client: React 18 HUD + Vite + Phaser 3 Isometric 2.5D Canvas
```

- **Frontend Core:** [React 18](https://react.dev/) + [Vite](https://vitejs.dev/) + [Phaser 3](https://phaser.io/)
- **Multiplayer Server:** [Colyseus.js](https://colyseus.io/) (Authoritative game room, state synchronization schema, 20 ticks/sec simulation)
- **Database & Persistence:** SQLite with [Prisma ORM](https://www.prisma.io/) (WAL mode, auto-save every 30s, instant empire restore)
- **Styling & UI:** Tailwind CSS, Lucide Icons, Cinzel medieval typography
- **Graphics Engine:** Procedural Isometric 2.5D Pixel Art Generator (zero missing assets / 404s)

---

## 🎮 Gameplay Features

- **Persistent Isometric 2.5D World:** per-account kingdom (110x110) plus a shared battlefield
  (220x220), with natural forests (Wood), gold deposits (Gold), stone quarries (Stone), and berry
  bushes (Food). A kingdom's clusters ring the map border, leaving the centre open for the Town
  Center.
- **Regrowing Resources:** a depleted node on the border ring refills to full after a per-type
  delay (wood 60 s, food 90 s, stone 150 s, gold 240 s). The deadline is stored in SQLite, so a
  restart resumes the wait instead of refilling the map. The starter woodline and berry patch
  given with the Town Center are a one-off supply: once felled they are gone for good.
- **Empire Base Building:**
  - **Town Center:** Base headquarters providing population and training Villagers.
  - **Barracks:** Military garrison to train Spearmen, Archers, and Cavalry.
  - **House:** Increases population capacity by +5.
  - **Farm:** Sustainable food source for economy and troops.
  - **Watch Tower:** Defensive outpost.
- **RTS Unit Controls:**
  - **Drag Box Selection:** Click and drag left mouse button to group-select units.
  - **Right Click Command:**
    - Click terrain to move.
    - Click resource nodes (Tree, Berry, Gold, Stone) to order villagers to harvest.
    - Click enemy units or buildings to attack.
- **Mini-map:** Live radar displaying friendly/enemy units, buildings, and resources with click-to-pan navigation.

---

## 🕹️ Controls & Shortcuts

| Action | Control |
|---|---|
| **Pan Camera** | `W`, `A`, `S`, `D` or `Arrow Keys` |
| **Zoom Viewport** | `Mouse Wheel` (0.4x - 2.2x) |
| **Select / Drag-Select Units** | `Left Click` & Drag |
| **Command (Move / Attack / Harvest)** | `Right Click` |
| **Cancel Selection / Placement** | `Escape` or `Right Click` |
| **Build Town Center** | `Q` |
| **Build Barracks** | `W` |
| **Build House** | `E` |
| **Build Farm** | `R` |
| **Build Watch Tower** | `T` |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+ recommended)
- [pnpm](https://pnpm.io/) (v9+)

### Installation

```bash
# Clone repository and install dependencies
pnpm install
```

### Running Development Servers

To run both backend server and frontend client simultaneously:

```bash
pnpm dev
```

Or run them individually:

```bash
# Run Colyseus Game Server on http://localhost:2567 & ws://localhost:2567
pnpm dev:server

# Run Vite React Client on http://localhost:5173
pnpm dev:client
```

### Production Build

```bash
pnpm build
```

---

## 🛡️ License

Private Project - All rights reserved.

Third-party art is used under its own license.

- Unit sprites: OpenGameArt pack *400+ Items - BaseHumanMale / Orc / Skeleton* by
  **SKYZ0R**, **CC-BY 4.0**.
- Tree sprites: *Tree Collection v2.6* by **Bleed**, **CC-BY 3.0**.
- House: *Simple Isometric Hovel* by **Bleed**, **CC-BY 4.0**.
- Barracks, lumber camp and town centre: *Medieval Barracks* / *Medieval Stable* /
  *Western-European Castle* by **feudalwars**, **CC0 1.0**.

The CC-BY assets are modified (cropped, scaled, luminance-matched) as described in
[CREDITS.md](CREDITS.md). All of them are rebuilt by `scripts/assets/build.py`
from `scripts/assets/manifest.json`; run `python scripts/assets/build.py --check`
to verify the shipped files against the recorded hashes.

