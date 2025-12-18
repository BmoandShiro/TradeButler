import Calendar from "../components/Calendar";

export default function CalendarPage() {
  return (
    <div style={{ padding: "30px" }}>
      <h1 style={{ fontSize: "32px", fontWeight: "bold", marginBottom: "30px" }}>
        Trading Calendar
      </h1>
      <Calendar />
    </div>
  );
}

