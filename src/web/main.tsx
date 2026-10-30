import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app";
import { httpApi } from "./data/client";
import { createMockApi } from "./data/mock";
import { useStore } from "./store";
import "./styles.css";

useStore.setState({ api: import.meta.env.VITE_MW_MOCK === "1" ? createMockApi() : httpApi });
// 开发时方便在控制台里看状态
if (import.meta.env.DEV) Object.assign(window, { mw: useStore });

const root = document.getElementById("root");
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
