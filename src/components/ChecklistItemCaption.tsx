import type { CSSProperties, ReactNode } from "react";

type Props = {
  title: ReactNode;
  description?: string | null;
  titleStyle?: CSSProperties;
  descriptionStyle?: CSSProperties;
  /**
   * When true, the title row participates in flex layouts (e.g. checklist label beside checkbox).
   * When false, the block stacks without flex growth (e.g. group headers).
   */
  fillRow?: boolean;
};

/**
 * Renders checklist item title with an optional second line when `description` is non-empty.
 */
export function ChecklistItemCaption({ title, description, titleStyle, descriptionStyle, fillRow = true }: Props) {
  const d = (description?.trim() ?? "") || "";
  if (!d) {
    return (
      <span
        style={{
          ...(fillRow ? { flex: 1, minWidth: 0 } : undefined),
          ...titleStyle,
        }}
      >
        {title}
      </span>
    );
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "stretch",
        gap: 4,
        minWidth: 0,
        ...(fillRow ? { flex: 1 } : { width: "100%" }),
      }}
    >
      <span style={titleStyle}>{title}</span>
      <span
        style={{
          fontSize: "12px",
          fontWeight: 400,
          lineHeight: 1.4,
          color: "var(--text-secondary)",
          ...descriptionStyle,
        }}
      >
        {d}
      </span>
    </div>
  );
}
