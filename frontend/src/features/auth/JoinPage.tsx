import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useStore, type Role } from "@/store";
import { User, KeyRound, ArrowRight, Shield } from "lucide-react";
import logo from "@/assets/concurrency-arena.png";
import { clearSession, getSession } from "@/lib/storage";

/**
 * Prefetch helper: warms the Monaco initialization in the background without
 * blocking JoinPage load. Uses requestIdleCallback when available and falls
 * back to a delayed setTimeout. initMonaco is idempotent so repeated calls
 * are safe.
 */
function prefetchMonacoOnIdle() {
    if (typeof window === "undefined") return;
    const schedule = (cb: () => void) => {
        if ("requestIdleCallback" in window) {
            return window.requestIdleCallback(cb, { timeout: 2000 });
        }
        return globalThis.setTimeout(cb, 1500);
    };

    schedule(async () => {
        try {
            const m = await import("@/services/monaco/initMonaco");
            await m.initMonaco();
            // Debug success so we can verify prefetch worked in logs.
            console.debug("Monaco prefetch completed");
        } catch (err) {
            console.debug("Monaco prefetch failed:", err);
        }
    });
}

export default function JoinPage() {
    const navigate = useNavigate();
    const setSession = useStore((state) => state.setSession);

    // Hydrate session from localStorage on mount
    useEffect(() => {
        const session = getSession();
        if (session) {
            try {
                setSession(session);
                if (session.role === "Instructor") {
                    navigate("/dashboard");
                } else {
                    navigate("/arena");
                }
            } catch (e) {
                console.error("Failed to parse saved session:", e);
                clearSession();
            }
        }

        // Warm Monaco in the background on JoinPage; this is safe and idempotent
        // and will not interfere with initial interactive load.
        try {
            prefetchMonacoOnIdle();
        } catch {
            // Swallow to avoid impacting JoinPage
        }
    }, [navigate, setSession]);

    const [name, setName] = useState("");
    const [role, setRole] = useState<Role>("Student");
    const [roomSecret, setRoomSecret] = useState("");
    const [error, setError] = useState("");
    const [isLoading, setIsLoading] = useState(false);

    const backendBase = import.meta?.env?.VITE_BACKEND_URL ?? "";

    // Cloudflare Access identity (only present when coming through the tunnel)
    type Identity = { email?: string; suggestedName?: string; currentName?: string };
    const [identity, setIdentity] = useState<Identity | null>(null);

    const join = useCallback(
        async (joinName: string, joinRole: Role, secret: string) => {
            setError("");
            setIsLoading(true);
            try {
                const response = await fetch(`${backendBase}/api/join`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        name: joinName.trim(),
                        role: joinRole,
                        roomSecret: joinRole === "Instructor" ? secret.trim() : "",
                    }),
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(errorText.trim() || "Failed to join");
                }

                const data = await response.json();

                // Save session to Zustand store (also persisted)
                setSession({ token: data.token, name: data.name, role: joinRole });

                sessionStorage.setItem("arena_token", data.token);
                sessionStorage.setItem("arena_name", data.name);
                sessionStorage.setItem("arena_role", joinRole);

                navigate(joinRole === "Instructor" ? "/dashboard" : "/arena");
            } catch (err) {
                setError(
                    err instanceof Error
                        ? err.message
                        : "Something went wrong. Is the server running?",
                );
            } finally {
                setIsLoading(false);
            }
        },
        [backendBase, navigate, setSession],
    );

    // Ask the server who Cloudflare says we are. If this email already plays
    // under a name, rejoin with it automatically (new device, cleared storage).
    useEffect(() => {
        if (getSession()) return;
        let cancelled = false;
        fetch(`${backendBase}/api/whoami`)
            .then((r) => (r.ok ? r.json() : {}))
            .then((who: Identity) => {
                if (cancelled || !who?.email) return;
                setIdentity(who);
                if (who.currentName) join(who.currentName, "Student", "");
            })
            .catch(() => {
                // No identity endpoint / not behind Cloudflare: plain name login
            });
        return () => {
            cancelled = true;
        };
    }, [backendBase, join]);

    const handleSubmit = async (e: React.SubmitEvent) => {
        e.preventDefault();
        if (!name.trim()) {
            setError("Please enter your name.");
            return;
        }
        if (role === "Instructor" && !roomSecret.trim()) {
            setError("Admin secret is required.");
            return;
        }
        await join(name, role, roomSecret);
    };

    return (
        <div className="min-h-screen bg-zinc-950 flex flex-col justify-center items-center p-4 text-zinc-100 font-sans">
            <div className="max-w-md w-full bg-zinc-900 border border-zinc-800 rounded-lg p-8">
                <div className="text-center mb-8">
                    <img
                        src={logo}
                        alt="Concurrency Arena"
                        className="mx-auto h-36 w-auto mb-3"
                    />
                    <h1 className="text-2xl font-semibold text-zinc-100 mb-2">
                        Concurrency Arena
                    </h1>
                    <p className="text-zinc-400 text-sm">Join the session</p>
                </div>

                {error && (
                    <div className="mb-6 p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-lg text-sm text-center">
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-5">
                    {/* Role Selection */}
                    <div className="grid grid-cols-2 gap-3">
                        <button
                            type="button"
                            onClick={() => setRole("Student")}
                            className={`py-2 px-4 rounded-md flex items-center justify-center gap-2 text-sm font-medium transition-colors border ${
                                role === "Student"
                                    ? "bg-blue-900/20 border-blue-500/50 text-blue-400"
                                    : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                            }`}
                        >
                            <User size={18} />
                            Player
                        </button>
                        <button
                            type="button"
                            onClick={() => setRole("Instructor")}
                            className={`py-2 px-4 rounded-md flex items-center justify-center gap-2 text-sm font-medium transition-colors border ${
                                role === "Instructor"
                                    ? "bg-emerald-900/20 border-emerald-500/50 text-emerald-400"
                                    : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-300"
                            }`}
                        >
                            <Shield size={18} />
                            Admin
                        </button>
                    </div>

                    {/* Enter with the Cloudflare identity */}
                    {role === "Student" && identity?.suggestedName && (
                        <div className="space-y-2">
                            <button
                                type="button"
                                disabled={isLoading}
                                onClick={() => join(identity.suggestedName!, "Student", "")}
                                className="w-full py-2 px-4 rounded-md flex items-center justify-center gap-2 text-sm font-medium transition-colors border bg-blue-600 border-blue-600 text-white hover:bg-blue-500 disabled:opacity-60"
                            >
                                Enter as {identity.suggestedName}
                                <ArrowRight size={16} />
                            </button>
                            <p className="text-center text-xs text-zinc-500">
                                Signed in as {identity.email}
                            </p>
                        </div>
                    )}

                    {/* Name Input */}
                    <div className="space-y-1.5">
                        <label className="text-sm font-medium text-zinc-400 block ml-1">
                            {role === "Student" && identity?.suggestedName
                                ? "…or choose a display name"
                                : "Display Name"}
                        </label>
                        <div className="relative">
                            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                                <User size={18} />
                            </div>
                            <input
                                type="text"
                                value={name}
                                onChange={(e) => setName(e.target.value)}
                                placeholder="Name..."
                                className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-md pl-10 pr-4 py-2 focus:outline-none focus:border-blue-500/50 transition-colors placeholder:text-zinc-600"
                            />
                        </div>
                    </div>

                    {/* Instructor Secret Input (Conditional) */}
                    {role === "Instructor" && (
                        <div className="space-y-1.5">
                            <label className="text-sm font-medium text-zinc-400 block ml-1">
                                Admin Secret
                            </label>
                            <div className="relative">
                                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-zinc-500">
                                    <KeyRound size={18} />
                                </div>
                                <input
                                    type="password"
                                    value={roomSecret}
                                    onChange={(e) =>
                                        setRoomSecret(e.target.value)
                                    }
                                    placeholder="Secret..."
                                    className="w-full bg-zinc-950 border border-zinc-800 text-zinc-100 rounded-md pl-10 pr-4 py-2 focus:outline-none focus:border-emerald-500/50 transition-colors placeholder:text-zinc-600"
                                />
                            </div>
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        type="submit"
                        disabled={isLoading}
                        className={`w-full py-2 px-4 rounded-md flex items-center justify-center gap-2 text-sm font-medium transition-colors mt-4 border ${
                            isLoading
                                ? "bg-zinc-800 border-zinc-800 text-zinc-500 cursor-not-allowed"
                                : role === "Instructor"
                                  ? "bg-emerald-600 border-emerald-600 text-white hover:bg-emerald-500 hover:border-emerald-500"
                                  : "bg-blue-600 border-blue-600 text-white hover:bg-blue-500 hover:border-blue-500"
                        }`}
                    >
                        {isLoading ? "Connecting..." : "Enter Session"}
                        {!isLoading && <ArrowRight size={16} />}
                    </button>
                </form>
            </div>
        </div>
    );
}
