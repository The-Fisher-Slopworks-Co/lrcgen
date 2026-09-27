// Small building blocks matching the boards: Kbd, Button, IconButton, Segmented, Chip, RadioCard, Field.
//   <Button variant="primary" size="lg" kbd="Enter" onClick={open}>Open with these lyrics</Button>
//   <Segmented mono options={[{ value: 0.5, label: "0.5×" }, …]} value={rate} onChange={setRate} label="Speed" />
//   <Chip tone="vocals">vocals only</Chip>

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { keyLabel } from "../hotkeys/key-spec";

/** A key cap. `keys` takes a hotkey spec ("Ctrl+S" → "Ctrl S"); children are shown as is. */
export function Kbd({ keys, children, onAccent }: { keys?: string; children?: ReactNode; onAccent?: boolean }) {
  return <kbd className={onAccent ? "on-accent" : undefined}>{keys ? keyLabel(keys) : children}</kbd>;
}

/** Key caps followed by a label: "↑ ↓ select". */
export function KeyHint({ keys, children }: { keys: string[]; children?: ReactNode }) {
  return (
    <span className="key-inline">
      {keys.map((k) => (
        <Kbd key={k} keys={k} />
      ))}
      {children}
    </span>
  );
}

export type ButtonVariant = "primary" | "secondary" | "ghost" | "tool" | "toggle";
export type ButtonSize = "lg" | "dialog" | "md" | "sm" | "xs";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading icon. */
  icon?: ReactNode;
  /** Trailing key cap (hotkey spec). */
  kbd?: string;
  /** For `toggle` buttons: pressed colours ("vocals" = blue, "accent" = amber). */
  tone?: "vocals" | "accent";
  block?: boolean;
}

export function Button({ variant = "secondary", size = "md", icon, kbd, tone, block, className, children, type = "button", ...rest }: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, size !== "md" && `btn-${size}`, tone && `tone-${tone}`, block && "btn-block", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {icon}
      {children}
      {kbd && <Kbd keys={kbd} onAccent={variant === "primary"} />}
    </button>
  );
}

export function IconButton({
  label,
  round,
  className,
  children,
  type = "button",
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; round?: boolean }) {
  return (
    <button type={type} aria-label={label} title={label} className={["icon-btn", round && "round", className].filter(Boolean).join(" ")} {...rest}>
      {children}
    </button>
  );
}

export interface SegmentedOption<T> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
  title?: string;
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  mono,
  size = "sm",
  fill,
  className,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible group name ("Speed"). */
  label: string;
  mono?: boolean;
  /** sm = 30 px (footer speed), md = 34 px (Words method), lg = 36 px (Preview side panel). */
  size?: "sm" | "md" | "lg";
  /** Stretch to the container with equal columns. */
  fill?: boolean;
  className?: string;
}) {
  const classes = ["segmented", mono && "mono", size !== "sm" && size, fill && "fill", className].filter(Boolean).join(" ");
  return (
    <div role="group" aria-label={label} className={classes}>
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Chip({
  tone = "neutral",
  size = "sm",
  mono,
  onClick,
  title,
  children,
}: {
  tone?: "accent" | "vocals" | "neutral" | "warn";
  size?: "sm" | "lg";
  mono?: boolean;
  onClick?: () => void;
  title?: string;
  children: ReactNode;
}) {
  const className = ["chip", `tone-${tone}`, size === "lg" && "lg", mono && "mono"].filter(Boolean).join(" ");
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} title={title}>
        {children}
      </button>
    );
  }
  return (
    <span className={className} title={title}>
      {children}
    </span>
  );
}

/** A radio option as a card (Save dialog's format choice). */
export function RadioCard({
  name,
  checked,
  onChange,
  label,
  description,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: ReactNode;
  description?: ReactNode;
}) {
  return (
    <label className={checked ? "radio-card checked" : "radio-card"}>
      <input type="radio" name={name} checked={checked} onChange={onChange} />
      <span className="text">
        <span className="label">{label}</span>
        {description && <span className="description">{description}</span>}
      </span>
    </label>
  );
}

/** A labelled text input in the boards' style (Song info panel, Settings). */
export function Field({ label, hint, mono, ...input }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; mono?: boolean }) {
  return (
    <label className="field">
      {label}
      <input className={mono ? "input mono" : "input"} {...input} />
      {hint && <span className="hint">{hint}</span>}
    </label>
  );
}
