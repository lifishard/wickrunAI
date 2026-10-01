---
name: wickrunAI Platform — Mobile C extension
description: Compact conversation controls within the incumbent visual system.
colors:
  bg: "#f5f6f8"
  bg-elev: "#ffffff"
  bg-sunken: "#eceef2"
  fg: "#1b1f27"
  fg-dim: "#606a7b"
  border: "#dfe3ea"
  accent: "#4f6bed"
  accent-hover: "#3f59d6"
  accent-fg: "#ffffff"
  bg-hover: "rgba(0, 0, 0, 0.045)"
  dark-bg: "#15171c"
  dark-bg-elev: "#1d2027"
  dark-bg-sunken: "#101216"
  dark-fg: "#e4e7ed"
  dark-fg-dim: "#9aa4b4"
  dark-border: "#2b2f38"
  dark-accent: "#7c94ff"
  dark-accent-hover: "#92a6ff"
  dark-accent-fg: "#14161b"
typography:
  headline:
    fontSize: "26px"
    fontWeight: 650
    lineHeight: 1.3
    letterSpacing: "-.025em"
  title:
    fontSize: "17px"
    fontWeight: 600
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", \"PingFang SC\", \"Hiragino Sans GB\", \"Microsoft YaHei\", \"Noto Sans CJK SC\", Roboto, sans-serif"
    fontSize: "14px"
    lineHeight: 1.6
  input:
    fontSize: "16px"
    lineHeight: 1.55
  label:
    fontSize: "13px"
rounded:
  base: "10px"
  small: "7px"
  mobile-control: "12px"
  mobile-composer: "20px"
  mobile-sheet: "22px 22px 0 0"
  circle: "50%"
spacing:
  toolbar-gap: "2px"
  compact: "4px"
  small: "8px"
  edge: "12px"
  content: "16px"
  sheet: "20px"
components:
  mobile-send:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    rounded: "{rounded.circle}"
    width: "44px"
    height: "44px"
    padding: "0"
  mobile-send-hover:
    backgroundColor: "{colors.accent-hover}"
  mobile-model:
    backgroundColor: "{colors.bg-sunken}"
    textColor: "{colors.fg}"
    rounded: "{rounded.mobile-control}"
    typography: "{typography.label}"
    padding: "8px 6px"
  mobile-composer:
    backgroundColor: "{colors.bg-elev}"
    rounded: "{rounded.mobile-composer}"
    padding: "10px 8px 6px"
  mobile-sheet:
    backgroundColor: "{colors.bg-elev}"
    rounded: "{rounded.mobile-sheet}"
  mobile-suggestion:
    textColor: "{colors.fg}"
    padding: "12px 8px"
---

# Design System: wickrunAI Platform

## Overview

**Creative North Star: "Compact conversation within the existing wickrunAI world"**

A compact conversation workspace within the existing wickrunAI identity. White or charcoal surfaces, restrained separators, thin action icons, and a blue send action keep attention on starting and continuing a conversation. This is an existing-system mobile extension; desktop composition and brand assets remain authoritative for desktop.

Scope: tokens below describe the implemented mobile extension and its inherited color roles, not a replacement desktop design. Sources: `src/styles.css`, `src/mobile.css`, `src/lib/mobile-layout.ts`, `PRODUCT.md`, and `docs/MOBILE_C_DESIGN.md`. The approved C image is a proposal, not runtime evidence.

**Key Characteristics:**

- One composer with one mobile toolbar.
- Compact visible controls with substantial touch areas.
- Unboxed suggestion and preference rows.
- Theme-aware surfaces and safe-area-aware docking.

## Colors

### Primary

The existing blue accent identifies the send action and selected controls. Hover uses the existing accent-hover role. Disabled buttons inherit opacity (0.45), so the pale send button in an empty-state capture is not a new accent token.

### Neutral

Elevated canvas, sunken control wells, foreground, supporting foreground, and separators use the corresponding frontmatter roles and CSS custom properties. Dark-prefixed entries document the existing dark-theme replacements; components should continue to consume semantic CSS variables. Gold belongs to the existing logo artwork rather than a new mobile control palette.

**The Semantic Surface Rule.** Use existing theme variables for mobile components so dark mode follows the incumbent palette.

## Typography

Body text inherits the existing system and Chinese fallback stack. The mobile greeting uses the headline role; header titles use the title role. Input text stays at the input size; model and mode labels use the label role. Suggestions and supporting copy use body size, while preference rows use (15px). In short viewports the greeting reduces to (18px).

This records the incumbent interface typography. It does not establish a new display-font identity or instruct future marketing surfaces to adopt a system display face.

## Layout

The mobile extension applies at widths up to (860px), including the boundary. Above it, preserve existing desktop composition. The header is at least (56px) tall. Native header icon buttons use (48px) squares; the web header reserves (44px) for its edge controls. Hero content has (16px) horizontal padding. Its existing logo is (58px) square with top spacing `clamp(24px,8vh,72px)`.

Suggestion rows have minimum height (56px), a (14px) icon-to-text gap, and a maximum list width (480px). The composer has a maximum width (680px), one input area, and one non-wrapping toolbar. Its roughly (113px) empty-state height is an observed composition, not a hard fixed-height token. Keep the growing input scrollable, with minimum height (44px) and maximum `min(24dvh,160px)`. The outer dock adds bottom spacing plus the device safe-area inset.

The model selector flexes with available width and truncates long names. Add and overflow controls occupy (44px) by (48px); the mode selector normally occupies (70px) with minimum height (48px). Active-run send groups may use narrower mode and model allocations already present in code. Do not force the idle arrangement over those states.

The sidebar is `min(320px,88vw)`. Full-screen configuration and artifact panels follow the visible viewport, scroll vertically, and retain a reachable close control. Safe-area insets are applied to headers, docks, panels, and sheets.

At viewport heights up to (550px), hide the logo, subtitle, and suggestions and cap the input at (72px). The same optional hero content is hidden when the viewport helper detects a keyboard-sized height loss greater than (120px). These are implementation rules, not proof of actual Android keyboard behavior.

## Elevation & Depth

Mobile composer and suggestion rows are flat, using borders and surface tones. Preferences appear as a bottom sheet over `rgb(15 23 42 / 35%)`, without backdrop blur. The inherited overlay shadow remains available to components that use it; removing shadows from mobile composer rows does not prohibit desktop elevation.

The native language selection retains its subtle selected shadow; web has its incumbent selected-language styling. Sidecar shadow entries preserve the exact inherited values.

## Shapes

Use the frontmatter composer, control, sheet, and circular-action shapes. Suggestion and preference rows are square-edged, separated by a single bottom border. The language-selector tray uses (14px) corners and individual options (10px). Mobile popovers use (20px) corners and contained vertical scrolling.

## Components

### Composer and actions

Use the primary round send action with an inline arrow icon, a model selector, a single Chat/Work chooser, add control, and compact ellipsis. The input focus treatment changes the border to supporting foreground without a mobile shadow. Keep disabled opacity and inherited hover behavior. Native controls retain their existing browser and component focus behavior; the document does not claim a new global focus-ring implementation.

### Suggestions and preferences

Two plain suggestion rows precede the dock. Preference rows have minimum height (56px), padding (12px 4px), and thin trailing chevrons. The sheet header is at least (64px) tall, close controls at least (48px), and the language options at least (44px). Preserve locale selection and scrollable overflow. There is no fixed sheet height: web contains an additional documentation action and theme control.

### Navigation and account

Preserve the existing gold W and open-ring logo. The native build does not currently implement Google account login; do not add a decorative login entry or claim account parity based on the reference.

### Desktop compatibility and evidence

The recorded screenshots at `.impeccable/review/mobile.png`, `menu.png`, `keyboard.png`, and `desktop.png` cover (393×852), (360×420), and (1440×900) browser views. The short capture approximates reduced space, not a real keyboard. Visual review found no material visual defect and assessed C fidelity as matching or reasonably adapted, including existing logo differences. Full comp-build automation records, its formal spec, and diff artifacts are missing; the overall workflow disposition remains **fix**. This documentation does not retroactively pass those gates.

Physical POCO F5 acceptance, actual Android system bars and keyboard, exhaustive dark-theme state coverage, and end-to-end account/model/network behavior are not established by this documentation pass. Existing desktop glyph-icon patterns are not canonized as new mobile icon guidance.

## Do's and Don'ts

### Do:

- Do preserve each surface's existing logo and desktop identity.
- Do keep model and Chat/Work controls beside the send action.
- Do allow content to scroll inside constrained panels and inputs.
- Do distinguish browser evidence from physical-device acceptance.

### Don't:

- Don't ship generated mockup pixels as functional UI.
- Don't duplicate account entry points on web.
- Don't turn mobile dimensions into global desktop rules.
- Don't describe unperformed automation or device gates as passed.

