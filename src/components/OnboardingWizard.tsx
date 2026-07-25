import { useState } from "react";
import {
  ShieldCheck, FolderKanban, KeyRound, AlertTriangle, Bot, ChevronLeft, ChevronRight,
} from "lucide-react";
import { useStore } from "../store";
import { api } from "../lib/api";
import { toast, asError } from "../lib/toast";

interface Slide {
  icon: typeof ShieldCheck;
  title: string;
  body: string;
  showInstall?: boolean;
}

const SLIDES: Slide[] = [
  {
    icon: ShieldCheck,
    title: "Welcome to VaultMate",
    body: "A local credential manager built for developers — organize API keys, tokens, and passwords by project, right on your own machine.",
  },
  {
    icon: FolderKanban,
    title: "Organize by project",
    body: "Group credentials by project, tag them by category — API Key, Token, Database, SSH, and more — star favorites, and search everything instantly.",
  },
  {
    icon: KeyRound,
    title: "Built-in tools",
    body: "Generate strong passwords, get 30-second TOTP 2FA codes without leaving the app, import from Excel/CSV, and export a password-protected backup anytime.",
  },
  {
    icon: AlertTriangle,
    title: "Your data, your machine",
    body: "VaultMate is local-only — no cloud, no analytics. By design, credentials are stored as plaintext, not encrypted, for zero-friction access. Set an optional screen-lock PIN in Settings → Security for basic on-screen privacy — full details are in Settings → Security.",
  },
  {
    icon: Bot,
    title: "Connect Claude Code",
    body: 'Let Claude Code read, create, update, and delete credentials directly — no copy-pasting secrets into chat. Install the setup skill below, then just say "connect vaultmate" in Claude Code.',
    showInstall: true,
  },
];

export function OnboardingWizard() {
  const completeOnboarding = useStore((s) => s.completeOnboarding);
  const [index, setIndex] = useState(0);
  const [installing, setInstalling] = useState(false);

  const slide = SLIDES[index];
  const Icon = slide.icon;
  const isLast = index === SLIDES.length - 1;

  const installSkill = async () => {
    setInstalling(true);
    try {
      await api.installClaudeSkill();
      toast.success('Skill installed — say "connect vaultmate" in Claude Code.');
    } catch (e) {
      toast.error(asError(e));
    } finally {
      setInstalling(false);
    }
  };

  const finish = async () => {
    try {
      await completeOnboarding();
    } catch (e) {
      toast.error(asError(e));
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-slate-100 px-4 dark:bg-slate-950">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700/50 dark:bg-slate-800">
        <div className="flex justify-end p-4 pb-0">
          <button
            onClick={finish}
            className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          >
            Skip
          </button>
        </div>

        <div className="flex flex-col items-center gap-4 px-8 pb-2 pt-2 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500/20">
            <Icon className="h-8 w-8 text-indigo-500 dark:text-indigo-400" />
          </div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{slide.title}</h1>
          <p className="text-sm leading-relaxed text-slate-500 dark:text-slate-400">{slide.body}</p>

          {slide.showInstall && (
            <button
              onClick={installSkill}
              disabled={installing}
              className="mt-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {installing ? "Installing..." : "Install Claude Code Skill"}
            </button>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between border-t border-slate-200 px-6 py-4 dark:border-slate-700/50">
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700 disabled:opacity-0 dark:text-slate-400 dark:hover:text-slate-200"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </button>

          <div className="flex gap-1.5">
            {SLIDES.map((s, i) => (
              <span
                key={s.title}
                className={`h-1.5 rounded-full transition-all ${
                  i === index ? "w-5 bg-indigo-500" : "w-1.5 bg-slate-300 dark:bg-slate-600"
                }`}
              />
            ))}
          </div>

          {isLast ? (
            <button
              onClick={finish}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              Get Started
            </button>
          ) : (
            <button
              onClick={() => setIndex((i) => Math.min(SLIDES.length - 1, i + 1))}
              className="flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
            >
              Next <ChevronRight className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
