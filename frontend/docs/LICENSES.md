# Licenses

## This repository
Original code: **MIT** (`/LICENSE`). If the hackathon prefers Apache-2.0, replace the file.

## npm dependencies (all permissive)
react, react-dom, three, @react-three/fiber, @react-three/drei, zustand, zod, framer-motion, @dagrejs/dagre, jspdf, tailwindcss, vite,
@vitejs/plugin-react, vitest, typescript, ws, tsx — MIT (jspdf also bundles dompurify (Apache-2.0/MPL) and html2canvas (MIT) as transitive dependencies).

## Python (bridge/)
fastapi, uvicorn, httpx, pydantic, pyyaml, pytest, pytest-asyncio — MIT / BSD / Apache-2.0 (permissive). Re-check when you pin versions.

## Assets
No external 3D models or textures. All geometry is procedural; all textures are generated at runtime on `<canvas>`. Fonts are loaded from Google Fonts (Space Grotesk, Inter, JetBrains Mono — SIL OFL). No sounds are bundled (tiny WebAudio blips).

## Models
Models are selected exclusively from the 0G Private Computer catalogue. Each upstream model retains its own license (for example Apache-2.0, MIT, OpenRAIL-M, or a community license); verify and record the license for each model used in a submission. Router availability or pricing does not change those model licenses.

## AUTONEX reference files
`reference/autonex_reference/` holds the owner's own documents, **unmodified**, for context. They are not part of the MIT grant unless the owner decides so.
