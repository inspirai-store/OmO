import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ThumbnailHost } from "./viewers/ModelViewer";
import "./style.css";
import "./client-theme.css";
import { AppearanceProvider } from "./Appearance";
import { SkinRenderHost } from "./SkinRenderHost";
import "./skins-client.css";
const root = createRoot(document.getElementById("root")!);
window.workshop.onEvent((event) => {
  if (event.type === "app.shutdown") root.unmount();
});
root.render(location.hash === "#thumbnail" ? <ThumbnailHost /> : location.hash === "#skin-render" ? <SkinRenderHost /> : <AppearanceProvider><App /></AppearanceProvider>);
