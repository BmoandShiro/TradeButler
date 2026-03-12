import Calendar from "../components/Calendar";

export default function CalendarPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minHeight: 0,
        width: "100%",
        padding: "20px 24px",
        background: "var(--bg-primary)",
      }}
    >
      <h1
        style={{
          flexShrink: 0,
          fontSize: "28px",
          fontWeight: "700",
          marginBottom: "16px",
          background: "linear-gradient(135deg, var(--text-primary) 0%, var(--text-secondary) 100%)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
          backgroundClip: "text",
          letterSpacing: "-0.02em",
        }}
      >
        Calendar
      </h1>
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column" }}>
        <Calendar />
      </div>
    </div>
  );
}

