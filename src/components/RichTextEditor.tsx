import { useEffect, useRef } from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";

interface RichTextEditorProps {
  value: string;
  onChange: (content: string) => void;
  placeholder?: string;
  readOnly?: boolean;
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder,
  readOnly = false,
}: RichTextEditorProps) {
  const quillRef = useRef<ReactQuill>(null);

  const modules = {
    toolbar: readOnly
      ? false
      : [
          [{ header: [1, 2, 3, false] }],
          ["bold", "italic", "underline", "strike"],
          [{ list: "ordered" }, { list: "bullet" }],
          [{ indent: "-1" }, { indent: "+1" }],
          ["link", "image"],
          ["clean"],
        ],
  };

  const formats = [
    "header",
    "bold",
    "italic",
    "underline",
    "strike",
    "list",
    "bullet",
    "indent",
    "link",
    "image",
  ];

  return (
    <div
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
      }}
    >
      <ReactQuill
        ref={quillRef}
        theme="snow"
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        readOnly={readOnly}
        modules={modules}
        formats={formats}
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
        }}
      />
      <style>{`
        .quill {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
        }
        .ql-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: auto;
        }
        .ql-editor {
          flex: 1;
          min-height: 200px;
          color: var(--text-primary);
        }
        .ql-editor.ql-blank::before {
          color: var(--text-secondary);
          font-style: normal;
        }
        .ql-toolbar {
          border-top: 1px solid var(--border-color);
          border-left: 1px solid var(--border-color);
          border-right: 1px solid var(--border-color);
          border-bottom: none;
          background: var(--bg-secondary);
        }
        .ql-container {
          border-bottom: 1px solid var(--border-color);
          border-left: 1px solid var(--border-color);
          border-right: 1px solid var(--border-color);
          border-top: none;
          background: var(--bg-primary);
        }
        .ql-stroke {
          stroke: var(--text-secondary);
        }
        .ql-fill {
          fill: var(--text-secondary);
        }
        .ql-picker-label {
          color: var(--text-secondary);
        }
        .ql-picker-options {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
        }
        .ql-picker-item {
          color: var(--text-primary);
        }
        .ql-picker-item:hover {
          background: var(--bg-tertiary);
        }
        .ql-picker-item.ql-selected {
          background: var(--accent);
          color: white;
        }
        .ql-toolbar button:hover,
        .ql-toolbar button.ql-active {
          color: var(--accent);
        }
        .ql-toolbar button:hover .ql-stroke,
        .ql-toolbar button.ql-active .ql-stroke {
          stroke: var(--accent);
        }
        .ql-toolbar button:hover .ql-fill,
        .ql-toolbar button.ql-active .ql-fill {
          fill: var(--accent);
        }
      `}</style>
    </div>
  );
}
