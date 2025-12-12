import { createRoot } from "react-dom/client";
import "../index.css";
import "../utils/theme.css";
import "../codicon.css";
import App from "../App";

const root = createRoot(document.getElementById("root")!);
root.render(<App />);
