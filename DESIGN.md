# Design

Visual system for the Asclepius frontend. Tokens live in `frontend/src/index.css` (CSS variables, HSL channel triples consumed via `hsl(var(--x) / <alpha-value>)`) and are mapped to Tailwind utilities in `frontend/tailwind.config.ts`. Register: product (see PRODUCT.md). Color strategy: restrained; the accent appears on primary actions, active selection, and state indicators only.

## Color

The palette derives from the logo (`frontend/public/logo.svg`): brick red #8E4449, slate #495155. Neutrals are tinted toward the slate hue (203-205, sat 8-20%); the accent is the logo red exactly in light mode and a lightened variant in dark mode.

### Light

| Token | HSL | Role |
| --- | --- | --- |
| `--background` | 200 20% 97% | page (#F6F8F9) |
| `--foreground` | 203 15% 16% | text, 13.6:1 on bg |
| `--card` / `--popover` | 0 0% 100% | content surfaces |
| `--surface` | 205 16% 94% | second neutral layer: sidebar, top bar, toolbars, table heads |
| `--secondary` | 205 15% 91% | secondary fills |
| `--muted` | 205 16% 93% | muted fills |
| `--muted-foreground` | 203 9% 38% | secondary text, 5.8:1 on bg |
| `--accent` | 205 18% 92% | hover fill |
| `--border` | 205 14% 87% | hairlines |
| `--input` | 205 12% 58% | form-control borders, 3.04:1 non-text |
| `--primary` | 356 35% 41% | logo red, 6.9:1 on card as text and fill |
| `--primary-foreground` | 0 0% 100% | on primary, 6.9:1 |
| `--primary-hover` | 356 37% 35% | darker hover, 8.5:1 with white |
| `--ring` | 356 35% 41% | focus, 6.4:1 vs bg |
| `--destructive` / `--destructive-soft` | 0 60% 40% / 0 75% 95% | error ink / tint (6.2:1 pair) |
| `--success` / `--success-soft` | 152 55% 26% / 150 45% 94% | 6.2:1 pair |
| `--warning` / `--warning-soft` | 35 85% 30% / 45 92% 92% | 5.4:1 pair |
| `--info` / `--info-soft` | 205 70% 34% / 205 75% 94% | 5.8:1 pair |
| `--cat-violet` / `--cat-violet-soft` | 275 45% 42% / 275 60% 95% | categorical (reprocess, vision) |
| `--cat-teal` / `--cat-teal-soft` | 175 55% 26% / 172 45% 92% | categorical (translate) |

### Dark

Backgrounds 203-hue near-blacks (`--background` 203 12% 10% = #161A1D, `--card` 203 11% 13%). The red lightens to `--primary` 356 45% 62% and primary fills flip to dark text (`--primary-foreground` 356 50% 10%, 5.4:1) because white on the lightened red fails contrast. Status inks lighten, soft tints become deep tinted fills. Full values in `index.css`.

### Rules

- Status badges pair ink on soft: `bg-success-soft text-success`, borders as `border-success/25`
- Never hard-code Tailwind palette classes (green-100, blue-700 ...); use semantic tokens. Pipeline-kind colors come from `frontend/src/lib/statusTokens.ts`
- `--surface` separates chrome (sidebar, top bar, toolbars, sticky table heads) from content (`--card` on `--background`)

## Typography

- System stack only: `--font-sans: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`. No webfonts
- Tailwind default scale; roles: page title `text-lg font-semibold`, section heading `text-base font-semibold`, body and controls `text-sm`, caption/meta `text-xs`, data cells `text-sm tabular-nums`
- Form inputs `text-base sm:text-sm`: the 16px floor on small screens prevents iOS Safari focus auto-zoom
- Prose line length capped at 65-75ch

## Geometry, elevation, motion

- Radius: `--radius` 0.5rem (lg), md/sm derived
- Shadows: `--shadow-1/2/3` mapped to `shadow-raised` / `shadow-overlay` / `shadow-floating`; slate-hued in light, deeper black in dark
- Motion: `--dur-fast` 150ms, `--dur-base` 200ms, `--dur-slow` 250ms with `--ease-out` cubic-bezier(0.16, 1, 0.3, 1); state transitions only, no decorative motion; global prefers-reduced-motion kill switch in index.css
- Z-index scale (Tailwind `z-*`): sticky 10, dropdown 20, fab 25, bar 30, drawer 40, overlay 50, toast 60, tooltip 70. Never arbitrary values

## Touch and responsive

- Stock Tailwind breakpoints; mobile-first: unprefixed = phone, `sm:`/`md:`/`lg:` layer up
- Touch targets >= 44px via `coarse:` variant (`coarse:min-h-11`); custom variants: `coarse:`, `fine:`, `can-hover:`, `no-hover:`
- `h-dvh` instead of `h-screen`; safe-area utilities `pt-safe` / `pb-safe` / `pl-safe` / `pr-safe`; viewport meta uses `viewport-fit=cover`
- Hover is an enhancement, never the only affordance: rule `opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-visible:opacity-100`

## Components

Primitives in `frontend/src/components/ui/`: Button (sm h-8, md h-9, lg h-11, all `coarse:min-h-11`), IconButton (required label), Input/Textarea/Select/Field (styled natives), Sheet (bottom sheet below sm, centered dialog above; side="left" is the nav drawer), Menu (pure action menus only), Popover, PickerShell/Combobox/MultiSelect (Sheet below sm, Popover above), Tabs (scrollable, no flex-1), ResponsiveTable (table >= md, card list < md), Skeleton (loading = skeletons, not spinners in content), EmptyState, Badge, Tooltip (hover-capable devices only). Every interactive component ships default, hover, focus-visible, active, disabled, loading, error states.
