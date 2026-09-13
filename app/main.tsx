import { createRoot } from "react-dom/client";
import { ThemeProvider } from "next-themes";

import { App } from "./App";
import { WelcomeScreen } from "../components/chrome/WelcomeScreen";

// The welcome window loads this same bundle with ?view=welcome. It renders a
// self-contained screen and mounts NONE of App's document hooks (which assume
// an open document), keeping it clear of the document lifecycle entirely.
const isWelcome =
  new URLSearchParams(window.location.search).get("view") === "welcome";

// Styles (incl. chessground base css) come from app.css, built from
// styles/globals.css by the PostCSS/Tailwind pass in build-renderer.

// Theme mechanism: next-themes flips the `class` attribute on <html> between
// "light"/"dark" (system-aware), which the token palettes in globals.css key
// off. Dark is the default, matching index.html's initial class so the first
// paint does not flash.
const root = document.getElementById("root");

if (root) {
  createRoot(root).render(
    <ThemeProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem
      themes={["light", "dark"]}
    >
      {isWelcome ? <WelcomeScreen /> : <App />}
    </ThemeProvider>,
  );
}
