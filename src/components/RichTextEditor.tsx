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
        ${readOnly ? `
        .quill {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          border-radius: 0;
          overflow: visible;
          background: transparent !important;
          border: none !important;
          box-shadow: none !important;
        }
        .ql-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: visible;
          background: transparent !important;
          border: none !important;
        }
        .ql-editor {
          flex: 1;
          min-height: auto;
          padding: 0;
          color: var(--text-primary);
          font-size: 15px;
          line-height: 1.7;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
          border: none !important;
        }
        .ql-snow {
          border: none !important;
        }
        .ql-snow .ql-container {
          border: none !important;
        }
        ` : `
        .quill {
          display: flex;
          flex-direction: column;
          height: 100%;
          min-height: 0;
          border-radius: 8px;
          overflow: hidden;
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
        }
        .ql-container {
          flex: 1;
          display: flex;
          flex-direction: column;
          min-height: 0;
          overflow: auto;
          background: var(--bg-primary);
        }
        .ql-editor {
          flex: 1;
          min-height: 400px;
          padding: 24px 28px;
          color: var(--text-primary);
          font-size: 15px;
          line-height: 1.7;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
        }
        `}
        .ql-editor.ql-blank::before {
          color: var(--text-secondary);
          font-style: normal;
          opacity: 0.6;
          font-size: 15px;
        }
        .ql-editor p {
          margin-bottom: 12px;
        }
        .ql-editor img {
          max-width: 100%;
          height: auto;
          display: block;
          margin: 16px 0;
        }
        .ql-editor h1 {
          font-size: 28px;
          font-weight: 700;
          margin-top: 24px;
          margin-bottom: 16px;
          line-height: 1.3;
          color: var(--text-primary);
        }
        .ql-editor h2 {
          font-size: 24px;
          font-weight: 600;
          margin-top: 20px;
          margin-bottom: 14px;
          line-height: 1.3;
          color: var(--text-primary);
        }
        .ql-editor h3 {
          font-size: 20px;
          font-weight: 600;
          margin-top: 18px;
          margin-bottom: 12px;
          line-height: 1.4;
          color: var(--text-primary);
        }
        .ql-editor ul, .ql-editor ol {
          margin-bottom: 12px;
          padding-left: 24px;
        }
        .ql-editor li {
          margin-bottom: 8px;
          line-height: 1.6;
        }
        .ql-editor strong {
          font-weight: 600;
          color: var(--text-primary);
        }
        .ql-editor a {
          color: var(--accent);
          text-decoration: underline;
        }
        .ql-editor blockquote {
          border-left: 4px solid var(--accent);
          padding-left: 16px;
          margin: 16px 0;
          color: var(--text-secondary);
          font-style: italic;
        }
        .ql-toolbar {
          border: none;
          border-bottom: 1px solid var(--border-color);
          background: var(--bg-secondary);
          padding: 12px 16px;
          border-radius: 8px 8px 0 0;
        }
        .ql-toolbar .ql-formats {
          margin-right: 16px;
        }
        .ql-toolbar button {
          width: 32px;
          height: 32px;
          border-radius: 6px;
          margin: 0 2px;
          transition: all 0.2s;
        }
        .ql-toolbar button:hover {
          background: var(--bg-tertiary);
        }
        .ql-toolbar button.ql-active {
          background: var(--accent);
          color: white;
        }
        .ql-toolbar button.ql-active .ql-stroke {
          stroke: white;
        }
        .ql-toolbar button.ql-active .ql-fill {
          fill: white;
        }
        .ql-stroke {
          stroke: var(--text-secondary);
          stroke-width: 1.5;
        }
        .ql-fill {
          fill: var(--text-secondary);
        }
        .ql-picker-label {
          color: var(--text-secondary);
          font-size: 14px;
          padding: 6px 8px;
          border-radius: 6px;
          transition: all 0.2s;
        }
        .ql-picker-label:hover {
          background: var(--bg-tertiary);
          color: var(--text-primary);
        }
        .ql-picker-options {
          background: var(--bg-secondary);
          border: 1px solid var(--border-color);
          border-radius: 8px;
          padding: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        }
        .ql-picker-item {
          color: var(--text-primary);
          padding: 8px 12px;
          border-radius: 6px;
          transition: all 0.2s;
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
        .ql-toolbar button.ql-active .ql-stroke {
          stroke: white;
        }
        .ql-toolbar button.ql-active .ql-fill {
          fill: white;
        }
        .ql-snow .ql-picker {
          color: var(--text-secondary);
        }
        .ql-snow .ql-stroke.ql-thin {
          stroke-width: 1;
        }
        `}</style>
    </div>
  );
}
