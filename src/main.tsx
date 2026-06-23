import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/press-start-2p";
import "@fontsource/tiny5";
import "@fontsource/vt323";
import "./styles.css";
import App from "./App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
