import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./onboarding.css";
import "./website.css";
import "./developer-demo.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
