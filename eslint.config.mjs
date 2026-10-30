import nextVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// Flat config for ESLint 9. Browser scripts in public/ are classic scripts and
// stay in scope; vendored libraries, build output and local data do not.
const config = [
  ...nextVitals,
  ...nextTypescript,
  {
    ignores: [
      "dist/**",
      ".next/**",
      ".vinext/**",
      ".wrangler/**",
      ".local/**",
      "output/**",
      "public/vendor/**",
    ],
  },
];

export default config;
