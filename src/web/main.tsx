// Browser entry: styles and fonts, then the app; `boot()` loads app info and settings and picks the route.

import { createRoot } from "react-dom/client";
import { App } from "./App";
import { boot } from "./state/session";
import "./styles/index.css";

createRoot(document.getElementById("root")!).render(<App />);
void boot();
