import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

/**
 * Concurrency Arena - Main Entry Point
 *
 * This file handles the mounting of the React application.
 * Complex Monaco services have been removed to ensure a stable
 * and reliable application boot process.
 */

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);
