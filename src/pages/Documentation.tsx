import { useState, useEffect, useCallback } from "react";
import {
  BookOpen,
  Plus,
  Trash2,
  FileText,
  ChevronRight,
  ChevronDown,
  Edit2,
  Folder,
  FolderOpen,
} from "lucide-react";
import RichTextEditor from "../components/RichTextEditor";

const STORAGE_KEY = "tradebutler_documentation";

interface DocPage {
  id: string;
  title: string;
  content: string;
  parentId: string | null;
  order: number;
}

function loadPages(): DocPage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    let list: DocPage[] = [];
    if (Array.isArray(parsed)) {
      list = parsed.map((p: Record<string, unknown>) => ({
        id: String(p.id),
        title: String(p.title ?? "Untitled"),
        content: String(p.content ?? ""),
        parentId: p.parentId != null ? String(p.parentId) : null,
        order: typeof p.order === "number" ? p.order : 0,
      }));
    } else if (parsed?.pages && Array.isArray(parsed.pages)) {
      list = parsed.pages.map((p: Record<string, unknown>) => ({
        id: String(p.id),
        title: String(p.title ?? "Untitled"),
        content: String(p.content ?? ""),
        parentId: p.parentId != null ? String(p.parentId) : null,
        order: typeof p.order === "number" ? p.order : 0,
      }));
    }
    return list;
  } catch {
    return [];
  }
}

function savePages(pages: DocPage[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(pages));
}

function loadRootOrder(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + "_order");
    if (!raw) return [];
    const parsed = JSON.parse(raw) as string[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default function Documentation() {
  const [pages, setPages] = useState<DocPage[]>(() => loadPages());
  const [selectedId, setSelectedId] = useState<string | null>(() => {
    const loaded = loadPages();
    const root = loaded.filter((p) => !p.parentId).sort((a, b) => a.order - b.order);
    return root.length > 0 ? root[0].id : null;
  });
  const [rootOrder, setRootOrder] = useState<string[]>(() => loadRootOrder());
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set());
  const [isEditing, setIsEditing] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; title: string; subCount: number } | null>(null);

  const rootPages = (() => {
    const roots = pages.filter((p) => !p.parentId);
    if (rootOrder.length > 0) {
      const byId = new Map(roots.map((p) => [p.id, p]));
      const ordered: DocPage[] = [];
      for (const id of rootOrder) {
        const p = byId.get(id);
        if (p) ordered.push(p);
      }
      for (const p of roots) {
        if (!rootOrder.includes(p.id)) ordered.push(p);
      }
      return ordered.sort((a, b) => {
        const ai = rootOrder.indexOf(a.id);
        const bi = rootOrder.indexOf(b.id);
        if (ai >= 0 && bi >= 0) return ai - bi;
        if (ai >= 0) return -1;
        if (bi >= 0) return 1;
        return a.order - b.order;
      });
    }
    return roots.sort((a, b) => a.order - b.order);
  })();

  const getChildren = useCallback(
    (parentId: string) =>
      pages
        .filter((p) => p.parentId === parentId)
        .sort((a, b) => a.order - b.order),
    [pages]
  );

  useEffect(() => {
    savePages(pages);
  }, [pages]);

  useEffect(() => {
    if (rootOrder.length > 0) localStorage.setItem(STORAGE_KEY + "_order", JSON.stringify(rootOrder));
  }, [rootOrder]);

  // Migrate: if we have pages but no root order (e.g. old data), set root order from root pages
  useEffect(() => {
    if (rootOrder.length > 0) return;
    const roots = pages.filter((p) => !p.parentId).sort((a, b) => a.order - b.order);
    if (roots.length > 0) setRootOrder(roots.map((p) => p.id));
  }, [pages, rootOrder.length]);

  const addPage = useCallback((parentId: string | null) => {
    const id = `doc-${Date.now()}`;
    const siblings = parentId ? pages.filter((p) => p.parentId === parentId) : rootPages;
    const maxOrder = siblings.length > 0 ? Math.max(...siblings.map((p) => p.order)) + 1 : 0;
    const newPage: DocPage = { id, title: "Untitled", content: "", parentId, order: maxOrder };
    setPages((prev) => [...prev, newPage]);
    if (!parentId) {
      setRootOrder((prev) => [...prev, id]);
      setExpandedIds((prev) => new Set(prev));
    } else {
      setExpandedIds((prev) => new Set(prev).add(parentId));
    }
    setSelectedId(id);
    setIsEditing(true);
  }, [pages, rootPages]);

  const collectDescendantIds = useCallback(
    (parentId: string): string[] => {
      const direct = getChildren(parentId);
      const ids = direct.flatMap((c) => [c.id, ...collectDescendantIds(c.id)]);
      return [parentId, ...ids];
    },
    [getChildren]
  );

  const deletePage = useCallback(
    (id: string) => {
      const page = pages.find((p) => p.id === id);
      if (!page) return;
      const toRemove = collectDescendantIds(id);
      setPages((prev) => prev.filter((p) => !toRemove.includes(p.id)));
      setRootOrder((prev) => prev.filter((x) => !toRemove.includes(x)));
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (selectedId === id || toRemove.includes(selectedId)) {
        const remaining = pages.filter((p) => !toRemove.includes(p.id));
        setSelectedId(remaining.length > 0 ? remaining[0].id : null);
      }
      setIsEditing(false);
    },
    [pages, selectedId, getChildren, collectDescendantIds]
  );

  const updatePage = useCallback((id: string, updates: Partial<Pick<DocPage, "title" | "content">>) => {
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  }, []);

  const selectedPage = selectedId ? pages.find((p) => p.id === selectedId) : null;
  const selectedParentId = selectedPage?.parentId ?? null;

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div style={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
      {/* Sidebar */}
      <aside
        style={{
          width: "280px",
          flexShrink: 0,
          borderRight: "1px solid var(--border-color)",
          backgroundColor: "var(--bg-secondary)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            padding: "20px 16px",
            borderBottom: "1px solid var(--border-color)",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: "8px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <BookOpen size={22} style={{ color: "var(--accent)" }} />
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: "700", color: "var(--text-primary)" }}>
              Documentation
            </h2>
          </div>
          <button
            onClick={() => addPage(null)}
            title="New page"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              border: "none",
              background: "var(--accent)",
              color: "white",
              cursor: "pointer",
            }}
          >
            <Plus size={18} />
          </button>
        </div>
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {rootPages.length === 0 ? (
            <div
              style={{
                padding: "24px 16px",
                textAlign: "center",
                color: "var(--text-secondary)",
                fontSize: "14px",
                lineHeight: 1.5,
              }}
            >
              <FileText size={32} style={{ marginBottom: "12px", opacity: 0.5 }} />
              <p style={{ margin: 0 }}>No pages yet.</p>
              <p style={{ margin: "4px 0 0" }}>Add a page for terminology, notes, links, or code.</p>
              <button
                onClick={() => addPage(null)}
                style={{
                  marginTop: "16px",
                  padding: "10px 16px",
                  borderRadius: "8px",
                  border: "none",
                  background: "var(--accent)",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "8px",
                }}
              >
                <Plus size={16} />
                Add first page
              </button>
            </div>
          ) : (
            rootPages.map((page) => {
              const children = getChildren(page.id);
              const hasChildren = children.length > 0;
              const isExpanded = expandedIds.has(page.id);
              const isSelected = page.id === selectedId;
              return (
                <div key={page.id} style={{ marginBottom: "2px" }}>
                  <div
                    onClick={() => {
                      setSelectedId(page.id);
                      if (hasChildren) toggleExpand(page.id);
                    }}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      padding: "10px 16px",
                      margin: "0 8px",
                      borderRadius: "8px",
                      cursor: "pointer",
                      backgroundColor: isSelected ? "var(--bg-tertiary)" : "transparent",
                      borderLeft: isSelected ? "3px solid var(--accent)" : "3px solid transparent",
                    }}
                  >
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (hasChildren) toggleExpand(page.id);
                      }}
                      style={{
                        width: "24px",
                        height: "24px",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        border: "none",
                        background: "transparent",
                        color: "var(--text-secondary)",
                        cursor: hasChildren ? "pointer" : "default",
                        flexShrink: 0,
                      }}
                    >
                      {hasChildren ? (
                        isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />
                      ) : (
                        <span style={{ width: 16 }} />
                      )}
                    </button>
                    {hasChildren ? (
                      isExpanded ? (
                        <FolderOpen size={16} style={{ color: "var(--accent)", flexShrink: 0 }} />
                      ) : (
                        <Folder size={16} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                      )
                    ) : (
                      <FileText size={16} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                    )}
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        fontSize: "14px",
                        color: isSelected ? "var(--text-primary)" : "var(--text-secondary)",
                        fontWeight: isSelected ? "500" : "400",
                      }}
                    >
                      {page.title || "Untitled"}
                    </span>
                  </div>
                  {hasChildren && isExpanded && (
                    <div style={{ paddingLeft: "24px", marginLeft: "8px", borderLeft: "1px solid var(--border-color)" }}>
                      {children.map((child) => {
                        const childSelected = child.id === selectedId;
                        return (
                          <div
                            key={child.id}
                            onClick={() => setSelectedId(child.id)}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: "8px",
                              padding: "8px 12px",
                              margin: "2px 4px",
                              borderRadius: "6px",
                              cursor: "pointer",
                              backgroundColor: childSelected ? "var(--bg-tertiary)" : "transparent",
                              borderLeft: childSelected ? "3px solid var(--accent)" : "3px solid transparent",
                            }}
                          >
                            <FileText size={14} style={{ color: "var(--text-secondary)", flexShrink: 0 }} />
                            <span
                              style={{
                                flex: 1,
                                minWidth: 0,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                                fontSize: "13px",
                                color: childSelected ? "var(--text-primary)" : "var(--text-secondary)",
                                fontWeight: childSelected ? "500" : "400",
                              }}
                            >
                              {child.title || "Untitled"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </aside>

      {/* Main content */}
      <main
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "auto",
          padding: "24px",
        }}
      >
        {selectedPage ? (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "16px",
                marginBottom: "16px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                {isEditing ? (
                  <input
                    type="text"
                    value={selectedPage.title}
                    onChange={(e) => updatePage(selectedPage.id, { title: e.target.value })}
                    placeholder="Page title"
                    style={{
                      width: "100%",
                      maxWidth: "720px",
                      padding: "12px 0",
                      fontSize: "24px",
                      fontWeight: "700",
                      color: "var(--text-primary)",
                      background: "transparent",
                      border: "none",
                      borderBottom: "1px solid var(--border-color)",
                      outline: "none",
                    }}
                  />
                ) : (
                  <h1
                    style={{
                      margin: 0,
                      fontSize: "24px",
                      fontWeight: "700",
                      color: "var(--text-primary)",
                      padding: "12px 0",
                    }}
                  >
                    {selectedPage.title || "Untitled"}
                  </h1>
                )}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                {isEditing ? (
                  <>
                    <button
                      onClick={() => setIsEditing(false)}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "6px",
                        border: "none",
                        background: "var(--accent)",
                        color: "white",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      Save
                    </button>
                    <button
                      onClick={() => selectedPage && addPage(selectedPage.parentId ?? selectedPage.id)}
                      style={{
                        padding: "8px 16px",
                        borderRadius: "6px",
                        border: "1px dashed var(--border-color)",
                        background: "transparent",
                        color: "var(--accent)",
                        cursor: "pointer",
                        fontSize: "14px",
                        fontWeight: "500",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                      }}
                    >
                      <Plus size={16} />
                      Add sub-page
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditing(true)}
                    style={{
                      padding: "8px 16px",
                      borderRadius: "6px",
                      border: "1px solid var(--border-color)",
                      background: "var(--bg-tertiary)",
                      color: "var(--text-primary)",
                      cursor: "pointer",
                      fontSize: "14px",
                      fontWeight: "500",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <Edit2 size={16} />
                    Edit
                  </button>
                )}
                <button
                  onClick={() => {
                    const subCount = collectDescendantIds(selectedPage.id).length - 1;
                    setPendingDelete({
                      id: selectedPage.id,
                      title: selectedPage.title || "Untitled",
                      subCount,
                    });
                  }}
                  style={{
                    padding: "8px 16px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-color)",
                    background: "transparent",
                    color: "var(--loss)",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: "500",
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            </div>
            {!isEditing && (
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "-8px 0 16px 0" }}>
                Click <strong>Edit</strong> to change this page or add sub-pages.
              </p>
            )}
            <div style={{ flex: 1, minHeight: 300, display: "flex", flexDirection: "column" }}>
              <RichTextEditor
                key={`${selectedPage.id}-${isEditing ? "edit" : "read"}`}
                value={selectedPage.content}
                onChange={(content) => updatePage(selectedPage.id, { content })}
                placeholder="Write notes, terminology, links, code snippets…"
                readOnly={!isEditing}
              />
            </div>
          </>
        ) : (
          <div
            style={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--text-secondary)",
              fontSize: "15px",
            }}
          >
            Select a page or add a new one.
          </div>
        )}
      </main>

      {/* Delete confirmation popup */}
      {pendingDelete && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000,
          }}
          onClick={() => setPendingDelete(null)}
        >
          <div
            style={{
              backgroundColor: "var(--bg-secondary)",
              border: "1px solid var(--border-color)",
              borderRadius: "12px",
              padding: "24px",
              width: "90%",
              maxWidth: "420px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.4)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3
              style={{
                margin: 0,
                fontSize: "18px",
                fontWeight: "600",
                color: "var(--text-primary)",
                marginBottom: "12px",
              }}
            >
              Delete page?
            </h3>
            <p
              style={{
                margin: 0,
                fontSize: "14px",
                color: "var(--text-secondary)",
                lineHeight: 1.5,
                marginBottom: "20px",
              }}
            >
              {pendingDelete.subCount > 0 ? (
                <>
                  Are you sure you want to delete <strong style={{ color: "var(--text-primary)" }}>"{pendingDelete.title}"</strong> and all {pendingDelete.subCount} sub-page(s)? This cannot be undone.
                </>
              ) : (
                <>
                  Are you sure you want to delete <strong style={{ color: "var(--text-primary)" }}>"{pendingDelete.title}"</strong>? This cannot be undone.
                </>
              )}
            </p>
            <div style={{ display: "flex", gap: "12px", justifyContent: "flex-end" }}>
              <button
                onClick={() => setPendingDelete(null)}
                style={{
                  padding: "10px 20px",
                  borderRadius: "6px",
                  border: "1px solid var(--border-color)",
                  background: "var(--bg-tertiary)",
                  color: "var(--text-primary)",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  deletePage(pendingDelete.id);
                  setPendingDelete(null);
                }}
                style={{
                  padding: "10px 20px",
                  borderRadius: "6px",
                  border: "none",
                  background: "var(--loss)",
                  color: "white",
                  cursor: "pointer",
                  fontSize: "14px",
                  fontWeight: "500",
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
