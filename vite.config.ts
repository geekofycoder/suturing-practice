import { defineConfig } from 'vite';

// Relative paths, so the built site works at the root of a domain and under a sub-path such as /suturing-practice/.
export default defineConfig({ base: './' });
