import { useEffect, useState } from "react";
import {
  Eye, EyeOff, Plus, Trash2, Star, Calendar, Tag as TagIcon,
  Wand2, KeyRound,
} from "lucide-react";
import { useStore } from "../store";
import { CATEGORIES } from "../lib/types";
import type { Credential, CustomField } from "../lib/types";
import { Modal, Field, ModalActions, inputCls } from "./AppShellShared";
import { PasswordGenerator } from "./PasswordGenerator";
import { toast, asError } from "../lib/toast";

interface Props {
  credential: Credential | null;
  onClose: () => void;
}

export function CredentialModal({ credential, onClose }: Props) {
  const { createCredential, updateCredential, activeProjectId } = useStore();
  const [title, setTitle] = useState(credential?.title ?? "");
  const [username, setUsername] = useState(credential?.username ?? "");
  const [secret, setSecret] = useState(credential?.secret ?? "");
  const [url, setUrl] = useState(credential?.url ?? "");
  const [notes, setNotes] = useState(credential?.notes ?? "");
  const [category, setCategory] = useState(credential?.category ?? "login");
  const [tags, setTags] = useState<string[]>(credential?.tags ?? []);
  const [tagInput, setTagInput] = useState("");
  const [favorite, setFavorite] = useState(credential?.favorite ?? false);
  const [totp, setTotp] = useState(credential?.totp_secret ?? "");
  const [customFields, setCustomFields] = useState<CustomField[]>(
    credential?.custom_fields ?? [],
  );
  const [expiry, setExpiry] = useState(credential?.expiry_date ?? "");
  const [showSecret, setShowSecret] = useState(false);
  const [showGen, setShowGen] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(
    Boolean(
      credential &&
        (credential.totp_secret ||
          (credential.custom_fields && credential.custom_fields.length > 0) ||
          credential.expiry_date),
    ),
  );
  const [busy, setBusy] = useState(false);

  // Adjust UX based on category — some categories don't need username/secret.
  const isNote = category === "note";
  const isCard = category === "card";
  const isCrypto = category === "crypto";

  useEffect(() => {
    if (isCard && customFields.length === 0) {
      setCustomFields([
        { label: "Card Number", value: "", secret: true },
        { label: "Expiry", value: "", secret: false },
        { label: "CVV", value: "", secret: true },
        { label: "Holder Name", value: "", secret: false },
      ]);
    }
    if (isCrypto && customFields.length === 0) {
      setCustomFields([
        { label: "Wallet Address", value: "", secret: false },
        { label: "Network", value: "", secret: false },
      ]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !activeProjectId) return;
    setBusy(true);
    try {
      const input = {
        title: title.trim(),
        username,
        secret,
        url,
        notes,
        category,
        tags,
        favorite,
        totp_secret: totp,
        custom_fields: customFields.filter((f) => f.label.trim() || f.value.trim()),
        expiry_date: expiry,
      };
      if (credential) await updateCredential(credential.id, input);
      else await createCredential(activeProjectId, input);
      onClose();
    } catch (e) {
      toast.error(asError(e));
    } finally {
      setBusy(false);
    }
  };

  const addTag = () => {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags([...tags, t]);
    setTagInput("");
  };

  const removeTag = (t: string) => setTags(tags.filter((x) => x !== t));

  const addField = () =>
    setCustomFields([...customFields, { label: "", value: "", secret: false }]);
  const removeField = (i: number) =>
    setCustomFields(customFields.filter((_, idx) => idx !== i));
  const updateField = (i: number, patch: Partial<CustomField>) =>
    setCustomFields(customFields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));

  return (
    <Modal title={credential ? "Edit Credential" : "New Credential"} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
        <div className="col-span-2 flex items-end gap-2">
          <div className="flex-1">
            <Field label="Title">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Production DB Password"
                className={inputCls}
              />
            </Field>
          </div>
          <button
            type="button"
            onClick={() => setFavorite((v) => !v)}
            title={favorite ? "Unfavorite" : "Favorite"}
            className={`mb-0.5 flex h-9 w-9 items-center justify-center rounded-lg border transition ${
              favorite
                ? "border-amber-400 bg-amber-400/10 text-amber-500"
                : "border-slate-200 bg-slate-100 text-slate-400 hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600"
            }`}
          >
            <Star className={`h-4 w-4 ${favorite ? "fill-amber-500" : ""}`} />
          </button>
        </div>

        <Field label="Category">
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={inputCls}
          >
            {CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </Field>

        {!isNote && (
          <Field label={isCard ? "Cardholder Name" : isCrypto ? "Wallet Name" : "Username / Key Name"}>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={isCard ? "John Doe" : "username or key name"}
              className={inputCls}
            />
          </Field>
        )}

        {!isNote && (
          <div className="col-span-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {isCrypto ? "Seed Phrase" : "Secret / Password / Value"}
              </label>
              <button
                type="button"
                onClick={() => setShowGen((s) => !s)}
                className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
              >
                <Wand2 className="h-3 w-3" />
                {showGen ? "Hide generator" : "Generate"}
              </button>
            </div>
            <div className="relative">
              {isCrypto ? (
                <textarea
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="word1 word2 word3 ..."
                  rows={3}
                  className={`${inputCls} font-mono`}
                />
              ) : (
                <input
                  type={showSecret ? "text" : "password"}
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="secret value"
                  className={`${inputCls} pr-10 font-mono`}
                />
              )}
              {!isCrypto && (
                <button
                  type="button"
                  onClick={() => setShowSecret((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                >
                  {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              )}
            </div>
            {showGen && (
              <div className="mt-2">
                <PasswordGenerator onUse={(pw) => { setSecret(pw); setShowGen(false); }} />
              </div>
            )}
          </div>
        )}

        <div className="col-span-2">
          <Field label={isCard ? "Issuer / Bank" : isNote ? "Reference URL (optional)" : "URL"}>
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={isCard ? "Acme Bank" : "https://..."}
              className={inputCls}
            />
          </Field>
        </div>

        <div className="col-span-2">
          <Field label={isNote ? "Note Body" : "Notes"}>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder={isNote ? "Securely-stored note text" : "Any additional notes"}
              rows={isNote ? 6 : 2}
              className={`${inputCls} resize-none`}
            />
          </Field>
        </div>

        {/* Tags */}
        <div className="col-span-2">
          <Field label="Tags">
            <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-slate-100 border border-slate-200 px-2 py-1.5 dark:bg-slate-700/60 dark:border-slate-600/40">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 rounded-full bg-indigo-500/15 px-2 py-0.5 text-[11px] text-indigo-700 dark:text-indigo-300"
                >
                  <TagIcon className="h-2.5 w-2.5" />
                  {t}
                  <button type="button" onClick={() => removeTag(t)} className="text-indigo-500/70 hover:text-indigo-500">
                    ×
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag();
                  } else if (e.key === "Backspace" && !tagInput && tags.length) {
                    removeTag(tags[tags.length - 1]);
                  }
                }}
                placeholder={tags.length ? "" : "Type a tag and press Enter"}
                className="flex-1 min-w-[100px] bg-transparent text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none dark:text-slate-200 dark:placeholder:text-slate-500"
              />
            </div>
          </Field>
        </div>

        {/* Advanced toggle */}
        <div className="col-span-2">
          <button
            type="button"
            onClick={() => setShowAdvanced((s) => !s)}
            className="text-xs text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
          >
            {showAdvanced ? "Hide" : "Show"} advanced (2FA, expiry, custom fields)
          </button>
        </div>

        {showAdvanced && (
          <>
            <div className="col-span-2">
              <Field
                label="TOTP / 2FA Secret (base32)"
                hint="Leave empty if this credential doesn't have 2FA."
              >
                <div className="relative">
                  <input
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    placeholder="JBSWY3DPEHPK3PXP"
                    className={`${inputCls} pr-10 font-mono`}
                  />
                  <KeyRound className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                </div>
              </Field>
            </div>

            <Field label="Expiry / Renewal Date">
              <div className="relative">
                <input
                  type="date"
                  value={expiry}
                  onChange={(e) => setExpiry(e.target.value)}
                  className={`${inputCls} pr-10`}
                />
                <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400 pointer-events-none" />
              </div>
            </Field>

            <div /> {/* grid spacer */}

            <div className="col-span-2">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-medium text-slate-500 dark:text-slate-400">
                  Custom Fields
                </label>
                <button
                  type="button"
                  onClick={addField}
                  className="flex items-center gap-1 text-[11px] text-indigo-600 hover:text-indigo-500 dark:text-indigo-400"
                >
                  <Plus className="h-3 w-3" /> Add field
                </button>
              </div>
              <div className="space-y-2">
                {customFields.map((f, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      placeholder="Label"
                      value={f.label}
                      onChange={(e) => updateField(i, { label: e.target.value })}
                      className={`${inputCls} w-1/3`}
                    />
                    <input
                      type={f.secret ? "password" : "text"}
                      placeholder="Value"
                      value={f.value}
                      onChange={(e) => updateField(i, { value: e.target.value })}
                      className={`${inputCls} flex-1 font-mono`}
                    />
                    <button
                      type="button"
                      onClick={() => updateField(i, { secret: !f.secret })}
                      title={f.secret ? "Reveal" : "Hide"}
                      className="rounded-md p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                    >
                      {f.secret ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeField(i)}
                      className="rounded-md p-2 text-slate-400 hover:bg-red-100 hover:text-red-500 dark:hover:bg-red-500/10 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
                {customFields.length === 0 && (
                  <p className="text-xs text-slate-400 italic dark:text-slate-500">
                    No custom fields yet.
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        <div className="col-span-2">
          <ModalActions
            onClose={onClose}
            submitLabel={busy ? "Saving..." : credential ? "Save Changes" : "Create"}
          />
        </div>
      </form>
    </Modal>
  );
}
