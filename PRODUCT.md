# Product

## Register

product

## Users

- A self-hoster managing their own family's medical records (multi-patient: partner, kids) on a trusted home network. Technical, detail-oriented, uses the app in focused bursts: filing new documents, looking up a past result, preparing for an appointment
- Outside doctors receiving a one-time share link. Non-technical, on unknown devices (often a phone), short-lived sessions, zero patience for friction. They verify an OTP, read documents, optionally translate a region
- Both audiences increasingly arrive on mobile: photographing a paper report at the clinic, checking a lab trend in a waiting room, a specialist opening a share link from their phone

## Product purpose

Turn a lifetime pile of PDFs, scans, and phone photos of medical reports into a searchable, trendable, shareable archive. OCR + LLM extraction files everything under the right person and year; lab values normalize onto trend charts; a timeline groups documents into medical events; a hardened share surface hands a curated slice to an outside clinician. Success: finding any record in seconds, on any device, without touching a desktop.

## Brand personality

Calm, precise, trustworthy. A clinical instrument, not a consumer wellness app. The interface should disappear into the task; confidence comes from density done well, not decoration. Identity is carried by the self-made logo and its muted brick red, never by visual noise.

## Anti-references

- Consumer health-app aesthetics: gradients, glassmorphism, rounded-blob illustrations, motivational copy
- SaaS dashboard clichés: hero metrics with gradient accents, identical icon-card grids, eyebrow labels over every section
- Cream/beige "warm neutral" body backgrounds
- Hospital-portal legacy UI: dense unstyled tables, system-blue links, modal pileups

## Design principles

1. The tool disappears into the task: earned familiarity over novelty, standard affordances everywhere
2. One interface, every device: same information architecture on phone and desktop; adaptation is rethinking layout and input, never hiding capability
3. Touch is a first-class input: 44px targets, gestures where they map to expectation (pinch, scrub, swipe), no hover-only affordances
4. Data earns the space: density where users scan (tables, timelines), progressive disclosure where they focus (detail editors, settings)
5. The share surface is a security boundary first: no redesign may widen the doctor-side input surface or weaken the no-download posture

## Accessibility and inclusion

- WCAG AA: body text >= 4.5:1, large text and non-text UI >= 3:1, visible focus indicators
- Full keyboard operability on desktop; logical focus order in drawers, sheets, and dialogs
- prefers-reduced-motion honored globally
- Viewport zoom never disabled; form inputs sized to avoid iOS focus auto-zoom
- Dark and light themes, following the OS until the user chooses
