import nextCoreWebVitals from "eslint-config-next/core-web-vitals";

const config = [
  ...nextCoreWebVitals,
  {
    rules: {
      // Legacy React 18 mount-effect patterns across existing client pages warn rather than failing CI.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  {
    ignores: [".next/**", "drizzle/**", "data/**", "test-results/**", "playwright-report/**"],
  },
];

export default config;
