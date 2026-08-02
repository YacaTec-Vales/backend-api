// @ts-check
import eslint from '@eslint/js';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['eslint.config.mjs'],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  eslintPluginPrettierRecommended,
  {
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
      sourceType: 'commonjs',
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-floating-promises': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      "prettier/prettier": ["error", { endOfLine: "auto" }],
    },
  },
  // Tests: relajar unbound-method (Jest extrae metodos al spyOn, perdiendo `this`)
  // y require-await para no contaminar la productividad de la suite con ruido
  // que no aplica a runtime. La proteccion real se mantiene en src/**.
  {
    files: ['src/**/*.spec.ts', 'test/**/*.ts'],
    rules: {
      // Jest extrae metodos al spyOn, perdiendo `this`; en runtime
      // no aplica. La proteccion real se mantiene en src/**.
      '@typescript-eslint/unbound-method': 'off',
      // En tests hay wrappers como `async () => fn` que TS marca
      // como require-await aunque la implementacion sincrona
      // del wrapper no necesita await.
      '@typescript-eslint/require-await': 'off',
      // En tests y mocks, `any` es legitimo (jest.Mocked, factories
      // de datos, helpers de testing). En src/** estas reglas
      // siguen siendo errores.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
    },
  },
);
