import { useEffect } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { useStore } from "@/store";
import JoinPage from "@/features/auth/JoinPage";
import ArenaPage from "@/features/student/ArenaPage";
import DashboardPage from "@/features/instructor/DashboardPage";
import { Toaster } from "react-hot-toast";

/**
 * Main Application Component.
 *
 * We include BrowserRouter here to provide context for all routing hooks
 * (useNavigate, useLocation, etc.) used within the feature components.
 * Session hydration is performed on mount to restore state from localStorage.
 */
function App() {
    const hydrateSession = useStore((state) => state.hydrateSession);

    useEffect(() => {
        // Restore user session and token from localStorage on initial load
        hydrateSession();
    }, [hydrateSession]);

    return (
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<JoinPage />} />
                <Route path="/arena" element={<ArenaPage />} />
                <Route path="/dashboard" element={<DashboardPage />} />
            </Routes>
            <Toaster
                position="top-right"
                toastOptions={{
                    // Default options for all toasts
                    duration: 4000,
                    style: {
                        background: "#0f1720", // dark slate similar to app background
                        color: "#e5e7eb", // light text
                        border: "1px solid #27272a", // subtle border
                        boxShadow: "0 6px 18px rgba(2,6,23,0.7)",
                        padding: "10px 14px",
                        fontSize: "13px",
                    },
                    // Variants for success / error
                    success: {
                        iconTheme: {
                            primary: "#16a34a",
                            secondary: "#052e16",
                        },
                    },
                    error: {
                        iconTheme: {
                            primary: "#ef4444",
                            secondary: "#2b0505",
                        },
                    },
                }}
            />
        </BrowserRouter>
    );
}

export default App;
