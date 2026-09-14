"use client";

import { useQuery } from "@tanstack/react-query";
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { useCallback, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  useCreateStrategy,
  useDeleteStrategy,
  useToggleStrategy,
  useUpdateStrategy,
} from "@/lib/mutations/strategies";
import {
  LLM_PROVIDERS,
  SIGNAL_SOURCES,
  STRATEGY_TYPES,
  type StrategyDto,
  type StrategyInput,
  strategyInputSchema,
  strategyQueries,
} from "@/lib/queries/strategies";

// -- helpers ----------------------------------------------------------------

const AVAILABLE_ASSETS = [
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "DOGE",
  "NVDA",
  "AAPL",
  "TSLA",
  "AMZN",
  "GOOGL",
];

const EMPTY_FORM: StrategyInput = {
  name: "",
  type: "MOMENTUM",
  assets: [],
  signalSources: [],
  llmProvider: "OPENAI",
  entryThreshold: 70,
  exitThreshold: 40,
  maxPositionPct: 15,
  stopLossPct: 5,
  active: true,
};

function strategyToInput(s: StrategyDto): StrategyInput {
  return {
    active: s.active,
    assets: s.assets,
    entryThreshold: s.entryThreshold,
    exitThreshold: s.exitThreshold,
    llmProvider: s.llmProvider,
    maxPositionPct: s.maxPositionPct,
    name: s.name,
    signalSources: s.signalSources,
    stopLossPct: s.stopLossPct,
    type: s.type,
  };
}

function getTypeColor(type: string) {
  switch (type) {
    case "MOMENTUM":
      return "text-terminal-green bg-terminal-green/10 border-terminal-green/20";
    case "SENTIMENT_ONLY":
      return "text-terminal-cyan bg-terminal-cyan/10 border-terminal-cyan/20";
    case "MEAN_REVERSION":
      return "text-terminal-amber bg-terminal-amber/10 border-terminal-amber/20";
    default:
      return "text-muted-foreground bg-muted border-border";
  }
}

function getProviderColor(provider: string) {
  switch (provider) {
    case "OPENAI":
      return "text-terminal-green";
    case "ANTHROPIC":
      return "text-terminal-amber";
    case "GOOGLE":
      return "text-terminal-cyan";
    case "XAI":
      return "text-terminal-gold";
    case "DEEPSEEK":
      return "text-terminal-red";
    default:
      return "text-muted-foreground";
  }
}

// -- Custom dropdown --------------------------------------------------------

function TerminalSelect({
  label,
  value,
  options,
  onChange,
  colorFn,
}: {
  label: string;
  value: string;
  options: readonly string[];
  onChange: (v: string) => void;
  colorFn?: (v: string) => string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center justify-between gap-2 border border-border bg-secondary px-3 py-1.5 text-xs text-foreground hover:border-terminal-green/40 transition-colors"
      >
        <span className={colorFn ? colorFn(value) : ""}>
          {value.replace(/_/g, " ")}
        </span>
        <ChevronDown
          className={`h-3 w-3 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="absolute top-full left-0 z-50 mt-1 w-full border border-border bg-card shadow-lg shadow-black/40">
          {options.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => {
                onChange(opt);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between px-3 py-1.5 text-xs transition-colors hover:bg-terminal-green/10 ${
                opt === value ? "text-terminal-green" : "text-foreground"
              }`}
            >
              <span className={colorFn ? colorFn(opt) : ""}>
                {opt.replace(/_/g, " ")}
              </span>
              {opt === value && (
                <Check className="h-3 w-3 text-terminal-green" />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// -- Multi-select chip picker -----------------------------------------------

function ChipPicker({
  label,
  options,
  selected,
  onChange,
}: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  function toggle(opt: string) {
    onChange(
      selected.includes(opt)
        ? selected.filter((s) => s !== opt)
        : [...selected, opt],
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => toggle(opt)}
              className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide border transition-colors ${
                active
                  ? "border-terminal-green/40 bg-terminal-green/10 text-terminal-green"
                  : "border-border bg-secondary text-muted-foreground hover:text-foreground hover:border-terminal-dim"
              }`}
            >
              {opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// -- Numeric input ----------------------------------------------------------

function TerminalInput({
  label,
  value,
  onChange,
  suffix,
  color,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  suffix?: string;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-1 border border-border bg-secondary px-3 py-1.5">
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className={`w-full bg-transparent text-xs font-bold outline-none ${color ?? "text-foreground"}`}
        />
        {suffix && (
          <span className="text-[10px] text-muted-foreground">{suffix}</span>
        )}
      </div>
    </div>
  );
}

// -- Text input -------------------------------------------------------------

function TerminalTextInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <div className="flex items-center gap-2 border border-border bg-secondary px-3 py-1.5">
        <span className="text-terminal-green text-xs">{">"}</span>
        <input
          type="text"
          value={value}
          onChange={(e) =>
            onChange(e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ""))
          }
          placeholder={placeholder}
          className="w-full bg-transparent text-xs font-bold text-foreground outline-none placeholder:text-terminal-dim"
        />
      </div>
    </div>
  );
}

// -- Delete confirmation modal ----------------------------------------------

function DeleteConfirm({
  strategy,
  onConfirm,
  onCancel,
}: {
  strategy: StrategyDto;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-md border border-terminal-red/30 bg-card">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-terminal-red/20 bg-terminal-red/5 px-4 py-2.5">
          <span className="text-xs font-bold tracking-wider text-terminal-red">
            CONFIRM DELETE
          </span>
          <button
            type="button"
            onClick={onCancel}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="p-5">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Are you sure you want to permanently delete strategy{" "}
            <span className="font-bold text-foreground">{strategy.name}</span>?
            This action cannot be undone. All associated configuration and
            linked agents will be disconnected.
          </p>
          <div className="mt-5 flex items-center gap-2">
            <button
              type="button"
              onClick={onConfirm}
              className="flex-1 bg-terminal-red py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-terminal-red/80"
            >
              Delete Strategy
            </button>
            <button
              type="button"
              onClick={onCancel}
              className="flex-1 border border-border py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground hover:border-terminal-dim"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// -- Strategy form modal ----------------------------------------------------

function StrategyFormModal({
  initial,
  title,
  onSave,
  onClose,
}: {
  initial: StrategyInput;
  title: string;
  onSave: (data: StrategyInput) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<StrategyInput>(initial);
  const [errors, setErrors] = useState<string[]>([]);

  const update = useCallback(
    <K extends keyof StrategyInput>(key: K, val: StrategyInput[K]) => {
      setForm((prev) => ({ ...prev, [key]: val }));
    },
    [],
  );

  function validate(): string[] {
    // Same contract the API enforces — validate client-side first so the
    // user gets instant feedback, then still let the server be the authority.
    const parsed = strategyInputSchema.safeParse(form);
    if (parsed.success) {
      return [];
    }
    return parsed.error.issues.map(
      (issue) =>
        `${issue.path.map(String).join(".").toUpperCase() || "FORM"}: ${issue.message}`,
    );
  }

  function handleSubmit() {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    onSave(form);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg border border-border bg-card shadow-2xl shadow-black/50">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border bg-secondary/50 px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-terminal-green animate-pulse" />
            <span className="text-xs font-bold tracking-wider text-foreground">
              {title}
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <ScrollArea className="max-h-[70vh]">
          <div className="flex flex-col gap-4 p-5">
            {/* Errors */}
            {errors.length > 0 && (
              <div className="border border-terminal-red/30 bg-terminal-red/5 px-3 py-2">
                {errors.map((e) => (
                  <p key={e} className="text-[10px] text-terminal-red">
                    {"// "}
                    {e}
                  </p>
                ))}
              </div>
            )}

            {/* Name */}
            <TerminalTextInput
              label="Strategy Name"
              value={form.name}
              onChange={(v) => update("name", v)}
              placeholder="MY_STRATEGY"
            />

            {/* Type & Provider row */}
            <div className="grid grid-cols-2 gap-3">
              <TerminalSelect
                label="Type"
                value={form.type}
                options={STRATEGY_TYPES}
                onChange={(v) => update("type", v as StrategyDto["type"])}
                colorFn={(v) => getTypeColor(v).split(" ")[0]}
              />
              <TerminalSelect
                label="LLM Provider"
                value={form.llmProvider}
                options={LLM_PROVIDERS}
                onChange={(v) =>
                  update("llmProvider", v as StrategyDto["llmProvider"])
                }
                colorFn={getProviderColor}
              />
            </div>

            {/* Assets */}
            <ChipPicker
              label="Assets"
              options={AVAILABLE_ASSETS}
              selected={form.assets}
              onChange={(v) => update("assets", v)}
            />

            {/* Signal sources */}
            <ChipPicker
              label="Signal Sources"
              options={[...SIGNAL_SOURCES]}
              selected={[...form.signalSources]}
              onChange={(v) =>
                update(
                  "signalSources",
                  v.filter((s): s is StrategyDto["signalSources"][number] =>
                    (SIGNAL_SOURCES as readonly string[]).includes(s),
                  ),
                )
              }
            />

            {/* Numeric params */}
            <div className="grid grid-cols-2 gap-3">
              <TerminalInput
                label="Entry Threshold"
                value={form.entryThreshold}
                onChange={(v) => update("entryThreshold", v)}
                color="text-terminal-green"
                suffix={">="}
              />
              <TerminalInput
                label="Exit Threshold"
                value={form.exitThreshold}
                onChange={(v) => update("exitThreshold", v)}
                color="text-terminal-amber"
                suffix={"<="}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <TerminalInput
                label="Max Position"
                value={form.maxPositionPct}
                onChange={(v) => update("maxPositionPct", v)}
                suffix="%"
              />
              <TerminalInput
                label="Stop Loss"
                value={form.stopLossPct}
                onChange={(v) => update("stopLossPct", v)}
                color="text-terminal-red"
                suffix="%"
              />
            </div>

            {/* Active toggle */}
            <div className="flex items-center justify-between border-t border-border pt-3">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Status
              </span>
              <button
                type="button"
                onClick={() => update("active", !form.active)}
                className={`flex items-center gap-2 border px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-colors ${
                  form.active
                    ? "border-terminal-green/30 bg-terminal-green/10 text-terminal-green"
                    : "border-terminal-dim/30 bg-secondary text-terminal-dim"
                }`}
              >
                <div
                  className={`h-1.5 w-1.5 rounded-full ${form.active ? "bg-terminal-green" : "bg-terminal-dim"}`}
                />
                {form.active ? "ACTIVE" : "PAUSED"}
              </button>
            </div>
          </div>
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center gap-2 border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={handleSubmit}
            className="flex-1 bg-terminal-green py-2 text-xs font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-terminal-green/80"
          >
            Save Strategy
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 border border-border py-2 text-xs font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground hover:border-terminal-dim"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// -- Strategy Card ----------------------------------------------------------

function StrategyCard({
  strategy,
  onEdit,
  onDelete,
  onToggle,
}: {
  strategy: StrategyDto;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  return (
    <div
      className={`group flex flex-col gap-3 border border-border bg-card p-4 transition-colors hover:bg-secondary/20 ${
        !strategy.active ? "opacity-50" : ""
      }`}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onToggle}
            title={strategy.active ? "Pause strategy" : "Activate strategy"}
          >
            <div
              className={`h-2 w-2 rounded-full transition-colors cursor-pointer ${strategy.active ? "bg-terminal-green" : "bg-terminal-dim hover:bg-terminal-amber"}`}
            />
          </button>
          <span className="text-sm font-bold text-foreground">
            {strategy.name}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`text-[10px] font-bold px-1.5 py-0.5 border ${getTypeColor(strategy.type)}`}
          >
            {strategy.type.replace(/_/g, " ")}
          </span>
          <span
            className={`text-[10px] font-bold ${strategy.active ? "text-terminal-green" : "text-terminal-dim"}`}
          >
            {strategy.active ? "ACTIVE" : "PAUSED"}
          </span>
          {/* Action buttons */}
          <div className="ml-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={onEdit}
              className="p-1 text-muted-foreground hover:text-terminal-cyan transition-colors"
              title="Edit"
            >
              <Pencil className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={onDelete}
              className="p-1 text-muted-foreground hover:text-terminal-red transition-colors"
              title="Delete"
            >
              <Trash2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Assets */}
      <div className="flex flex-col gap-1">
        <span className="text-[10px] text-muted-foreground tracking-wider">
          ASSETS
        </span>
        <div className="flex flex-wrap gap-1">
          {strategy.assets.map((asset) => (
            <span
              key={asset}
              className="text-[10px] font-bold px-1.5 py-0.5 bg-secondary text-foreground"
            >
              {asset}
            </span>
          ))}
        </div>
      </div>

      {/* Parameters Grid */}
      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground">ENTRY</span>
          <span className="text-xs font-bold text-terminal-green">
            {">="}
            {strategy.entryThreshold}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground">EXIT</span>
          <span className="text-xs font-bold text-terminal-amber">
            {"<="}
            {strategy.exitThreshold}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground">MAX POS</span>
          <span className="text-xs font-bold text-foreground">
            {strategy.maxPositionPct}%
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[10px] text-muted-foreground">STOP LOSS</span>
          <span className="text-xs font-bold text-terminal-red">
            {strategy.stopLossPct}%
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground border-t border-border pt-2">
        <div className="flex items-center gap-2">
          <span>SOURCES</span>
          {strategy.signalSources.map((src) => (
            <span key={src} className="text-terminal-cyan uppercase">
              {src}
            </span>
          ))}
        </div>
        <span className={`font-bold ${getProviderColor(strategy.llmProvider)}`}>
          {strategy.llmProvider}
        </span>
      </div>
    </div>
  );
}

// -- Main view --------------------------------------------------------------

export function StrategiesView() {
  const { data, isError, isPending } = useQuery(strategyQueries.list());

  const createMutation = useCreateStrategy();
  const updateMutation = useUpdateStrategy();
  const toggleMutation = useToggleStrategy();
  const deleteMutation = useDeleteStrategy();
  const mutationError =
    createMutation.error ??
    updateMutation.error ??
    toggleMutation.error ??
    deleteMutation.error;

  const [modal, setModal] = useState<
    | { mode: "create" }
    | { mode: "edit"; strategy: StrategyDto }
    | { mode: "delete"; strategy: StrategyDto }
    | null
  >(null);

  function handleCreate(input: StrategyInput) {
    createMutation.mutate(input, { onSuccess: () => setModal(null) });
  }

  function handleUpdate(input: StrategyInput) {
    if (modal?.mode !== "edit") return;
    updateMutation.mutate(
      { id: modal.strategy.id, input },
      { onSuccess: () => setModal(null) },
    );
  }

  function handleDelete() {
    if (modal?.mode !== "delete") return;
    deleteMutation.mutate(
      { id: modal.strategy.id },
      { onSuccess: () => setModal(null) },
    );
  }

  const strategies = data?.items ?? [];
  const activeCount = strategies.filter((s) => s.active).length;

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-3 py-2 sm:px-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xs font-bold tracking-wider text-foreground">
            STRATEGY MANAGER
          </h1>
          <span className="text-[10px] text-muted-foreground">
            {isPending
              ? "loading..."
              : isError
                ? "offline"
                : `${strategies.length} strategies`}
          </span>
          {!isPending && !isError && (
            <span className="text-[10px] text-terminal-green">
              {activeCount} active
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setModal({ mode: "create" })}
          className="flex items-center gap-1.5 bg-terminal-green/10 border border-terminal-green/30 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-terminal-green transition-colors hover:bg-terminal-green/20"
        >
          <Plus className="h-3 w-3" />
          New Strategy
        </button>
      </div>

      {/* Mutation error banner (optimistic updates roll back silently) */}
      {mutationError && (
        <div className="border-b border-terminal-red/30 bg-terminal-red/5 px-4 py-1.5 text-[10px] text-terminal-red">
          {"// "}
          {mutationError instanceof Error
            ? mutationError.message
            : "operation failed"}{" "}
          — retrying on next save
        </div>
      )}

      {/* Cards grid */}
      <ScrollArea className="flex-1">
        {isPending ? (
          <div className="grid grid-cols-1 gap-px p-px lg:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-40 animate-pulse bg-secondary m-px" />
            ))}
          </div>
        ) : isError ? (
          <div className="flex flex-col items-center justify-center py-20 text-terminal-red">
            <span className="text-xs uppercase tracking-wider">
              STRATEGIES DATA UNAVAILABLE — retrying
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-px p-px lg:grid-cols-2">
            {strategies.map((strategy) => (
              <StrategyCard
                key={strategy.id}
                strategy={strategy}
                onEdit={() => setModal({ mode: "edit", strategy })}
                onDelete={() => setModal({ mode: "delete", strategy })}
                onToggle={() =>
                  toggleMutation.mutate({
                    id: strategy.id,
                    active: !strategy.active,
                  })
                }
              />
            ))}
          </div>
        )}

        {!isPending && !isError && strategies.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <span className="text-xs uppercase tracking-wider">
              No strategies configured
            </span>
            <button
              type="button"
              onClick={() => setModal({ mode: "create" })}
              className="mt-3 text-xs text-terminal-green hover:underline"
            >
              Create your first strategy
            </button>
          </div>
        )}
      </ScrollArea>

      {/* Modals */}
      {modal?.mode === "create" && (
        <StrategyFormModal
          title="CREATE NEW STRATEGY"
          initial={EMPTY_FORM}
          onSave={handleCreate}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.mode === "edit" && (
        <StrategyFormModal
          title={`EDIT // ${modal.strategy.name}`}
          initial={strategyToInput(modal.strategy)}
          onSave={handleUpdate}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.mode === "delete" && (
        <DeleteConfirm
          strategy={modal.strategy}
          onConfirm={handleDelete}
          onCancel={() => setModal(null)}
        />
      )}
    </div>
  );
}
