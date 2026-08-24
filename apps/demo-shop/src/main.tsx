import React from "react";
import ReactDOM from "react-dom/client";
import CrashLens from "@ash_rafhamid/crashlens-browser-sdk";
import App from "./App";
import "./styles.css";

CrashLens.init({
  apiKey: import.meta.env.VITE_CRASHLENS_API_KEY ?? "crashlens_demo_key_12345",
  dsn: import.meta.env.VITE_CRASHLENS_API_URL ?? "http://localhost:4000",
  release: import.meta.env.VITE_RELEASE ?? "3.2.0",
  environment: "production-demo",
  debug: true
});
CrashLens.setUser(`demo-user-${Math.floor(Math.random() * 20) + 1}`);
CrashLens.setContext({ shop: "Cartly", region: "BD" });

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
