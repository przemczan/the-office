import "@the-office/ui/styles.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app.tsx";

const root = document.getElementById("root");
if (root === null) throw new Error("index.html has no #root to render The Office into.");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
