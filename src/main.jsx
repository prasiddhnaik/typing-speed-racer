import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import TypingSpeedRacer from "../TypingSpeedRacer.jsx";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <TypingSpeedRacer />
  </StrictMode>
);
