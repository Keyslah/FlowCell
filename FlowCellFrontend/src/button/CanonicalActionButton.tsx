export interface CanonicalActionButtonProps {
  id: string;
  label: string;
  tooltip?: string;
  width?: number;
  height?: number;
  disabled?: boolean;
  className?: string;
  onActivate: () => void | Promise<void>;
}

export function CanonicalActionButton({
  id,
  label,
  tooltip = "",
  width = 220,
  height = 44,
  disabled = false,
  className,
  onActivate
}: CanonicalActionButtonProps) {
  return (
    <button
      type="button"
      id={id}
      className={className}
      title={tooltip}
      disabled={disabled}
      style={{ display: "block", width, height }}
      onClick={() => void onActivate()}
    >
      {label}
    </button>
  );
}

export default CanonicalActionButton;
