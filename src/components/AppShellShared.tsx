import { X } from "lucide-react";

export const inputCls =
  "w-full rounded-lg bg-slate-100 border border-slate-200 px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition dark:bg-slate-700/60 dark:border-slate-600/40 dark:text-white dark:placeholder:text-slate-500";

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium text-slate-500 dark:text-slate-400">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-slate-400 dark:text-slate-500">{hint}</p>}
    </div>
  );
}

export function Modal({
  title, onClose, children, wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm dark:bg-black/70"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className={`max-h-[90vh] w-full overflow-y-auto ${wide ? "max-w-2xl" : "max-w-md"} rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl dark:bg-slate-800 dark:border-slate-700/50`}>
        <div className="mb-5 flex items-center justify-between">
          <h2 className="font-semibold text-slate-900 dark:text-white">{title}</h2>
          <button onClick={onClose}
            className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ModalActions({
  onClose, submitLabel, icon,
}: {
  onClose: () => void;
  submitLabel: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex justify-end gap-2 pt-1">
      <button type="button" onClick={onClose}
        className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200">
        Cancel
      </button>
      <button type="submit"
        className="flex items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 px-4 py-2 text-sm font-medium text-white transition shadow-lg shadow-indigo-500/20">
        {icon}
        {submitLabel}
      </button>
    </div>
  );
}
