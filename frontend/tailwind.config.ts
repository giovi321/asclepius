import type { Config } from "tailwindcss";
import tailwindAnimate from "tailwindcss-animate";
import plugin from "tailwindcss/plugin";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
          hover: "hsl(var(--primary-hover) / <alpha-value>)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
          soft: "hsl(var(--destructive-soft) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        popover: {
          DEFAULT: "hsl(var(--popover) / <alpha-value>)",
          foreground: "hsl(var(--popover-foreground) / <alpha-value>)",
        },
        surface: {
          DEFAULT: "hsl(var(--surface) / <alpha-value>)",
          foreground: "hsl(var(--surface-foreground) / <alpha-value>)",
        },
        success: {
          DEFAULT: "hsl(var(--success) / <alpha-value>)",
          soft: "hsl(var(--success-soft) / <alpha-value>)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning) / <alpha-value>)",
          soft: "hsl(var(--warning-soft) / <alpha-value>)",
        },
        info: {
          DEFAULT: "hsl(var(--info) / <alpha-value>)",
          soft: "hsl(var(--info-soft) / <alpha-value>)",
        },
        cat: {
          violet: "hsl(var(--cat-violet) / <alpha-value>)",
          "violet-soft": "hsl(var(--cat-violet-soft) / <alpha-value>)",
          teal: "hsl(var(--cat-teal) / <alpha-value>)",
          "teal-soft": "hsl(var(--cat-teal-soft) / <alpha-value>)",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      boxShadow: {
        raised: "var(--shadow-1)",
        overlay: "var(--shadow-2)",
        floating: "var(--shadow-3)",
      },
      /* Semantic stacking scale — never use arbitrary z-[...] values.
         sticky < dropdown < fab < bar < drawer < overlay < toast < tooltip */
      zIndex: {
        sticky: "10",
        dropdown: "20",
        fab: "25",
        bar: "30",
        drawer: "40",
        overlay: "50",
        toast: "60",
        tooltip: "70",
      },
      transitionTimingFunction: {
        out: "var(--ease-out)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "200ms",
        slow: "250ms",
      },
    },
  },
  plugins: [
    tailwindAnimate,
    plugin(({ addVariant, addUtilities }) => {
      // Input-capability variants: style for the pointer the user actually
      // has, not the viewport width.
      addVariant("coarse", "@media (pointer: coarse)");
      addVariant("fine", "@media (pointer: fine)");
      addVariant("can-hover", "@media (hover: hover)");
      addVariant("no-hover", "@media (hover: none)");
      addUtilities({
        ".pt-safe": { paddingTop: "env(safe-area-inset-top)" },
        ".pb-safe": { paddingBottom: "env(safe-area-inset-bottom)" },
        ".pl-safe": { paddingLeft: "env(safe-area-inset-left)" },
        ".pr-safe": { paddingRight: "env(safe-area-inset-right)" },
      });
    }),
  ],
} satisfies Config;
