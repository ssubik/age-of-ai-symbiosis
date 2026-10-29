# Tactical Atlas redesign contract

## Core formula that does not change

Age of AI remains a real-time, isometric civilization game: gather food, wood,
gold, and stone; establish a base; increase population and production; advance
the city; field an army; contest territory; destroy the opposing civic core.
The server remains authoritative. Client visuals never create resources, skip
prerequisites, resolve combat, or decide victory.

## New presentation thesis

The game is framed as an **organic tactical atlas** rather than a historical
ornamental frame or a dashboard. The battlefield remains the primary surface.
UI is a set of compact instruments floating at its edges.

- Shape: low, precise panels; rounded corners only where the player touches.
- Value: dark instruments over a warmer, higher-value battlefield.
- Color: cyan = information/order, mint = healthy/available, amber = progress or
  scarce attention, coral = threat/failure.
- Edge: thin technical rules and restrained glow, never thick ornamental frames.
- Motion: quick ease-out response; impact effects return to rest immediately.
- Camera: 2:1 isometric with a bounded tactical zoom, anchored under the cursor.
- Accessibility: visible keyboard focus, responsive rails, reduced-motion support.

## Interaction hierarchy

1. Read the battlefield and silhouettes.
2. Read selection and issued-order confirmation.
3. Read resources, population, city state, and power.
4. Use context actions and production.
5. Inspect council, ledger, proof, or campaign detail on demand.

No secondary panel may permanently obscure more battlefield than the command
rail it replaces. New mechanics must expose a discrete event so feedback can be
layered without polling or altering simulation state.

## Verification gates

- Typecheck and production build pass.
- Classic and Symbiosis use the same battlefield interaction contract.
- Wheel zoom preserves the world point beneath the cursor and stays bounded.
- HUD remains usable at 1920×1080, 1366×68, and narrow/mobile widths.
- Costs, prerequisites, command payloads, ticks, snapshots, and victory logic are
  unchanged by presentation work.
