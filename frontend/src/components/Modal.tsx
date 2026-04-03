import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
    open: boolean;
    onClose: () => void;
    title: string;
    description?: string;
    icon?: React.ReactNode;
    children: React.ReactNode;
    footer?: React.ReactNode;
    maxWidth?: string;
}

export default function Modal({
    open,
    onClose,
    title,
    description,
    icon,
    children,
    footer,
    maxWidth = "max-w-2xl",
}: ModalProps) {
    if (!open) return null;

    const modal = (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                onClick={onClose}
                aria-hidden={true}
            />

            {/* Modal Container */}
            <div
                className={`relative bg-zinc-900 border border-zinc-800 rounded-lg shadow-2xl w-full ${maxWidth} flex flex-col max-h-[80vh] overflow-hidden`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50 shrink-0">
                    <div className="flex items-center gap-3">
                        {icon && <div className="shrink-0">{icon}</div>}
                        <div>
                            <h2 className="text-lg font-bold text-zinc-100 tracking-tight leading-none">
                                {title}
                            </h2>
                            {description && (
                                <p className="text-xs text-zinc-500 font-medium mt-1 leading-none">
                                    {description}
                                </p>
                            )}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-400 transition-colors"
                        aria-label="Close"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Body Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar">
                    {children}
                </div>

                {/* Footer */}
                {footer && (
                    <div className="p-4 border-t border-zinc-800 bg-zinc-900/80 shrink-0">
                        {footer}
                    </div>
                )}
            </div>
        </div>
    );

    if (typeof document !== "undefined") {
        return createPortal(modal, document.body);
    }

    return modal;
}
