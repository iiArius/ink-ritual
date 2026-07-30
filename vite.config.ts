import vinext from "vinext";
import { defineConfig } from "vite";

export default defineConfig({
  base: process.env.GITHUB_ACTIONS === "true" ? "/ink-ritual/" : "/",
  plugins: [vinext()],
});
