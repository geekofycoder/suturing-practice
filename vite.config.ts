import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Relative paths, so the built site works at the root of a domain and under a sub-path such as /suturing-practice/.
// Two pages: the suturing practice (index.html) and the guidewire insertion practice (guidewire.html).
export default defineConfig({
  base: './',
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        guidewire: fileURLToPath(new URL('./guidewire.html', import.meta.url)),
      },
    },
  },
});
