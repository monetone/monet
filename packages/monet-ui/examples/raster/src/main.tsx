import { createRoot } from "react-dom/client";
import "@monet-ui/monet-core/index.css";
import { MonetProvider } from "@monet-ui/monet-react";
import { App } from "./App";

createRoot(document.getElementById("root")!).render(
  <MonetProvider>
    <App />
  </MonetProvider>,
);
