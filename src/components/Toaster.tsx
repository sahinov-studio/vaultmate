import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { useToasts, type ToastKind } from "../lib/toast";

const ICONS: Record<ToastKind, React.ReactNode> = {
  info:    <Info className="h-4 w-4" />,
  success: <CheckCircle2 className="h-4 w-4" />,
  warning: <AlertTriangle className="h-4 w-4" />,
  error:   <XCircle className="h-4 w-4" />,
};

const STYLES: Record<ToastKind, string> = {
  info:    "bg-slate-800 border-slate-700 text-slate-100",
  success: "bg-emerald-600 border-emerald-500 text-white",
  warning: "bg-amber-600 border-amber-500 text-white",
  error:   "bg-red-600 border-red-500 text-white",
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex max-w-sm items-start gap-2.5 rounded-lg border px-3.5 py-2.5 shadow-lg animate-[slideIn_0.2s_ease-out] ${STYLES[t.kind]}`}
        >
          <span className="mt-0.5">{ICONS[t.kind]}</span>
          <p className="flex-1 text-sm leading-snug">{t.message}</p>
          <button
            onClick={() => dismiss(t.id)}
            className="text-white/70 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
      <style>{`
        @keyframes slideIn {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
      `}</style>
    </div>
  );
}
