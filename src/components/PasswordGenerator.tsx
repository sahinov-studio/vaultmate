import { useEffect, useState } from "react";
import { Copy, RefreshCw, Check } from "lucide-react";
import { api } from "../lib/api";
import { toast, asError } from "../lib/toast";

export function PasswordGenerator({ onUse }: { onUse?: (pw: string) => void }) {
  const [length, setLength] = useState(20);
  const [uppercase, setUppercase] = useState(true);
  const [lowercase, setLowercase] = useState(true);
  const [digits, setDigits] = useState(true);
  const [symbols, setSymbols] = useState(true);
  const [avoidAmbiguous, setAvoidAmbiguous] = useState(true);
  const [pw, setPw] = useState("");
  const [copied, setCopied] = useState(false);

  const generate = async () => {
    try {
      const out = await api.generatePassword({
        length,
        uppercase,
        lowercase,
        digits,
        symbols,
        avoid_ambiguous: avoidAmbiguous,
      });
      setPw(out);
    } catch (e) {
      toast.error(asError(e));
    }
  };

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [length, uppercase, lowercase, digits, symbols, avoidAmbiguous]);

  const copy = async () => {
    if (!pw) return;
    await navigator.clipboard.writeText(pw);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700/50 dark:bg-slate-900/40">
      <div className="flex items-center gap-2 rounded-lg bg-white border border-slate-200 px-3 py-2 dark:bg-slate-800 dark:border-slate-700">
        <code className="flex-1 truncate text-sm font-mono text-slate-800 dark:text-slate-200">
          {pw || "Generating..."}
        </code>
        <button
          type="button"
          onClick={generate}
          title="Regenerate"
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          <RefreshCw className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={copy}
          title="Copy"
          className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-500" /> : <Copy className="h-3.5 w-3.5" />}
        </button>
        {onUse && (
          <button
            type="button"
            onClick={() => onUse(pw)}
            className="rounded-md bg-indigo-600 px-2 py-0.5 text-[11px] font-medium text-white hover:bg-indigo-500"
          >
            Use
          </button>
        )}
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between">
          <span className="text-xs text-slate-500 dark:text-slate-400">Length</span>
          <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{length}</span>
        </div>
        <input
          type="range"
          min={8}
          max={64}
          value={length}
          onChange={(e) => setLength(Number(e.target.value))}
          className="w-full accent-indigo-500"
        />
      </div>
      <div className="grid grid-cols-2 gap-1 text-xs">
        <Opt label="A-Z" v={uppercase} on={() => setUppercase((x) => !x)} />
        <Opt label="a-z" v={lowercase} on={() => setLowercase((x) => !x)} />
        <Opt label="0-9" v={digits} on={() => setDigits((x) => !x)} />
        <Opt label="!@#$" v={symbols} on={() => setSymbols((x) => !x)} />
        <Opt label="Avoid ambiguous" v={avoidAmbiguous} on={() => setAvoidAmbiguous((x) => !x)} cols={2} />
      </div>
    </div>
  );
}

function Opt({ label, v, on, cols }: { label: string; v: boolean; on: () => void; cols?: number }) {
  return (
    <button
      type="button"
      onClick={on}
      className={`${cols === 2 ? "col-span-2" : ""} rounded-md border px-2 py-1.5 transition ${
        v
          ? "border-indigo-500/50 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300"
          : "border-slate-200 bg-white text-slate-500 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700"
      }`}
    >
      {label}
    </button>
  );
}
