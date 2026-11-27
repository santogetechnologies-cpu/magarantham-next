export default function AdminLoading() {
  return (
    <div
      className="luxury-admin-shell"
      style={{
        minHeight: "100vh",
        background: "#FDFBF7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
      aria-busy="true"
      aria-label="Loading page"
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 12,
          color: "#650019",
          fontWeight: 600,
          fontSize: 14,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            border: "3px solid #EAD5C0",
            borderTopColor: "#7A1230",
            animation: "ms-spin 0.7s linear infinite",
          }}
        />
        <span>Loading…</span>
        <style>{`@keyframes ms-spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    </div>
  );
}
