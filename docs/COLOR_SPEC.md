# SourceCheck Semantic Color Specification
## Strict Dark Theme — Google-Derived Palette

**Version:** 1.0  
**Date:** 2026-03-20  
**Status:** Draft for Implementation

---

## 1. PHILOSOPHY

**Dark. Premium. Readable. Subtle.**

- Surfaces are near-black, never pure black (depth through layered grays)
- Text is stark white with graduated opacity for hierarchy
- Color is functional, not decorative
- Accent colors serve semantic purposes — model identity, verification state, live activity
- Yellow is powerful but dangerous — use sparingly and never for body text
- Red is reserved for errors and disputed claims only

---

## 2. COLOR TOKENS

### 2.1 Core Palette (Source of Truth)

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--gc-blue` | `#4285F4` | `66, 133, 244` | Gemini 2.5 Flash, Primary Actions |
| `--gc-green` | `#34A853` | `52, 168, 83` | Gemini 3.1 Flash Lite, Supported |
| `--gc-yellow` | `#FBBC05` | `251, 188, 5` | Gemini 3 Flash Preview, Mixed/Needs Context |
| `--gc-red` | `#EA4335` | `234, 67, 53` | Disputed, Errors, Warnings (rare) |

**Note:** These are the canonical Google brand colors. All UI colors derive from these.

### 2.2 Neutral Scale (Zinc-Inspired, True Dark)

| Token | Hex | RGB | Usage |
|-------|-----|-----|-------|
| `--n-0` | `#09090B` | `9, 9, 11` | Deepest background (canvas) |
| `--n-1` | `#18181B` | `24, 24, 27` | Card surfaces, elevated panels |
| `--n-2` | `#27272A` | `39, 39, 42` | Hover states, borders, subtle elevation |
| `--n-3` | `#3F3F46` | `63, 63, 70` | Borders, dividers, disabled states |
| `--n-4` | `#52525B` | `82, 82, 91` | Placeholder text, inactive icons |
| `--n-5` | `#71717A` | `113, 113, 122` | Tertiary text, timestamps |
| `--n-6` | `#A1A1AA` | `161, 161, 170` | Secondary text, muted labels |
| `--n-7` | `#D4D4D8` | `212, 212, 216` | Primary body text |
| `--n-8` | `#E4E4E7` | `228, 228, 231` | Emphasized text |
| `--n-9` | `#FAFAFA` | `250, 250, 250` | Headlines, maximum contrast |
| `--white` | `#FFFFFF` | `255, 255, 255` | Logo, critical text only |

### 2.3 Semantic Tokens

**Model Identity (Picker, Scanner, HUD)**
```css
--model-25: var(--gc-blue);        /* Gemini 2.5 Flash */
--model-25-rgb: 66, 133, 244;

--model-31: var(--gc-green);       /* Gemini 3.1 Flash Lite */
--model-31-rgb: 52, 168, 83;

--model-3: var(--gc-yellow);       /* Gemini 3 Flash Preview */
--model-3-rgb: 251, 188, 5;
```

**Verification States (Badges, Card Borders, Results)**
```css
--state-supported: var(--gc-green);
--state-supported-rgb: 52, 168, 83;
--state-supported-soft: rgba(52, 168, 83, 0.15);
--state-supported-glow: rgba(52, 168, 83, 0.4);

--state-mixed: var(--gc-yellow);
--state-mixed-rgb: 251, 188, 5;
--state-mixed-soft: rgba(251, 188, 5, 0.12);
--state-mixed-glow: rgba(251, 188, 5, 0.35);

--state-disputed: var(--gc-red);
--state-disputed-rgb: 234, 67, 53;
--state-disputed-soft: rgba(234, 67, 53, 0.15);
--state-disputed-glow: rgba(234, 67, 53, 0.5);

--state-unresolved: var(--n-6);
--state-unresolved-rgb: 161, 161, 170;
--state-unresolved-soft: rgba(161, 161, 170, 0.1);
```

**Surface & Interactive**
```css
--surface-bg: var(--n-0);
--surface-card: var(--n-1);
--surface-card-hover: var(--n-2);
--surface-glass: rgba(24, 24, 27, 0.92);

--border-subtle: rgba(255, 255, 255, 0.06);
--border-default: rgba(255, 255, 255, 0.12);
--border-strong: rgba(255, 255, 255, 0.22);

--text-primary: var(--n-9);
--text-secondary: var(--n-7);
--text-tertiary: var(--n-6);
--text-muted: var(--n-5);
--text-placeholder: var(--n-4);
```

---

## 3. ALPHA VARIANTS & GLOW RULES

### 3.1 Allowed Alpha Values

| Variant | Opacity | Usage |
|---------|---------|-------|
| `-soft` | 0.08 - 0.15 | Subtle backgrounds, pill fills |
| `-medium` | 0.25 - 0.35 | Borders on dark, glows |
| `-strong` | 0.50 - 0.70 | Active states, prominent borders |
| `-glow` | 0.30 - 0.50 | Box-shadow glows only |

### 3.2 Glow System (Quiet to Loud)

Glows use the `-rgb` tokens for box-shadow spread:

```css
/* Quiet - Subtle ambient presence */
box-shadow: 0 0 8px rgba(var(--color-rgb), 0.20);

/* Normal - Active but calm */
box-shadow: 0 0 12px rgba(var(--color-rgb), 0.30);

/* Loud - Demanding attention (disputed only) */
box-shadow: 0 0 20px rgba(var(--color-rgb), 0.50),
            0 0 40px rgba(var(--color-rgb), 0.20);
```

**Rules:**
- Only `--state-disputed` may use "Loud" glow
- `--model-3` (yellow) never uses glow above 0.30 (too harsh)
- Scanner pulse uses `0.15 - 0.25` range (ambient, not alarming)

---

## 4. QUIET-TO-LOUD STATE SYSTEM

### 4.1 Scanning / Live Activity

| State | Visual Treatment | Rationale |
|-------|------------------|-----------|
| **Quiet** | Single-pixel rail line in `--model-X`, 0.3 opacity | Always present but unobtrusive |
| **Active** | Scanner head moving, 0.6 opacity, 2px width | Shows current progress |
| **Pulse** | Node glows at 0.15-0.25, slow (3s) pulse | Subtle liveness indication |
| **Processing** | Badge glow at 0.30, faster pulse (1.5s) | User should notice but not be alarmed |

### 4.2 Verification Results

| Status | Border | Badge Fill | Badge Text | Glow | Loudness |
|--------|--------|------------|------------|------|----------|
| **Supported** | 1px `--state-supported` at 0.4 | `--state-supported-soft` | `--state-supported` solid | None | Quiet - success is calm |
| **Mixed** | 1px `--state-mixed` at 0.5 | `--state-mixed-soft` | `--state-mixed` solid | Soft 8px at 0.25 | Moderate - needs attention |
| **Disputed** | 2px `--state-disputed` at 0.7 | `--state-disputed-soft` | `--state-disputed` solid | Loud 20px at 0.5 | Loud - user must see this |
| **Unresolved** | 1px `--border-default` | transparent | `--state-unresolved` solid | None | Silent - no signal yet |

### 4.3 Loudness by Context

```
Scanner Activity:    Quiet (0.1 - 0.3) — always on, shouldn't distract
Supported Result:    Quiet (0.0 - 0.2) — positive, no action needed
Mixed Result:        Moderate (0.2 - 0.4) — warrants review
Disputed Result:     Loud (0.4 - 0.6) — requires immediate attention
Error State:         Loud (0.5 - 0.7) — system needs user action
```

---

## 5. YELLOW USAGE RULES (CRITICAL)

Yellow (`--gc-yellow`, `#FBBC05`) is the most visible color on dark backgrounds but also the most dangerous for readability and accessibility.

### 5.1 Where Yellow CAN Be Used

✅ **Allowed:**
- Model picker selection indicator (dot, border) for Gemini 3 Flash Preview
- Scan rail line when model 3 is selected
- Badge background (soft alpha only: 0.08-0.12)
- Badge border (medium alpha: 0.25-0.40)
- Small icons in model context (12px max)
- Status indicator dots

### 5.2 Where Yellow CANNOT Be Used

❌ **Forbidden:**
- Body text (insufficient contrast, eye strain)
- Headlines or labels
- Button text
- Input placeholders
- Large filled surfaces (>40px)
- Glow above 0.30 opacity (creates halo effect)
- Any text smaller than 14px

### 5.3 Yellow Contrast Workarounds

When yellow needs emphasis, use these techniques instead of brighter yellow:

1. **White text on yellow-tinted background:**
   ```css
   background: rgba(251, 188, 5, 0.12);
   color: var(--text-primary); /* White */
   ```

2. **Yellow border with neutral fill:**
   ```css
   border: 1px solid rgba(251, 188, 5, 0.5);
   background: var(--surface-card);
   ```

3. **Yellow icon + white label:**
   ```css
   /* Icon */
   color: var(--gc-yellow);
   /* Text */
   color: var(--text-secondary);
   ```

### 5.4 Yellow Accessibility Thresholds

| Element | Minimum Size | Minimum Contrast | Alpha Limit |
|---------|--------------|------------------|-------------|
| Icons | 12px | 3:1 | Solid |
| Borders | 1px | N/A | 0.25-0.50 |
| Badge fills | N/A | N/A | 0.08-0.12 |
| Text | NEVER | N/A | N/A |

---

## 6. COMPONENT-BY-COMPONENT MAPPING

### 6.1 ModelPicker

| Element | Color Token | Alpha | Notes |
|---------|-------------|-------|-------|
| Trigger background | `--surface-card` | 100% | Same as other inputs |
| Trigger border | `--border-default` | 12% | Subtle |
| Selected model indicator | `--model-X` | 100% | Dot (8px) shows current model |
| Model 2.5 label | `--model-25` | 100% | Blue |
| Model 3.1 label | `--model-31` | 100% | Green |
| Model 3 label | `--model-3` | 100% | Yellow (icon only, with white text) |
| Dropdown hover | `--surface-card-hover` | 100% | Universal |
| Speed tag | `--text-muted` | 100% | Gray, not colored |

**Layout:**
```
[Model Dot] [Model Number] [Speed Tag]
     ●          2.5          Fast
   (blue)     (white)       (gray)
```

### 6.2 Scanner (CardFeed Rail)

| Element | Color Token | Alpha | Behavior |
|---------|-------------|-------|----------|
| Rail line | `--model-X-rgb` | 0.3 | Static, always present |
| Scanner head | `--model-X-rgb` | 0.6 | Moving, 2px width |
| Scan nodes | `--model-X-rgb` | 0.4 | Pulse on activity |
| Node glow | `--model-X-rgb` | 0.15-0.25 | Slow pulse (3s cycle) |
| Processing badge | `--model-X-rgb` | 0.3 | Fast pulse (1.5s) |

**Model Color Switching:**
- When user changes model in picker, rail color transitions over 300ms
- All scanner elements use CSS custom properties for dynamic theming

### 6.3 Source Cards

| Element | Status: Supported | Status: Mixed | Status: Disputed | Status: Unresolved |
|---------|-------------------|---------------|------------------|-------------------|
| Left border | 2px green, 40% | 2px yellow, 50% | 3px red, 70% | 1px gray, 12% |
| Badge background | Green, 10% | Yellow, 10% | Red, 12% | Transparent |
| Badge text | Green, 100% | Yellow, 100% | Red, 100% | Gray, 100% |
| Badge glow | None | 8px, 25% | 12px, 40% | None |
| Card shadow | Standard | Standard + glow | Strong + glow | Standard |

**Card Background:**
- Always `--surface-card` (`--n-1`)
- Hover: `--surface-card-hover` (`--n-2`)
- Never use status colors for card fills

### 6.4 VerdictBadge

| Status | Background | Border | Text | Icon | Glow |
|--------|------------|--------|------|------|------|
| Supported | `--state-supported-soft` | 1px at 40% | `--state-supported` | Check | None |
| Mixed | `--state-mixed-soft` | 1px at 50% | `--state-mixed` | Minus | 8px at 25% |
| Disputed | `--state-disputed-soft` | 1px at 70% | `--state-disputed` | X | 12px at 40% |
| Unresolved | Transparent | 1px `--border-default` | `--state-unresolved` | Minus | None |

### 6.5 SettingsPanel

| Element | Color Token | Notes |
|---------|-------------|-------|
| Panel background | `--surface-glass` | 92% opacity, blur |
| Section headers | `--text-secondary` | Not colored |
| Input borders | `--border-default` | Subtle |
| Input focus border | `--model-X` | Uses active model color |
| API key status: Valid | `--state-supported` | Green dot |
| API key status: Invalid | `--state-disputed` | Red dot + message |
| Save button | `--gc-blue` | Primary action |
| Cancel button | `--text-secondary` | Neutral |

### 6.6 SourceCheckLogo

| Element | Color Token | Usage |
|---------|-------------|-------|
| Logo mark | `--white` | Always white for brand consistency |
| Logo glow | `--gc-blue` at 0.15 | Subtle blue aura (optional) |
| Wordmark | `--text-primary` | White |
| Version tag | `--text-muted` | Gray |

**Note:** Logo does NOT change color with model selection. Brand identity is constant.

### 6.7 AskResponseCard

| Element | Color Token | Notes |
|---------|-------------|-------|
| Card background | `--surface-card` | Standard |
| User query background | `--n-2` | Slightly elevated |
| Response text | `--text-secondary` | Readable gray |
| Citation links | `--gc-blue` | Blue underlines |
| Citation hover | `--gc-blue` at 70% | Darker on hover |
| Model attribution | `--model-X` | Shows which model answered |

---

## 7. IMPLEMENTATION CHECKLIST

### CSS Layer
- [ ] Add all tokens to `globals.css` `:root`
- [ ] Create `.theme-dark` class as container
- [ ] Define semantic classes (`.bg-surface-card`, `.text-primary`, etc.)
- [ ] Create model color utility classes

### Tailwind Config
- [ ] Extend theme with all tokens
- [ ] Add `model()` function for dynamic colors
- [ ] Verify all colors pass contrast checks

### Components
- [ ] **ModelPicker**: Update to use semantic model colors
- [ ] **CardFeed**: Replace hardcoded RGB strings with CSS vars
- [ ] **VerdictBadge**: Verify badge classes match spec
- [ ] **SourceCard**: Update border/glow logic
- [ ] **SettingsPanel**: Add focus states with model color
- [ ] **SourceCheckLogo**: Verify white logo, optional glow

### Validation
- [ ] Yellow text contrast check (should find none)
- [ ] Yellow glow intensity check (max 0.30)
- [ ] Disputed state loudness check (should be obvious)
- [ ] Supported state quietness check (should be calm)
- [ ] Dark mode accessibility (WCAG 2.1 AA)

---

## 8. ANTI-PATTERNS (NEVER DO)

```css
/* ❌ Never use yellow for text */
color: var(--gc-yellow);

/* ❌ Never use pure black */
background: #000000;

/* ❌ Never use model colors for verification states */
--state-supported: var(--model-25); /* Wrong! */

/* ❌ Never use red for model identity */
--model-X: var(--gc-red);

/* ❌ Never hardcode colors in components */
style={{ color: '#4285F4' }}

/* ❌ Never use glow above 0.5 opacity */
box-shadow: 0 0 20px rgba(234, 67, 53, 0.8);

/* ❌ Never use yellow glow above 0.3 */
box-shadow: 0 0 15px rgba(251, 188, 5, 0.5);
```

---

## 9. CHANGE LOG

| Date | Version | Changes |
|------|---------|---------|
| 2026-03-20 | 1.0 | Initial spec created |

---

**Next Steps:**
1. Review this spec for approval
2. Create CSS token file
3. Update Tailwind config
4. Refactor components one at a time
5. Visual regression test each component
