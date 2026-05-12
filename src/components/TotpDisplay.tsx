import { useEffect, useState } from "react";
import { Copy, Check, RefreshCw } from "lucide-react";
import { api } from "../lib/api";

interface Props {
  credentialId: number;
}

export function TotpDisplay({ credentialId }: Props) {
  const [code, setCode] = useState<string>("");
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string>("");
  const [copied, setCopied] = useState(false);

  const refresh = async () => {
    try {
      const r = await api.totpForCredential(credentialId);
      setCode(r.code);
      setRemaining(Number(r.remaining_seconds));
      setError("");
    } catch (e) {
      setError(typeof e === "string" ? e : (e as Error).message);
    }
  };

  useEffect(() => {
    refresh();
    const t = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          refresh();
          return 30;
        }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [credentialId]);

  if (error) return null;

  const copy = async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const pct = (remaining / 30) * 100;
  return (
    <div className="flex items-center gap-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1">
      <span className="text-[10px] uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
        2FA
      </span>
      <code className="font-mono text-sm tracking-wider text-emerald-700 dark:text-emerald-300">
        {code ? `${code.slice(0, 3)} ${code.slice(3)}` : "------"}
      </code>
      <div className="relative h-3 w-3 shrink-0">
        <svg className="h-3 w-3 -rotate-90" viewBox="0 0 12 12">
          <circle cx="6" cy="6" r="5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5" className="text-emerald-500" />
          <circle
            cx="6"
            cy="6"
            r="5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-emerald-500"
            strokeDasharray={2 * Math.PI * 5}
            strokeDashoffset={2 * Math.PI * 5 * (1 - pct / 100)}
            strokeLinecap="round"
          />
        </svg>
      </div>
      <button onClick={copy} title="Copy code" className="text-emerald-600/70 hover:text-emerald-700 dark:text-emerald-400/70 dark:hover:text-emerald-300">
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
      <button onClick={refresh} title="Refresh" className="text-emerald-600/70 hover:text-emerald-700 dark:text-emerald-400/70 dark:hover:text-emerald-300">
        <RefreshCw className="h-3 w-3" />
      </button>
    </div>
  );
}
