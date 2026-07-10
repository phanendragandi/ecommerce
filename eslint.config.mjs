import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [...compat.extends("next/core-web-vitals")];

// --- Work around FlatCompat not covering .jsx by default ------------------
// eslint-config-next's base rules (react/react-hooks/next) are declared as a
// classic .eslintrc config with no `overrides[].files`, so FlatCompat emits
// them with no `files` key at all. Under ESLint 9 flat config, an entry with
// no `files` only matches `**/*.js`, `**/*.mjs`, `**/*.cjs` by default — NOT
// `.jsx` — unlike legacy eslintrc, which inferred JSX support from
// `parserOptions.ecmaFeatures.jsx`. Left unfixed, this silently skips linting
// every .jsx file in the project (i.e. almost this entire app) while still
// reporting "no warnings or errors". Only the TypeScript override
// (`**/*.ts?(x)`) declares its own `files`, so it's unaffected. Explicitly
// widen every otherwise-unscoped entry to also cover .jsx (and .tsx, for
// forward compatibility even though this project is JS-only today).
for (const entry of eslintConfig) {
  if (!entry.files && !entry.ignores) {
    entry.files = ["**/*.js", "**/*.jsx", "**/*.mjs", "**/*.cjs", "**/*.ts", "**/*.tsx"];
  }
}

// --- Work around a shipped eslint-config-next bug (Next 15.1.x) -----------
// eslint-config-next/parser.js re-exports only `{ parse, parseForESLint }`
// from the Babel parser, with no `name`/`meta` — fine for classic .eslintrc
// (`parser: './parser.js'` is just a lazily-resolved string there), but once
// FlatCompat embeds the *resolved object* into `languageOptions.parser` for
// flat config, ESLint 9's internal config serializer (used by Next's lint
// runner to build its config cache key) can't identify the parser and
// throws `Cannot serialize key "parse" in parser: Function values are not
// supported.` — silently aborting `next build`'s lint step (build still
// exits 0). Root cause: https://github.com/vercel/next.js/issues/64409 —
// no fix released for 15.1.x without bumping to a newer Next/eslint-config-next.
// Give any parser that's missing identity metadata a synthetic `meta` so
// ESLint can serialize a reference to it instead of trying to serialize the
// function values themselves. Safe no-op once upstream ships a fix (only
// patches parsers that are missing `name`/`meta` in the first place).
for (const entry of eslintConfig) {
  const parser = entry.languageOptions?.parser;
  if (parser && typeof parser === "object" && !parser.name && !parser.meta) {
    entry.languageOptions.parser = {
      ...parser,
      meta: { name: "eslint-config-next/parser", version: "0.0.0" },
    };
  }
}

export default eslintConfig;
